"""Omi AI conversational assistant (text and voice share this service).

Flow for every message:
  1. Parse the message into investigation parameters (region(s), variable,
     period) and merge them with the parameters already collected in this
     conversation (sent back by the client as ``context``).
  2. If the user is investigating and something is missing, ask for it.
  3. When everything is known, run the shared analysis engine
     (services.analysis_service) on real NASA POWER data.
  4. Explain the *calculated* results. With GOOGLE_API_KEY set, Gemini words
     the explanation using only the structured results; otherwise (or if the
     model call fails) Omi's built-in explainer is used.

Trend questions are never answered from a model's general knowledge.
"""

import json
import re

import requests
from flask import current_app

from services.analysis_service import (
    DETAIL_LEVELS,
    compact_result,
    run_comparison,
    run_investigation,
)
from services.explain import explain_comparison, explain_investigation, p_text

REGION_WORDS = {
    "lagos": ["lagos", "ikeja", "lekki", "eko"],
    "edo": ["edo", "benin"],
}
VARIABLE_WORDS = {
    "temperature": ["temperature", "temp", "hot", "heat", "warm", "cool", "cold", "climate warming"],
    "rainfall": ["rain", "rainfall", "precip", "precipitation", "wet", "dry", "drought", "flood"],
}
INVESTIGATE_WORDS = [
    "investigate", "analyse", "analyze", "trend", "change", "changed", "changing",
    "show", "chart", "graph", "plot", "how has", "how have", "over the years",
    "history", "historical", "check", "look at", "examine", "study", "compare",
]
FOLLOWUP_WORDS = [
    "what does", "what do", "mean", "explain", "significant", "significance", "why",
    "how fast", "rate", "faster", "chart", "result", "finding", "summar", "tell me more",
    "is it", "is this", "which", "difference", "cause",
]
GREETING = re.compile(r"^\s*(hi|hello|hey|good (morning|afternoon|evening)|greetings)\b[\s!,.omi]*$", re.I)

GLOSSARY = {
    "mann-kendall": (
        "The Mann-Kendall test checks whether a series tends to go up or down over time "
        "(a monotonic trend) without assuming the change is a straight line. It compares every "
        "pair of years and reports a p-value: a small p-value (below the chosen significance level, "
        "usually 0.05) means the trend is unlikely to be random. Omi uses the Hamed & Rao version, "
        "which corrects for neighbouring years being similar (autocorrelation), and a seasonal "
        "version for monthly data."
    ),
    "sen": (
        "Sen's slope (the Theil-Sen estimator) is the median of the slopes between every pair of "
        "years. It estimates how fast a variable changes, for example °C per decade, and is robust: "
        "a single unusually hot or wet year barely moves it."
    ),
    "regression": (
        "Linear regression fits the straight line that best follows the yearly values. Its slope is "
        "the average rate of change, R² shows how much of the variation the line explains, and the "
        "confidence interval gives the plausible range of the true rate."
    ),
    "significan": (
        "Statistical significance tells you whether an observed trend is likely to be real rather "
        "than random variation. Omi calls a trend significant when the Mann-Kendall p-value is below "
        "the significance level (0.05 by default). Significant does not mean large or important, and "
        "it says nothing about the cause."
    ),
    "p-value": (
        "A p-value is the probability of seeing a trend at least this strong if there were really no "
        "trend. Small p-values (for example below 0.05) are evidence that a trend exists."
    ),
    "autocorrelation": (
        "Autocorrelation means each year tends to resemble the one before it. It can make ordinary "
        "trend tests too confident, so Omi uses the Hamed & Rao modified Mann-Kendall test, which "
        "corrects for it."
    ),
    "season": (
        "Monthly temperature and rainfall follow a strong yearly cycle (dry and rainy seasons). "
        "Omi removes it by analysing one value per year, and also runs a Seasonal Mann-Kendall test "
        "that compares each month only with the same month in other years."
    ),
    "nasa": (
        "Omi uses NASA POWER (Prediction Of Worldwide Energy Resources), which provides monthly "
        "temperature at 2 metres (T2M) and bias-corrected precipitation (PRECTOTCORR) derived from "
        "NASA's MERRA-2 reanalysis, from 1981 onwards, on a grid of about 50 km."
    ),
    "data": (
        "Omi uses NASA POWER monthly data (MERRA-2 based): T2M for temperature in °C and "
        "PRECTOTCORR for rainfall, converted to monthly and yearly totals in mm."
    ),
}


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def _contains(text, words):
    return any(re.search(r"\b" + re.escape(w), text) for w in words)


