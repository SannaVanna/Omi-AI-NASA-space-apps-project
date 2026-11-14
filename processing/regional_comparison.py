"""Compare trends between two regions."""

from processing.trend_analysis import calculate_trend


def summarise_comparison(name_a, trend_a, name_b, trend_b, unit=""):
    """Build a structured comparison from two calculate_trend() results."""
    slope_a = trend_a["sens_slope"]["slope_per_decade"]
    slope_b = trend_b["sens_slope"]["slope_per_decade"]

    def sign(value):
        if value is None or value == 0:
            return 0
        return 1 if value > 0 else -1

    same_direction = sign(slope_a) == sign(slope_b)
    faster = None
    if slope_a is not None and slope_b is not None and abs(slope_a) != abs(slope_b):
        faster = name_a if abs(slope_a) > abs(slope_b) else name_b

    return {
        "same_direction": same_direction,
        "faster_change": faster,
        "rate_difference_per_decade": (
            None if slope_a is None or slope_b is None else slope_a - slope_b
        ),
        "significant": {
            name_a: trend_a["significant"],
            name_b: trend_b["significant"],
        },
        "unit": unit,
    }


def compare_series(region_a, region_b, alpha=0.05):
    required = ["name", "dates", "values"]

    for region in [region_a, region_b]:
        if not isinstance(region, dict) or not all(key in region for key in required):
            raise ValueError("Each region must contain name, dates and values.")

    trend_a = calculate_trend(region_a["dates"], region_a["values"], alpha=alpha)
    trend_b = calculate_trend(region_b["dates"], region_b["values"], alpha=alpha)

    return {
        "region_a": {"name": region_a["name"], "trend": trend_a},
        "region_b": {"name": region_b["name"], "trend": trend_b},
        "comparison": summarise_comparison(
            region_a["name"], trend_a, region_b["name"], trend_b
        ),
        "note": (
            "Both datasets must use compatible variables, "
            "units, periods and spatial aggregation methods."
        ),
    }
