"""Central analysis engine shared by the dashboard, the text assistant and
the voice assistant. Every interface calls these functions, so all three
get exactly the same data and statistics."""

from flask import current_app

from processing.regional_comparison import compare_series, summarise_comparison
from processing.statistical_analysis import calculate_statistics
from processing.trend_analysis import calculate_trend, clean_number, detect_period
from services.explain import explain_comparison, explain_investigation
from services.nasa_service import fetch_environmental_data, get_region

DETAIL_LEVELS = ("simple", "detailed", "research")


# ---------------------------------------------------------------------------
# Generic series analysis (used by CSV uploads and /api/analysis/*)
# ---------------------------------------------------------------------------

def analyze_series(dates, values, alpha=None, period="auto"):
    alpha = _alpha(alpha)
    if period == "auto":
        import pandas as pd

        parsed = pd.to_datetime(pd.Series(list(dates), dtype="object").astype(str), errors="coerce", format="mixed")
        period = detect_period(parsed.dropna())

    trend = calculate_trend(dates, values, alpha=alpha, period=period)
    statistics = calculate_statistics(values)

    return {"trend": trend, "statistics": statistics}


def compare_regions(region_a, region_b, alpha=None):
    return compare_series(region_a, region_b, alpha=_alpha(alpha))


# ---------------------------------------------------------------------------
# NASA investigations
# ---------------------------------------------------------------------------

def _alpha(alpha):
    if alpha in (None, ""):
        return current_app.config["DEFAULT_ALPHA"]
    try:
        value = float(alpha)
    except (TypeError, ValueError) as error:
        raise ValueError("Significance level (alpha) must be a number.") from error
    if not 0 < value < 0.5:
        raise ValueError("Significance level (alpha) must be between 0 and 0.5.")
    return value


def resolve_period(start_year=None, end_year=None, source_id="power"):
    cfg = current_app.config
    source = cfg["SOURCES"].get(source_id) or cfg["SOURCES"]["power"]
    first = max(cfg["DATA_START_YEAR"], source["start_year"])
    last = cfg["DATA_END_YEAR"]
    try:
        start = int(start_year) if start_year not in (None, "") else first
        end = int(end_year) if end_year not in (None, "") else last
    except (TypeError, ValueError) as error:
        raise ValueError("Start and end years must be whole numbers.") from error

    if start > end:
        start, end = end, start
    if start < first or end > last:
        raise ValueError(
            f"{source['name']} data for this tool covers {first}–{last}. "
            f"Please choose years inside that range."
        )
    if end - start + 1 < cfg["MIN_YEARS"]:
        raise ValueError(
            f"Please choose at least {cfg['MIN_YEARS']} years so a trend can be tested."
        )
    return start, end


def _annual(monthly, aggregation):
    frame = monthly.dropna(subset=["value"]).copy()
    frame["year"] = frame["date"].dt.year
    grouped = frame.groupby("year")["value"]
    counts = grouped.count()
    totals = grouped.sum() if aggregation == "sum" else grouped.mean()
    complete = counts[counts == 12].index
    return totals.loc[complete]


