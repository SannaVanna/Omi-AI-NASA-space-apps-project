"""Trend Detective Challenge.

The player sees the first part of a real NASA POWER monthly record and
classifies the long-term pattern (increasing / decreasing / no trend). The
hidden observations are then revealed together with the Seasonal
Mann-Kendall test on the complete window, which decides the answer.

The answer is never sent to the browser before the guess: the challenge
window is kept in the signed session and recomputed on reveal.
"""

import random
import uuid

from flask import current_app, session

from processing.trend_analysis import calculate_trend, clean_number
from services.nasa_service import fetch_environmental_data, get_region, get_variable

WINDOW_YEARS = 11          # 132 monthly observations
SHOWN_MONTHS = 72          # first 6 years are visible
GUESSES = ("increasing", "decreasing", "no trend")


def _series(region_id, variable_id, start, end):
    fetched = fetch_environmental_data(region_id, variable_id, start, end)
    monthly = fetched["monthly"].dropna(subset=["value"])
    return fetched, [
        {"date": d.strftime("%Y-%m"), "value": clean_number(v, 3)}
        for d, v in zip(monthly["date"], monthly["value"])
    ]


def new_challenge(region="random", variable="random", rng=None):
    rng = rng or random.SystemRandom()
    cfg = current_app.config

    region_ids = list(cfg["REGIONS"].keys())
    variable_ids = list(cfg["VARIABLES"].keys())
    region_id = rng.choice(region_ids) if region in (None, "", "random") else get_region(region)["id"]
    variable_id = rng.choice(variable_ids) if variable in (None, "", "random") else get_variable(variable)["id"]

    first, last = cfg["DATA_START_YEAR"], cfg["DATA_END_YEAR"]
    start = rng.randint(first, last - WINDOW_YEARS + 1)
    end = start + WINDOW_YEARS - 1

    fetched, series = _series(region_id, variable_id, start, end)
    if len(series) < SHOWN_MONTHS + 24:
        raise ValueError("Not enough data for this challenge. Please load a new one.")

    challenge_id = uuid.uuid4().hex
    session["challenge"] = {
        "id": challenge_id, "region": region_id, "variable": variable_id, "start": start, "end": end,
    }

    variable_cfg = fetched["variable"]
    shown = series[:SHOWN_MONTHS]
    hidden = series[SHOWN_MONTHS:]
    return {
        "challenge_id": challenge_id,
        "region": fetched["region"],
        "variable": {
            "id": variable_cfg["id"], "name": variable_cfg["name"],
            "unit": variable_cfg["monthly_unit"], "parameter": variable_cfg["parameter"],
        },
        "source": {"dataset": "NASA POWER (MERRA-2)", "parameter": variable_cfg["parameter"]},
        "period": {"start": series[0]["date"], "end": series[-1]["date"]},
        "shown": shown,
        "hidden_dates": [p["date"] for p in hidden],
        "total": len(series),
        "hidden_count": len(hidden),
        "choices": list(GUESSES),
    }


def reveal(challenge_id, guess, alpha=0.05):
    guess = str(guess or "").strip().lower()
    if guess not in GUESSES:
        raise ValueError("Choose increasing, decreasing or no trend.")

    stored = session.get("challenge")
    if not stored or stored.get("id") != challenge_id:
        raise ValueError("This challenge has expired. Please load a new one.")
    session.pop("challenge", None)  # one answer per challenge

    fetched, series = _series(stored["region"], stored["variable"], stored["start"], stored["end"])
    trend = calculate_trend(
        [p["date"] + "-01" for p in series], [p["value"] for p in series], alpha=alpha, period=12,
    )
    seasonal = trend["seasonal_mann_kendall"] or trend["mann_kendall"]
    answer = seasonal["trend"]
    correct = guess == answer

    unit = fetched["variable"]["monthly_unit"]
    slope_year = seasonal.get("sen_slope_per_year")
    if slope_year is None:
        slope_year = trend["sens_slope"]["slope_per_year"]
    per_decade = None if slope_year is None else slope_year * 10

    region_name = fetched["region"]["name"]
    variable_name = fetched["variable"]["name"].lower()
    p_value = seasonal["p_value"]
    p_text = "< 0.001" if p_value is not None and p_value < 0.001 else (f"= {p_value:.3f}" if p_value is not None else "= n/a")
    if answer == "no trend":
        verdict = (
            f"The Seasonal Mann-Kendall test found no statistically significant trend in {variable_name} "
            f"for {region_name} over {series[0]['date'][:4]}–{series[-1]['date'][:4]} (p {p_text}, α = {alpha:g}). "
            "Short-term ups and downs can look like a trend, but they are not strong enough to be distinguished from natural variability."
        )
    else:
        verdict = (
            f"The Seasonal Mann-Kendall test found a statistically significant {answer} trend in {variable_name} "
            f"for {region_name} over {series[0]['date'][:4]}–{series[-1]['date'][:4]} (p {p_text}, α = {alpha:g}), "
            f"about {per_decade:+.2f} {unit} per decade (Sen's slope). This describes the observed change, not its cause."
        )

    return {
        "correct": correct,
        "guess": guess,
        "answer": answer,
        "series": series,
        "shown_count": SHOWN_MONTHS,
        "trend_line": [{"date": p["date"][:7], "value": p["value"]} for p in trend["trend_line"]],
        "test": {
            "name": seasonal.get("test", "Seasonal Mann-Kendall"),
            "p_value": p_value,
            "tau": seasonal.get("tau"),
            "z": seasonal.get("z"),
            "significant": seasonal.get("significant"),
            "alpha": alpha,
            "sen_slope_per_decade": clean_number(per_decade, 4),
            "unit": unit,
        },
        "explanation": verdict,
        "region": fetched["region"],
        "variable": {"id": fetched["variable"]["id"], "name": fetched["variable"]["name"], "unit": unit},
    }
