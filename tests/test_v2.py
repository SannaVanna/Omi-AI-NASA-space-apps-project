"""Omi AI v2: roles & insight modes, new pages, alerts, route weather, live-weather chat."""

from datetime import datetime, timedelta, timezone

import pytest

from services import alerts_service as al
from services import weather_service as ws
from tests.test_weather import FakeResponse, met_payload


@pytest.fixture(autouse=True)
def reset_cache():
    ws.clear_cache()
    yield
    ws.clear_cache()


@pytest.fixture
def fake_met(monkeypatch):
    def install(rain_at_hour=None, mm=1.2, thunder=False, temp=29.4):
        def fake_get(url, **kwargs):
            payload = met_payload(rain_at_hour=rain_at_hour)
            for i, entry in enumerate(payload["properties"]["timeseries"]):
                entry["data"]["instant"]["details"]["air_temperature"] = temp - i * 0.1
                if rain_at_hour is not None and i == rain_at_hour:
                    entry["data"]["next_1_hours"]["details"]["precipitation_amount"] = mm
                if thunder and i == 2:
                    entry["data"]["next_1_hours"]["summary"]["symbol_code"] = "rainandthunder"
            return FakeResponse(200, payload)
        monkeypatch.setattr(ws.requests, "get", fake_get)
    return install


@pytest.mark.parametrize("path", ["/", "/signup", "/login", "/map", "/alerts", "/route", "/places", "/settings", "/dashboard"])
def test_pages_render(client, path):
    assert client.get(path).status_code == 200


def test_role_sets_default_mode_and_switch(client):
    client.post("/api/profile", json={"name": "Ada", "email": "ada@example.com", "role": "researcher"})
    assert 'data-mode="research"' in client.get("/dashboard").data.decode()
    client.post("/api/profile", json={"name": "Musa", "role": "farmer"})
    # an explicit mode chosen earlier is kept
    assert client.get("/api/profile").get_json()["profile"]["mode"] == "research"
    assert client.post("/api/profile/mode", json={"mode": "simple"}).status_code == 200
    assert 'data-mode="simple"' in client.get("/dashboard").data.decode()
    assert client.post("/api/profile/mode", json={"mode": "expert"}).status_code == 400


def test_new_user_gets_role_mode(client):
    client.post("/api/profile", json={"name": "Tobi", "role": "farmer"})
    assert client.get("/api/profile").get_json()["profile"]["mode"] == "simple"
    client.post("/api/profile/logout")
    assert client.get("/api/profile").get_json()["profile"] == {}


def test_unknown_role_is_normalised(client):
    client.post("/api/profile", json={"name": "X", "role": "wizard"})
    assert client.get("/api/profile").get_json()["profile"]["role"] == "everyday"


def test_places_and_point_weather(client, fake_met):
    fake_met()
    places = client.get("/api/places").get_json()
    assert {"lagos", "edo", "abuja", "kano"} <= {p["id"] for p in places}
    body = client.get("/api/weather?place=abuja").get_json()
    assert body["region"]["name"] == "Abuja" and body["mood"] in {"sunny", "cloudy", "rainy", "stormy", "harmattan"}
    assert "outlook" in body
    assert client.get("/api/weather?lat=7.1&lon=4.2").get_json()["region"]["name"] == "Selected point"
    assert client.get("/api/weather?place=atlantis").status_code == 400


def test_alerts_from_forecast(client, fake_met):
    fake_met(rain_at_hour=2, mm=6.0, thunder=True)
    body = client.get("/api/alerts?places=lagos,abuja").get_json()
    kinds = {(a["kind"], a["severity"]) for a in body["alerts"]}
    assert ("rain", "severe") in kinds and ("thunder", "warning") in kinds
    assert body["counts"]["severe"] == 2 and len(body["places"]) == 2
    assert body["alerts"][0]["severity"] == "severe"
    assert client.get("/api/alerts?places=nowhere").status_code == 400


def test_no_alerts_when_dry(client, fake_met):
    fake_met(temp=30)
    body = client.get("/api/alerts?places=lagos").get_json()
    assert [a for a in body["alerts"] if a["kind"] in ("rain", "thunder", "heat")] == []


def test_heat_alert(client, fake_met):
    fake_met(temp=36)
    kinds = [a["kind"] for a in client.get("/api/alerts?places=kano").get_json()["alerts"]]
    assert "heat" in kinds


def test_route_weather(client, fake_met):
    fake_met()
    r = client.get("/api/route?from=lagos&to=abuja").get_json()
    assert r["from"]["id"] == "lagos" and r["to"]["id"] == "abuja"
    assert len(r["segments"]) == 4 and r["risk"] == "low"
    assert 450 < r["straight_km"] < 600 and r["estimated_hours"] > 5
    assert client.get("/api/route?from=lagos&to=lagos").status_code == 400


def test_haversine():
    a = {"latitude": 6.5244, "longitude": 3.3792}
    b = {"latitude": 9.0765, "longitude": 7.3986}
    assert 520 < al.haversine_km(a, b) < 530


def test_mood_mapping():
    assert al.mood_for({"icon": "thunder"}) == "stormy"
    assert al.mood_for({"icon": "rain"}) == "rainy"
    assert al.mood_for({"icon": "cloudy"}) in ("cloudy", "harmattan")
    assert al.mood_for({"icon": "clear-day"}, {"min_humidity": 90}) == "sunny"


def test_chat_answers_live_weather(client, fake_met):
    fake_met(rain_at_hour=3)
    body = client.post("/api/assistant/chat", json={"question": "Will it rain in Abuja today?"}).get_json()
    assert "Abuja" in body["answer"] and "umbrella" in body["answer"] and "MET Norway" in body["answer"]


def test_chat_trend_question_not_hijacked(app):
    from services.ai_service import _live_weather_answer
    with app.app_context():
        assert _live_weather_answer("what's the weather trend in lagos since 1981?") is None
        assert _live_weather_answer("how has rainfall changed in edo?") is None