def run_investigation(region_id, variable_id, start_year=None, end_year=None,
                      alpha=None, detail="detailed", source="power"):
    alpha = _alpha(alpha)
    source = str(source or "power").lower()
    start, end = resolve_period(start_year, end_year, source)
    detail = detail if detail in DETAIL_LEVELS else "detailed"

    fetched = fetch_environmental_data(region_id, variable_id, start, end, source)
    region, variable, monthly = fetched["region"], fetched["variable"], fetched["monthly"]

    total_months = (end - start + 1) * 12
    valid_monthly = monthly.dropna(subset=["value"])
    missing_months = total_months - len(valid_monthly)

    annual = _annual(monthly, variable["aggregation"])
    if len(annual) < current_app.config["MIN_YEARS"]:
        raise ValueError("Not enough complete years of data to test a trend.")

    annual_dates = [f"{year}-07-01" for year in annual.index]
    annual_values = [float(v) for v in annual.values]

    # Primary trend: annual series (removes the seasonal cycle).
    trend = calculate_trend(annual_dates, annual_values, alpha=alpha)
    # Seasonal Mann-Kendall on the monthly series as a robustness check.
    monthly_trend = calculate_trend(
        valid_monthly["date"].dt.strftime("%Y-%m-%d").tolist(),
        valid_monthly["value"].tolist(),
        alpha=alpha,
        period=12,
    )

    statistics = calculate_statistics(annual_values)
    statistics["monthly_mean"] = clean_number(valid_monthly["value"].mean())

    # Mean seasonal cycle (climatology) for context.
    climatology = (
        valid_monthly.assign(month=valid_monthly["date"].dt.month)
        .groupby("month")["value"].mean()
    )

    result = {
        "region": region,
        "variable": {
            "id": variable["id"],
            "name": variable["name"],
            "long_name": variable["long_name"],
            "unit": variable["annual_unit"],
            "monthly_unit": variable["monthly_unit"],
            "aggregation": (
                "Annual total of monthly precipitation"
                if variable["aggregation"] == "sum"
                else "Annual mean of monthly temperatures"
            ),
        },
        "period": {"start_year": start, "end_year": end, "years": int(len(annual))},
        "source": fetched["source"],
        "units": {
            "annual": variable["annual_unit"],
            "monthly": variable["monthly_unit"],
            "rate": f"{variable['annual_unit']} per decade",
        },
        "annual_series": [
            {"year": int(y), "date": f"{int(y)}", "value": clean_number(v, 3)}
            for y, v in annual.items()
        ],
        "monthly_series": [
            {"date": d.strftime("%Y-%m"), "value": clean_number(v, 3)}
            for d, v in zip(valid_monthly["date"], valid_monthly["value"])
        ],
        "climatology": [
            {"month": int(m), "value": clean_number(v, 3)} for m, v in climatology.items()
        ],
        "trend": trend,
        "seasonal_check": monthly_trend["seasonal_mann_kendall"],
        "statistics": statistics,
        "data_quality": {
            "expected_months": total_months,
            "valid_months": int(len(valid_monthly)),
            "missing_months": int(missing_months),
            "complete_years_used": int(len(annual)),
        },
        "methodology": [
            f"Monthly {'GPM IMERG' if fetched['source_id'] == 'imerg' else 'NASA POWER'} values are aggregated to one value per complete year "
            "(mean for temperature, total for rainfall) to remove the seasonal cycle.",
            "Linear regression (ordinary least squares) estimates the average rate of change "
            f"with a {int((1 - alpha) * 100)}% confidence interval.",
            "Sen's slope (Theil-Sen estimator) gives a robust rate of change that is "
            "not pulled by single extreme years.",
            "The Mann-Kendall test with the Hamed & Rao autocorrelation correction checks "
            f"for a monotonic trend at the {alpha:g} significance level.",
            "A Seasonal Mann-Kendall test on the monthly series is reported as a robustness check.",
        ],
        "limitations": _limitations(variable, fetched["source_id"]),
        "alpha": alpha,
        "detail": detail,
    }
    result["extremes"] = _extremes(valid_monthly, annual)
    result["explanation"] = explain_investigation(result, detail)
    result["summary"] = explain_investigation(result, "simple")
    return result


def _extremes(valid_monthly, annual):
    """Highest/lowest monthly and yearly values with their dates."""
    out = {}
    if not valid_monthly.empty:
        hi = valid_monthly.loc[valid_monthly["value"].idxmax()]
        lo = valid_monthly.loc[valid_monthly["value"].idxmin()]
        out["highest_month"] = {"date": hi["date"].strftime("%Y-%m"), "value": clean_number(hi["value"], 3)}
        out["lowest_month"] = {"date": lo["date"].strftime("%Y-%m"), "value": clean_number(lo["value"], 3)}
    if len(annual):
        out["highest_year"] = {"year": int(annual.idxmax()), "value": clean_number(annual.max(), 3)}
        out["lowest_year"] = {"year": int(annual.idxmin()), "value": clean_number(annual.min(), 3)}
    return out


