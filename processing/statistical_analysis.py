"""Descriptive statistics for a series of measurements."""

import numpy as np

from processing.trend_analysis import clean_number


def calculate_statistics(values):
    try:
        array = np.asarray(list(values), dtype=float)
    except (TypeError, ValueError) as error:
        raise ValueError("Values must be numeric.") from error

    array = array[np.isfinite(array)]

    if len(array) < 3:
        raise ValueError("At least three valid values are required.")

    return {
        "count": int(len(array)),
        "mean": clean_number(np.mean(array)),
        "median": clean_number(np.median(array)),
        "minimum": clean_number(np.min(array)),
        "maximum": clean_number(np.max(array)),
        "standard_deviation": clean_number(np.std(array, ddof=1)),
    }
