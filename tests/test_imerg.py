"""GPM IMERG (NASA Giovanni) rainfall source — merged from the data branch."""

import importlib

import pytest

from data_ingestion import nasa_client
from services.nasa_service import parse_daily_to_monthly
from tests.conftest import fake_giovanni_csv


def test_client_is_safe_to_import():
    # Importing must not log in, prompt or call the network.
    importlib.reload(nasa_client)


def test_parse_time_series_handles_header_and_fill_values():
    text = fake_giovanni_csv(6.5, 3.4, "2001-01-01T00:00:00", "2001-03-31T23:59:59", "GPM_3IMERGDF_07_precipitation")
    meta, rows = nasa_client.parse_time_series(text)
    assert meta["unit"] == "mm/day"
    assert len(rows) == 90
    assert sum(1 for _, v in rows if v is None) == 1


def test_parse_rejects_bad_responses():
    with pytest.raises(nasa_client.GiovanniError):
        nasa_client.parse_time_series("")
    with pytest.raises(nasa_client.GiovanniError):
        nasa_client.parse_time_series("prod_name,x\nunit,mm\n")


def test_missing_credentials_message(monkeypatch):
    monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)
    monkeypatch.delenv("EARTHDATA_USERNAME", raising=False)
    with pytest.raises(nasa_client.GiovanniError, match="EARTHDATA_TOKEN"):
        nasa_client.get_token()


def test_daily_to_monthly_requires_complete_months():
    values = {f"202001{d:02d}": 1.0 for d in range(1, 32)}
    values.update({f"202002{d:02d}": 2.0 for d in range(1, 10)})  # incomplete
    frame = parse_daily_to_monthly(values)
    assert frame.loc[0, "value"] == 31.0
    assert frame["value"].isna().sum() == 1


def test_imerg_unavailable_without_token(client):
    sources = {s["id"]: s for s in client.get("/api/sources").get_json()}
    assert sources["power"]["available"] is True
    assert sources["imerg"]["available"] is False
    response = client.post("/api/analyze", json={"region": "lagos", "variable": "rainfall", "source": "imerg"})
    assert response.status_code == 400
    assert "Earthdata" in response.get_json()["error"]


@pytest.fixture
def imerg_client(app, client, monkeypatch):
    monkeypatch.setenv("EARTHDATA_TOKEN", "test-token")
    monkeypatch.setattr(nasa_client, "call_time_series", fake_giovanni_csv)
    return client


def test_imerg_analysis(imerg_client):
    response = imerg_client.post("/api/analyze", json={
        "region": "lagos", "variable": "rainfall", "source": "imerg", "start_year": 2001, "end_year": 2025,
    })
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body["source"]["source_id"] == "imerg"
    assert "IMERG" in body["source"]["dataset"]
    assert body["period"]["start_year"] == 2001
    assert body["units"]["annual"] == "mm/year"
    assert any("satellite" in item for item in body["limitations"])


def test_imerg_rejects_temperature_and_early_years(imerg_client):
    assert imerg_client.post("/api/analyze", json={"variable": "temperature", "source": "imerg"}).status_code == 400
    assert imerg_client.post("/api/analyze", json={"variable": "rainfall", "source": "imerg", "start_year": 1990, "end_year": 2000}).status_code == 400


def test_imerg_comparison_and_assistant(imerg_client):
    body = imerg_client.post("/api/compare", json={"variable": "rainfall", "source": "imerg", "start_year": 2005, "end_year": 2025}).get_json()
    assert body["source"]["source_id"] == "imerg" and len(body["regions"]) == 2

    chat = imerg_client.post("/api/assistant/chat", json={"question": "Show GPM satellite rainfall in Edo from 2001 to 2025"}).get_json()
    assert chat["params"]["source"] == "imerg"
    assert chat["analysis"]["source"]["source_id"] == "imerg"
    assert "IMERG" in chat["answer"]