def parse_message(text):
    """Extract investigation parameters mentioned in one message."""
    cfg = current_app.config
    first, last = cfg["DATA_START_YEAR"], cfg["DATA_END_YEAR"]
    lowered = text.lower()
    found = {}

    regions = [rid for rid, words in REGION_WORDS.items() if _contains(lowered, words)]
    if _contains(lowered, ["compare", "comparison", "both", "versus", "vs"]) or len(regions) > 1:
        found["compare"] = True
        found["regions"] = list(REGION_WORDS.keys())
    elif regions:
        found["regions"] = regions[:1]
        found["compare"] = False

    variables = [vid for vid, words in VARIABLE_WORDS.items() if _contains(lowered, words)]
    if variables:
        found["variable"] = variables[0]

    if _contains(lowered, ["imerg", "gpm", "satellite"]):
        found["source"] = "imerg"
        found.setdefault("variable", "rainfall")
    elif _contains(lowered, ["nasa power", "merra"]):
        found["source"] = "power"

    match = re.search(r"\b(?:last|past|previous)\s+(\d{1,2})\s+years?\b", lowered)
    words_to_num = {"five": 5, "ten": 10, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40}
    match_word = re.search(r"\b(?:last|past|previous)\s+(" + "|".join(words_to_num) + r")\s+years?\b", lowered)
    decades = re.search(r"\b(?:last|past|previous)\s+(\d|two|three|four)\s+decades?\b", lowered)
    years = [int(y) for y in re.findall(r"\b(19[5-9]\d|20[0-9]\d)\b", lowered)]

    if match or match_word:
        n = int(match.group(1)) if match else words_to_num[match_word.group(1)]
        found["start_year"], found["end_year"] = max(first, last - n + 1), last
    elif decades:
        n = {"two": 2, "three": 3, "four": 4}.get(decades.group(1)) or int(decades.group(1))
        found["start_year"], found["end_year"] = max(first, last - 10 * n + 1), last
    elif len(years) >= 2:
        found["start_year"], found["end_year"] = min(years[:2]), max(years[:2])
    elif len(years) == 1:
        if re.search(r"\b(since|from)\s+" + str(years[0]), lowered):
            found["start_year"], found["end_year"] = years[0], last
        else:
            found["start_year_only"] = years[0]
    if _contains(lowered, ["longest", "all available", "full period", "entire", "all the data", "whole record", "maximum period"]):
        found["start_year"], found["end_year"] = first, last

    return found


def _clamp_period(params):
    cfg = current_app.config
    source = cfg["SOURCES"].get(params.get("source") or "power", cfg["SOURCES"]["power"])
    first, last = max(cfg["DATA_START_YEAR"], source["start_year"]), cfg["DATA_END_YEAR"]
    notes = []
    if "start_year" in params:
        start, end = params["start_year"], params["end_year"]
        if start < first or end > last:
            notes.append(
                f"{source['name']} data here covers {first}–{last}, so I used "
                f"{max(start, first)}–{min(end, last)}."
            )
        start, end = max(start, first), min(end, last)
        if end - start + 1 < cfg["MIN_YEARS"]:
            start = max(first, end - cfg["MIN_YEARS"] + 1)
            notes.append(f"A trend needs at least {cfg['MIN_YEARS']} years, so I used {start}–{end}.")
        params["start_year"], params["end_year"] = start, end
    return notes


# ---------------------------------------------------------------------------
# Language model (optional)
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = (
    "You are Omi AI, an environmental data assistant for the NASA Space Apps 'Earth System Trend "
    "Detective' challenge. You explain temperature and rainfall trends for Lagos State and Edo State, "
    "Nigeria, using ONLY the structured analysis results provided (NASA POWER / MERRA-2 data). "
    "Rules: never invent data, numbers or statistical results; quote numbers from the results with "
    "their units; say clearly whether a trend is statistically significant; distinguish observed "
    "patterns from causes and never claim a cause is proven; mention a limitation when relevant; "
    "if the results do not contain the answer, say so. Match the requested detail level: "
    "'simple' = everyday language, 2-4 short sentences, no jargon; 'detailed' = include trend "
    "direction, rate, significance and key statistics; 'research' = include data source, units, "
    "methods, test statistics and limitations. Plain text only, no markdown tables."
)


