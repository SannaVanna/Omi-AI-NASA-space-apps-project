import json
import math

import pytest

from processing.statistical_analysis import calculate_statistics
from processing.trend_analysis import calculate_trend


def test_trend_detects_increase():
    result = calculate_trend(
        ["2020-01-01", "2021-01-01", "2022-01-01", "2023-01-01"], [10, 11, 12, 13]
    )
    assert result["direction"].startswith("increasing")
    assert result["sens_slope"]["slope_per_year"] == pytest.approx(1.0, rel=0.01)


def test_unsorted_input_is_sorted_before_testing():
    dates = [f"{y}-01-01" for y in range(2000, 2015)]
    values = list(range(15))
    shuffled = list(zip(dates, values))[::-1]
    result = calculate_trend([d for d, _ in shuffled], [v for _, v in shuffled])
    assert result["mann_kendall"]["trend"] == "increasing"
    assert result["significant"] is True


def test_constant_series_is_json_safe():
    result = calculate_trend(["2020", "2021", "2022"], [5, 5, 5])
    text = json.dumps(result, allow_nan=False)  # raises if NaN/inf leak out
    assert result["direction"] == "no clear change"
    assert "NaN" not in text


def test_invalid_rows_are_dropped_consistently():
    result = calculate_trend(
        ["2020-01-01", "bad", "2021-01-01", "2022-01-01", None, "2023-01-01"],
        [1, 2, "x", 4, 5, 6],
    )
    # Only rows with BOTH a valid date and a valid value are kept.
    assert result["observations"] == 3


def test_too_few_points_raises():
    with pytest.raises(ValueError):
        calculate_trend(["2020", "bad"], [1, 2])


def test_seasonal_test_runs_for_monthly_data():
    dates = [f"{2000 + i // 12}-{i % 12 + 1:02d}-01" for i in range(120)]
    values = [math.sin(i / 12 * 2 * math.pi) * 3 + i * 0.01 for i in range(120)]
    result = calculate_trend(dates, values, period=12)
    assert result["seasonal_mann_kendall"]["test"].startswith("Seasonal")
    assert result["seasonal_mann_kendall"]["significant"] is True


def test_alpha_is_validated():
    with pytest.raises(ValueError):
        calculate_trend(["2020", "2021", "2022"], [1, 2, 3], alpha=0.9)


def test_statistics_count():
    result = calculate_statistics([2, 3, 4, 5])
    assert result["count"] == 4
    assert result["minimum"] == 2 and result["maximum"] == 5


def test_trend_endpoint(client):
    response = client.post("/api/analysis/trend", json={"dates": ["2020", "2021", "2022", "2023"], "values": [1, 2, 3, 5]})
    assert response.status_code == 200
    body = response.get_json()
    assert "trend" in body and "statistics" in body


@pytest.mark.parametrize("payload", [{}, {"dates": 5, "values": 5}, {"dates": ["2020"], "values": [1, 2]}])
def test_trend_endpoint_rejects_bad_input(client, payload):
    response = client.post("/api/analysis/trend", json=payload)
    assert response.status_code == 400
    assert "error" in response.get_json()


def test_raw_compare_endpoint(client):
    region = {"dates": ["2020", "2021", "2022", "2023"], "values": [1, 2, 3, 4]}
    response = client.post("/api/analysis/compare", json={
        "region_a": {"name": "A", **region},
        "region_b": {"name": "B", "dates": region["dates"], "values": [4, 3, 2, 1]},
    })
    assert response.status_code == 200
    assert response.get_json()["comparison"]["same_direction"] is False