def _limitations(variable, source_id="power"):
    if source_id == "imerg":
        first = (
            "GPM IMERG values are satellite-based precipitation estimates for a ~11 km grid cell, "
            "calibrated with rain gauges; they are not measurements from a single gauge."
        )
    else:
        first = (
            "NASA POWER values are model-based reanalysis (MERRA-2) for a ~50 km grid cell, "
            "not measurements from a single weather station, so they smooth local extremes."
        )
    items = [
        first,
        "One representative point is used per region; conditions vary within a state.",
        "A statistical trend shows that a change was observed. It does not prove what caused it.",
        "Statistical significance is not the same as practical importance; look at the size "
        "of the change too.",
    ]
    if variable["id"] == "rainfall":
        items.append(
            "Rainfall varies strongly from year to year, so long periods are needed before "
            "a trend can be distinguished from natural variability."
        )
    return items


def run_comparison(variable_id, start_year=None, end_year=None, regions=None,
                   alpha=None, detail="detailed", source="power"):
    regions = regions or list(current_app.config["REGIONS"].keys())[:2]
    if len(regions) != 2:
        raise ValueError("Comparison needs exactly two regions.")
    if regions[0] == regions[1]:
        raise ValueError("Choose two different regions to compare.")
    for region_id in regions:
        get_region(region_id)

    first = run_investigation(regions[0], variable_id, start_year, end_year, alpha, detail, source)
    second = run_investigation(regions[1], variable_id, start_year, end_year, alpha, detail, source)

    comparison = summarise_comparison(
        first["region"]["name"], first["trend"],
        second["region"]["name"], second["trend"],
        unit=first["units"]["rate"],
    )
    comparison["mean_difference"] = clean_number(
        (first["statistics"]["mean"] or 0) - (second["statistics"]["mean"] or 0)
    )

    result = {
        "variable": first["variable"],
        "period": first["period"],
        "units": first["units"],
        "source": first["source"],
        "regions": [first, second],
        "comparison": comparison,
        "alpha": first["alpha"],
        "detail": first["detail"],
        "limitations": first["limitations"] + [
            "Both regions use the same dataset, variable, units, period and aggregation, "
            "so their trends are directly comparable."
        ],
    }
    result["explanation"] = explain_comparison(result, result["detail"])
    result["summary"] = explain_comparison(result, "simple")
    return result


def compact_result(result):
    """Small, numbers-only summary of a result (sent to the language model)."""
    if "regions" in result:
        return {
            "type": "comparison",
            "variable": result["variable"]["name"],
            "unit": result["units"]["annual"],
            "period": result["period"],
            "regions": [compact_result(r) for r in result["regions"]],
            "comparison": result["comparison"],
            "limitations": result["limitations"],
        }
    trend = result["trend"]
    return {
        "type": "investigation",
        "region": result["region"]["name"],
        "variable": result["variable"]["name"],
        "unit": result["units"]["annual"],
        "period": result["period"],
        "source": result["source"]["dataset"] + " / " + result["source"]["underlying_product"],
        "mean": result["statistics"]["mean"],
        "minimum": result["statistics"]["minimum"],
        "maximum": result["statistics"]["maximum"],
        "first_year_value": result["annual_series"][0]["value"],
        "last_year_value": result["annual_series"][-1]["value"],
        "direction": trend["direction"],
        "sens_slope_per_decade": trend["sens_slope"]["slope_per_decade"],
        "sens_ci_per_year": trend["sens_slope"]["confidence_interval_per_year"],
        "linear_slope_per_decade": trend["linear_regression"]["slope_per_decade"],
        "linear_r_squared": trend["linear_regression"]["r_squared"],
        "linear_p_value": trend["linear_regression"]["p_value"],
        "mann_kendall": trend["mann_kendall"],
        "seasonal_check": result.get("seasonal_check"),
        "alpha": result["alpha"],
        "limitations": result["limitations"],
    }