def _gemini(question, facts, detail, history, voice):
    key = current_app.config.get("GOOGLE_API_KEY")
    if not key:
        return None
    model = current_app.config.get("GEMINI_MODEL", "gemini-2.5-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    contents = []
    for turn in (history or [])[-6:]:
        role = "model" if turn.get("role") == "assistant" else "user"
        text = str(turn.get("content", ""))[:1500]
        if text:
            contents.append({"role": role, "parts": [{"text": text}]})
    prompt = (
        f"Detail level: {detail}.\n"
        + ("This answer will be spoken aloud: keep it under 90 words, no symbols like ± or ².\n" if voice else "")
        + f"Analysis results (JSON):\n{json.dumps(facts, default=str)}\n\nUser question: {question}"
    )
    contents.append({"role": "user", "parts": [{"text": prompt}]})

    try:
        response = requests.post(
            url,
            params={"key": key},
            json={
                "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                "contents": contents,
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 800},
            },
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        text = "".join(
            part.get("text", "")
            for part in data["candidates"][0]["content"]["parts"]
        ).strip()
        return text or None
    except Exception as error:  # fall back to the built-in explainer
        current_app.logger.warning("Gemini request failed: %s", error)
        return None


# ---------------------------------------------------------------------------
# Built-in answers
# ---------------------------------------------------------------------------

def _glossary_answer(lowered):
    for key, text in GLOSSARY.items():
        if key in lowered:
            return text
    if "trend" in lowered and ("what" in lowered or "mean" in lowered):
        return (
            "A trend is a long-term tendency for a variable to rise or fall, beyond normal "
            "year-to-year ups and downs. Omi measures its direction and speed (Sen's slope, per decade) "
            "and tests whether it is statistically significant (Mann-Kendall test)."
        )
    return None


def _followup_answer(question, result, detail):
    lowered = question.lower()
    is_comparison = "regions" in result
    if "cause" in lowered or "why" in lowered:
        return (
            "The analysis shows what changed, not why. Trends like these can be linked to many "
            "factors, such as regional climate change, land-use change or urban growth, but this "
            "data alone cannot prove the cause."
        )
    if is_comparison:
        return explain_comparison(result, detail)
    if "significan" in lowered or "sure" in lowered or "confiden" in lowered:
        mk = result["trend"]["mann_kendall"]
        return (
            f"The {mk['test']} gives p {p_text(mk['p_value'])} against a significance level of "
            f"{result['alpha']:g}, so the trend is "
            f"{'statistically significant' if mk['significant'] else 'not statistically significant'}. "
            + GLOSSARY["significan"]
        )
    return explain_investigation(result, detail)


def _speech(text):
    cleaned = re.sub(r"[*_#`]", "", text)
    cleaned = cleaned.replace("°C", " degrees Celsius").replace("mm/year", " millimetres per year")
    cleaned = cleaned.replace("mm", " millimetres").replace("R²", "R squared").replace("−", "minus ")
    first_paragraph = cleaned.split("\n\n")[0]
    return first_paragraph.strip()


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def answer_question(question, context=None, detail="detailed", history=None, voice=False, alpha=None):
    question = str(question or "").strip()
    if not question:
        raise ValueError("Please enter a question.")
    if len(question) > 2000:
        raise ValueError("Please keep messages under 2000 characters.")

    detail = detail if detail in DETAIL_LEVELS else "detailed"
    context = context if isinstance(context, dict) else {}
    previous = context.get("params") if isinstance(context.get("params"), dict) else {}
    params = {k: previous[k] for k in ("regions", "variable", "start_year", "end_year", "compare", "source") if k in previous}
    awaiting = context.get("awaiting")
    has_result = bool(context.get("has_result"))
    cfg = current_app.config
    first, last = cfg["DATA_START_YEAR"], cfg["DATA_END_YEAR"]
    lowered = question.lower()

    response = {"answer": "", "params": params, "awaiting": None, "analysis": None,
                "engine": "omi", "has_result": has_result}

    if GREETING.match(question):
        response["answer"] = (
            "Hello! I'm Omi. I can investigate how temperature or rainfall has changed in Lagos "
            "State or Edo State using NASA data, or compare the two. For example: "
            "\"How has rainfall changed in Lagos from 2001 to 2025?\""
        )
        return _finish(response, voice)

    found = parse_message(question)
    start_only = found.pop("start_year_only", None)

    # Bare answers to a follow-up question ("2001 to 2025", "rainfall", "Lagos").
    if awaiting == "period" and start_only and "start_year" not in found:
        found["start_year"], found["end_year"] = start_only, last
    if awaiting == "period" and re.search(r"\b(yes|ok|okay|sure|default|any)\b", lowered) and "start_year" not in found:
        found["start_year"], found["end_year"] = first, last

    new_investigation_terms = any(k in found for k in ("regions", "variable", "start_year"))
    investigating = new_investigation_terms or _contains(lowered, INVESTIGATE_WORDS) or awaiting

    # If the user names a new variable or region, start from fresh period choices
    # only when they did not give one; keep everything else.
    params.update(found)
    if params.get("source") == "imerg" and params.get("variable") == "temperature":
        params["source"] = "power"  # IMERG only measures rainfall
    notes = _clamp_period(params)

    # General method questions (no investigation terms): glossary / model.
    glossary = _glossary_answer(lowered)
    if not new_investigation_terms and not awaiting:
        if has_result and _contains(lowered, FOLLOWUP_WORDS) and _complete(params):
            pass  # handled below as a follow-up about the current results
        elif glossary:
            response["answer"] = glossary
            return _finish(response, voice)
        elif not investigating:
            reply = _gemini(question, {"note": "No analysis has been run yet in this conversation.",
                                       "available": {"regions": ["Lagos State", "Edo State"],
                                                     "variables": ["temperature", "rainfall"],
                                                     "years": f"{first}-{last}"}},
                            detail, history, voice)
            if reply:
                response["answer"], response["engine"] = reply, "gemini"
            else:
                response["answer"] = (
                    "I can investigate temperature or rainfall trends for Lagos State and Edo State "
                    f"({first}–{last}, NASA POWER data), compare the two regions, and explain methods "
                    "such as the Mann-Kendall test or Sen's slope. What would you like to investigate?"
                )
            return _finish(response, voice)

    # Collect missing parameters one at a time.
    if not params.get("variable"):
        response["awaiting"] = "variable"
        where = _regions_label(params)
        response["answer"] = (
            f"Sure, I can help with that{(' for ' + where) if where else ''}. "
            "Would you like to investigate temperature or rainfall?"
        )
        return _finish(response, voice)
    if not params.get("regions"):
        response["awaiting"] = "region"
        response["answer"] = (
            f"Which region should I investigate for {params['variable']}: Lagos State, Edo State, "
            "or should I compare both?"
        )
        return _finish(response, voice)
    if "start_year" not in params:
        response["awaiting"] = "period"
        response["answer"] = (
            f"Great — {params['variable']} in {_regions_label(params)}. What period would you like to "
            f"examine? NASA POWER data is available from {first} to {last}. You can say, for example, "
            f"\"2001 to 2025\", \"the last 20 years\" or \"the longest period\"."
        )
        return _finish(response, voice)

    # Everything is known: run the shared analysis engine.
    if params.get("compare"):
        result = run_comparison(params["variable"], params["start_year"], params["end_year"],
                                params["regions"], alpha=alpha, detail=detail,
                                source=params.get("source", "power"))
    else:
        result = run_investigation(params["regions"][0], params["variable"],
                                   params["start_year"], params["end_year"],
                                   alpha=alpha, detail=detail,
                                   source=params.get("source", "power"))

    is_followup = has_result and not new_investigation_terms
    if is_followup:
        fallback = _followup_answer(question, result, detail)
    else:
        fallback = result["explanation"]
        intro = (
            f"Here is what {current_app.config['SOURCES'].get(params.get('source') or 'power', {}).get('name', 'NASA')} data shows for {params['variable']} in "
            f"{_regions_label(params)}, {params['start_year']}–{params['end_year']}. "
        )
        fallback = intro + fallback

    reply = _gemini(question, compact_result(result), detail, history, voice)
    if reply:
        response["answer"], response["engine"] = reply, "gemini"
    else:
        response["answer"] = fallback
    if notes:
        response["answer"] = " ".join(notes) + " " + response["answer"]

    response["analysis"] = result
    response["has_result"] = True
    response["params"] = params
    return _finish(response, voice)


def _complete(params):
    return bool(params.get("variable") and params.get("regions") and "start_year" in params)


def _regions_label(params):
    names = {rid: r["name"] for rid, r in current_app.config["REGIONS"].items()}
    regions = params.get("regions") or []
    if params.get("compare") and len(regions) == 2:
        return f"{names[regions[0]]} and {names[regions[1]]}"
    return names.get(regions[0], "") if regions else ""


def _finish(response, voice):
    response["reply"] = response["answer"]
    if voice:
        response["speech"] = _speech(response["answer"])
    return response
