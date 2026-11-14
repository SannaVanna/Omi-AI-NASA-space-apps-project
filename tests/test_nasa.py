from services.nasa_service import parse_power_monthly


def test_parse_skips_annual_and_fill_values_and_converts_rain():
    frame = parse_power_monthly({"202001": 2.0, "202002": -999.0, "202013": 9.9}, "PRECTOTCORR")
    assert len(frame) == 2
    assert frame.loc[0, "value"] == 62.0  # 2 mm/day x 31 days
    assert frame["value"].isna().sum() == 1


def test_analyze_returns_full_structure(client):
    response = client.post("/api/analyze", json={
        "region": "lagos", "variable": "temperature", "start_year": 2001, "end_year": 2025, "detail": "research",
    })
    assert response.status_code == 200
    body = response.get_json()
    assert body["region"]["id"] == "lagos"
    assert body["period"] == {"start_year": 2001, "end_year": 2025, "years": 25}
    assert len(body["annual_series"]) == 25
    assert len(body["monthly_series"]) == 300
    assert body["source"]["parameter"] == "T2M"
    assert body["trend"]["sens_slope"]["slope_per_decade"] > 0
    assert body["trend"]["significant"] is True
    assert body["limitations"] and body["explanation"]
    assert "NASA POWER" in body["explanation"]


def test_data_is_cached_after_first_request(app, client):
    for _ in range(3):
        client.post("/api/analyze", json={"region": "edo", "variable": "rainfall", "start_year": 1990, "end_year": 2020})
    assert app.power_calls.count(("edo", "PRECTOTCORR")) == 1


def test_rainfall_annual_totals(client):
    body = client.post("/api/analyze", json={"region": "lagos", "variable": "rainfall"}).get_json()
    assert body["units"]["annual"] == "mm/year"
    assert body["period"]["start_year"] == 1981 and body["period"]["end_year"] == 2025
    assert 500 < body["statistics"]["mean"] < 4000


def test_compare_endpoint(client):
    response = client.post("/api/compare", json={"variable": "temperature", "start_year": 1990, "end_year": 2025})
    assert response.status_code == 200
    body = response.get_json()
    assert [r["region"]["id"] for r in body["regions"]] == ["lagos", "edo"]
    assert body["comparison"]["faster_change"] == "Lagos State"


def test_data_endpoint(client):
    body = client.get("/api/data?region=edo&variable=temperature&start=2010&end=2020").get_json()
    assert len(body["annual_series"]) == 11


def test_invalid_requests(client):
    assert client.post("/api/analyze", json={"region": "mars"}).status_code == 400
    assert client.post("/api/analyze", json={"variable": "wind"}).status_code == 400
    assert client.post("/api/analyze", json={"start_year": 1950, "end_year": 2000}).status_code == 400
    assert client.post("/api/analyze", json={"start_year": 2020, "end_year": 2022}).status_code == 400
    assert client.post("/api/compare", json={"regions": ["lagos", "lagos"]}).status_code == 400
    assert client.post("/api/compare", json={"regions": "lagos"}).status_code == 400
