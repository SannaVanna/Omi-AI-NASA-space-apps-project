"""Trend detection: linear regression, Sen's slope and Mann-Kendall tests."""

import math
import warnings

import numpy as np
import pandas as pd
import pymannkendall as mk
from scipy import stats

SECONDS_PER_YEAR = 365.2425 * 24 * 60 * 60


def clean_number(value, digits=None):
    """Return a JSON-safe float (None for NaN/inf)."""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return round(number, digits) if digits is not None else number


def _prepare(dates, values):
    if dates is None or values is None:
        raise ValueError("Dates and values are required.")
    if isinstance(dates, (str, bytes)) or isinstance(values, (str, bytes)):
        raise ValueError("Dates and values must be lists.")
    try:
        dates = list(dates)
        values = list(values)
    except TypeError as error:
        raise ValueError("Dates and values must be lists.") from error

    if len(dates) != len(values):
        raise ValueError("Dates and values must have equal lengths.")

    frame = pd.DataFrame(
        {
            "date": pd.to_datetime(pd.Series(dates, dtype="object").astype(str), errors="coerce", format="mixed"),
            "value": pd.to_numeric(pd.Series(values, dtype="object"), errors="coerce"),
        }
    )
    frame = frame.replace([np.inf, -np.inf], np.nan).dropna()
    frame = frame.sort_values("date").drop_duplicates("date", keep="last")
    frame = frame.reset_index(drop=True)

    if len(frame) < 3:
        raise ValueError("At least three valid observations (date and value) are required.")
    return frame


def detect_period(dates):
    """Return 12 for monthly data, None otherwise (used for seasonal tests)."""
    if len(dates) < 24:
        return None
    gaps = pd.Series(dates).sort_values().diff().dropna().dt.days
    if gaps.empty:
        return None
    median_gap = gaps.median()
    return 12 if 27 <= median_gap <= 32 else None


def _direction(slope, significant):
    if slope is None or slope == 0:
        return "no clear change"
    word = "increasing" if slope > 0 else "decreasing"
    return word if significant else f"{word} (not statistically significant)"


def _mk_result(result, alpha):
    return {
        "trend": str(result.trend),
        "p_value": clean_number(result.p),
        "z": clean_number(result.z),
        "tau": clean_number(result.Tau),
        "s": clean_number(result.s),
        "significant": bool(clean_number(result.p) is not None and result.p < alpha),
    }


def calculate_trend(dates, values, alpha=0.05, period=None):
    """Analyse a time series.

    * Linear regression (OLS) slope per year with a (1 - alpha) confidence
      interval, R² and p-value.
    * Theil-Sen (Sen's) slope per year with confidence interval.
    * Mann-Kendall test with the Hamed & Rao (1998) variance correction for
      serial autocorrelation (needs >= 10 points; otherwise the original
      test is used). For monthly data (period=12) the Seasonal Mann-Kendall
      test is also reported, because seasonality dominates monthly series.
    """
    alpha = float(alpha)
    if not 0 < alpha < 0.5:
        raise ValueError("Significance level (alpha) must be between 0 and 0.5.")

    frame = _prepare(dates, values)
    x = (frame["date"] - frame["date"].min()).dt.total_seconds().to_numpy() / SECONDS_PER_YEAR
    y = frame["value"].to_numpy(dtype=float)
    n = len(y)

    constant = bool(np.allclose(y, y[0]))
    t_crit = stats.t.ppf(1 - alpha / 2, n - 2) if n > 2 else float("nan")

    if constant or np.allclose(x, x[0]):
        slope = 0.0
        intercept = float(y[0])
        r_squared = p_value = stderr = None
        ci = (None, None)
    else:
        reg = stats.linregress(x, y)
        slope, intercept = float(reg.slope), float(reg.intercept)
        r_squared = clean_number(reg.rvalue ** 2)
        p_value = clean_number(reg.pvalue)
        stderr = clean_number(reg.stderr)
        if stderr is not None and math.isfinite(t_crit):
            ci = (slope - t_crit * stderr, slope + t_crit * stderr)
        else:
            ci = (None, None)

    if constant:
        sen = (0.0, float(y[0]), 0.0, 0.0)
    else:
        sen = stats.theilslopes(y, x, alpha=1 - alpha)

    if constant:
        mk_primary = {
            "test": "Mann-Kendall",
            "trend": "no trend",
            "p_value": 1.0,
            "z": 0.0,
            "tau": 0.0,
            "s": 0.0,
            "significant": False,
        }
    else:
        mk_primary = None
        if n >= 10:
            with warnings.catch_warnings(), np.errstate(all="ignore"):
                warnings.simplefilter("ignore")
                corrected = mk.hamed_rao_modification_test(y)
            # The correction is undefined for perfectly regular series
            # (zero residual variance); fall back to the original test then.
            if clean_number(corrected.p) is not None:
                mk_primary = {"test": "Modified Mann-Kendall (Hamed & Rao, autocorrelation-corrected)"}
                mk_primary.update(_mk_result(corrected, alpha))
        if mk_primary is None:
            mk_primary = {"test": "Mann-Kendall (original)"}
            mk_primary.update(_mk_result(mk.original_test(y), alpha))

    seasonal = None
    if period and not constant and n >= 2 * period:
        seasonal = {"test": f"Seasonal Mann-Kendall (period={period})"}
        with warnings.catch_warnings(), np.errstate(all="ignore"):
            warnings.simplefilter("ignore")
            seasonal.update(_mk_result(mk.seasonal_test(y, period=period), alpha))
        # pymannkendall's seasonal Sen slope is per season-step (per year here)
        seasonal["sen_slope_per_year"] = clean_number(mk.seasonal_sens_slope(y, period=period).slope)

    fitted = intercept + slope * x
    sen_slope = clean_number(sen[0])
    significant = bool(mk_primary["significant"])

    return {
        "direction": _direction(sen_slope if sen_slope is not None else slope, significant),
        "significant": significant,
        "alpha": alpha,
        "observations": int(n),
        "start_date": frame["date"].min().strftime("%Y-%m-%d"),
        "end_date": frame["date"].max().strftime("%Y-%m-%d"),
        "linear_regression": {
            "slope_per_year": clean_number(slope),
            "slope_per_decade": clean_number(slope * 10),
            "intercept": clean_number(intercept),
            "confidence_interval_per_year": [clean_number(ci[0]), clean_number(ci[1])],
            "confidence_level": 1 - alpha,
            "r_squared": r_squared,
            "p_value": p_value,
            "standard_error": stderr,
            "significant": bool(p_value is not None and p_value < alpha),
        },
        "sens_slope": {
            "slope_per_year": sen_slope,
            "slope_per_decade": clean_number(sen[0] * 10),
            "confidence_interval_per_year": [clean_number(sen[2]), clean_number(sen[3])],
            "confidence_level": 1 - alpha,
        },
        "mann_kendall": mk_primary,
        "seasonal_mann_kendall": seasonal,
        "trend_line": [
            {"date": d.strftime("%Y-%m-%d"), "value": clean_number(v)}
            for d, v in zip(frame["date"], fitted)
        ],
        # Kept for backwards compatibility with earlier API consumers.
        "slope_per_year": clean_number(slope),
        "r_squared": r_squared,
        "p_value": p_value,
        "method": "Linear regression + Sen's slope + Mann-Kendall",
    }
