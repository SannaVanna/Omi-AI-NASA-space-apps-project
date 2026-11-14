"""Plain-language explanations built only from calculated results.

These are used directly when no language model is configured, and as the
grounding facts / fallback when one is. Nothing here invents numbers: every
figure comes from the analysis result passed in.
"""


def fmt(value, digits=2, signed=False):
    if value is None:
        return "n/a"
    text = f"{value:+.{digits}f}" if signed else f"{value:.{digits}f}"
    return text.replace("-", "−")


def p_text(p):
    """Return '= 0.023' or '< 0.001', for use as f"p {p_text(p)}"."""
    if p is None:
        return "= n/a"
    return "< 0.001" if p < 0.001 else f"= {p:.3f}"


def _is_rain(result):
    return result["variable"]["id"] == "rainfall"


def _change_words(result):
    trend = result["trend"]
    slope = trend["sens_slope"]["slope_per_year"] or 0.0
    years = result["period"]["end_year"] - result["period"]["start_year"]
    unit = result["units"]["annual"]
    total = slope * years
    rain = _is_rain(result)
    if abs(slope) < 1e-9:
        return "stayed about the same", total, unit
    if rain:
        verb = "became wetter" if slope > 0 else "became drier"
    else:
        verb = "warmed" if slope > 0 else "cooled"
    return verb, total, unit


def explain_investigation(result, detail="detailed"):
    region = result["region"]["name"]
    variable = result["variable"]["name"].lower()
    start, end = result["period"]["start_year"], result["period"]["end_year"]
    trend = result["trend"]
    stats = result["statistics"]
    unit = result["units"]["annual"]
    mk = trend["mann_kendall"]
    sen = trend["sens_slope"]
    lin = trend["linear_regression"]
    verb, total, _ = _change_words(result)
    digits = 0 if _is_rain(result) else 2
    yearly = "average yearly temperature" if not _is_rain(result) else "total yearly rainfall"

    if trend["significant"]:
        verdict = (
            "This change is statistically significant, so it is unlikely to be only "
            "random year-to-year variation."
        )
    else:
        verdict = (
            "However, this change is not statistically significant: it is small compared "
            "with the natural ups and downs between years, so we cannot be confident it is a real trend."
        )

    if _is_rain(result):
        opener = f"Between {start} and {end}, {region} {verb}: its {yearly} changed by about"
    else:
        opener = f"Between {start} and {end}, the {yearly} in {region} {verb}. It changed by about"
    simple = (
        f"{opener} {fmt(sen['slope_per_decade'], digits, True)} {unit} per decade "
        f"(roughly {fmt(total, digits, True)} {unit} over the whole period). "
        f"Across the period the yearly average was {fmt(stats['mean'], digits)} {unit}. {verdict} "
        "These figures describe what changed, not why it changed."
    )
    if detail == "simple":
        return simple

    seasonal = result.get("seasonal_check")
    seasonal_text = ""
    if seasonal:
        seasonal_text = (
            f" A Seasonal Mann-Kendall test on the monthly data gives p {p_text(seasonal['p_value'])}"
            f" ({'significant' if seasonal['significant'] else 'not significant'}), "
            f"{'supporting' if seasonal['significant'] == trend['significant'] else 'which differs from'} "
            "the annual result."
        )

    detailed = (
        f"{simple}\n\n"
        f"Key numbers: Sen's slope {fmt(sen['slope_per_year'], digits + 2, True)} {unit}/year "
        f"({int(sen['confidence_level'] * 100)}% CI {fmt(sen['confidence_interval_per_year'][0], digits + 2, True)} "
        f"to {fmt(sen['confidence_interval_per_year'][1], digits + 2, True)}). "
        f"Linear regression {fmt(lin['slope_per_decade'], digits, True)} {unit}/decade, "
        f"R² = {fmt(lin['r_squared'], 2)}, p {p_text(lin['p_value'])}. "
        f"Mann-Kendall: trend '{mk['trend']}', Kendall's tau = {fmt(mk['tau'], 2)}, p {p_text(mk['p_value'])}. "
        f"Yearly values ranged from {fmt(stats['minimum'], digits)} to {fmt(stats['maximum'], digits)} {unit}."
        f"{seasonal_text}"
    )
    if detail == "detailed":
        return detailed

    src = result["source"]
    quality = result["data_quality"]
    return (
        f"{detailed}\n\n"
        f"Data: {src['dataset']} ({src['underlying_product']}), parameter {src['parameter']} "
        f"({src['parameter_name']}), native unit {src['native_unit']}, {src['spatial_resolution']}, "
        f"point {src['location']['latitude']}°N {src['location']['longitude']}°E. "
        f"{quality['valid_months']} of {quality['expected_months']} months valid; "
        f"{quality['complete_years_used']} complete years analysed. "
        f"Method: {mk['test']} at α = {result['alpha']:g}; Theil-Sen slope; OLS regression. "
        "Limitations: " + " ".join(result["limitations"])
    )


def explain_comparison(result, detail="detailed"):
    first, second = result["regions"]
    comparison = result["comparison"]
    unit = result["units"]["annual"]
    rain = result["variable"]["id"] == "rainfall"
    digits = 0 if rain else 2
    start, end = result["period"]["start_year"], result["period"]["end_year"]

    def line(r):
        t = r["trend"]
        return (
            f"{r['region']['name']}: {fmt(t['sens_slope']['slope_per_decade'], digits, True)} {unit}/decade, "
            f"{'significant' if t['significant'] else 'not significant'} "
            f"(Mann-Kendall p {p_text(t['mann_kendall']['p_value'])}), mean {fmt(r['statistics']['mean'], digits)} {unit}"
        )

    if comparison["same_direction"]:
        direction = "Both regions changed in the same direction."
    else:
        direction = "The two regions changed in opposite directions."
    faster = (
        f" {comparison['faster_change']} changed faster."
        if comparison["faster_change"] else ""
    )
    simple = (
        f"Comparing {result['variable']['name'].lower()} from {start} to {end}: {direction}{faster} "
        f"{line(first)}. {line(second)}. "
        "Differences between places can reflect geography (such as distance from the coast), "
        "but these figures alone do not prove the cause."
    )
    if detail == "simple":
        return simple
    return (
        f"{simple}\n\n"
        f"{first['region']['name']} — {explain_investigation(first, detail)}\n\n"
        f"{second['region']['name']} — {explain_investigation(second, detail)}"
    )
