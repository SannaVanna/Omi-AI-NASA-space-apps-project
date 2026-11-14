import pandas as pd

from processing.trend_analysis import clean_number
from services.analysis_service import analyze_series
from services.data_service import prepare_time_series


def analyze_uploaded_csv(file, date_column="date", value_column="value",
                         alpha=None, unit="", variable="", region=""):
    try:
        raw = pd.read_csv(file)
    except Exception as error:
        raise ValueError(f"Could not read CSV file: {error}") from error

    total_rows = int(len(raw))
    dataframe = prepare_time_series(raw, date_column, value_column)

    dates = dataframe["date"].dt.strftime("%Y-%m-%d").tolist()
    values = dataframe["value"].astype(float).tolist()

    result = analyze_series(dates, values, alpha=alpha)
    result.update(
        {
            "unit": unit,
            "variable": variable,
            "region": region,
            "date_range": {"start": dates[0], "end": dates[-1]},
            "series": [
                {"date": d, "value": clean_number(v)} for d, v in zip(dates, values)
            ],
            "data_quality": {
                "rows_in_file": total_rows,
                "valid_observations": int(len(dataframe)),
                "rows_removed": total_rows - int(len(dataframe)),
                "date_column": date_column,
                "value_column": value_column,
            },
        }
    )
    return result
