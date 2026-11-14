"""Live weather card: parsing, rain-alert algorithm, fallback and caching."""

from datetime import datetime, timedelta, timezone

import pytest

from services import weather_service as ws


def met_payload(rain_at_hour=None, hours=14):
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    series = []
    for i in range(hours):
        t = now + timedelta(hours=i)
        rain = 1.2 if rain_at_hour is not None and i == rain_at_hour else 0.0
        symbol = "rain" if rain else ("partlycloudy_day" if i < 4 else "clearsky_night")
        series.append({
            "time": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "data": {
                "instant": {"details": {"air_temperature": 29.4 - i * 0.3, "relative_humidity": 72.0, "wind_speed": 3.5}},
                "next_1_hours": {"summary": {"symbol_code": symbol}, "details": {"precipitation_amount": rain}},
            },
        })
    return {"properties": {"meta": {"updated_at": now.isoformat()}, "timeseries": series}}


class FakeResponse:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload
        self.content = b"x"

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def reset_cache():
    ws.clear_cache()
    yield
    ws.clear_cache()


def test_weather_from_met(client, monkeypatch):
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        assert "User-Agent" in kwargs["headers"]
        return FakeResponse(200, met_payload(rain_at_hour=3))

    monkeypatch.setattr(ws.requests, "get", fake_get)
    body = client.get("/api/weather?region=lagos").get_json()
    assert body["source"]["name"] == "MET Norway"
    assert body["current"]["temperature"] == 29
    assert body["current"]["humidity"] == 72
    assert body["current"]["wind_kmh"] == 13            # 3.5 m/s -> 12.6 km/h
    assert body["current"]["condition"] == "Partly cloudy"
    assert body["current"]["icon"] == "partly-day"
    assert len(body["hourly"]) == 6
    assert body["alert"]["text"].startswith("Rain likely around")
    # Cached: a second request does not call the API again.
    client.get("/api/weather?region=lagos")
    assert len(calls) == 1


def test_rain_alert_algorithm():
    now = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
    hours = [{"time": now + timedelta(minutes=30 * i), "precipitation": 0.0} for i in range(6)]
    assert ws.rain_alert(hours, now)["minutes"] is None
    hours[1]["precipitation"] = 0.5     # starts in 30 minutes
    alert = ws.rain_alert(hours, now)
    assert alert["minutes"] == 30 and alert["text"] == "Rain in about 30 min"
    hours[0]["precipitation"] = 0.3
    assert ws.rain_alert(hours, now)["text"] == "Rain expected now"
    hours[0]["precipitation"] = 0.1     # below threshold
    assert ws.rain_alert(hours, now)["minutes"] == 30


def test_condition_mapping():
    assert ws.condition_from_met("heavyrainandthunder_night") == ("thunder", False)
    assert ws.condition_from_met("fair_day") == ("mostly_clear", True)
    assert ws.icon_for("clear", False) == "clear-night"
    assert ws.condition_from_wmo(95) == "thunder" and ws.condition_from_wmo(2) == "partly_cloudy"


def test_falls_back_to_open_meteo(client, monkeypatch):
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    times = [(now + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(10)]

    def fake_get(url, **kwargs):
        if "met.no" in url:
            return FakeResponse(503, {})
        return FakeResponse(200, {"hourly": {
            "time": times, "temperature_2m": [27.0] * 10, "relative_humidity_2m": [80] * 10,
            "wind_speed_10m": [9.0] * 10, "precipitation": [0.0] * 10, "weather_code": [61] * 10, "is_day": [1] * 10,
        }})

    monkeypatch.setattr(ws.requests, "get", fake_get)
    body = client.get("/api/weather?region=edo").get_json()
    assert body["source"]["name"] == "Open-Meteo"
    assert body["current"]["condition"] == "Rain" and body["region"]["id"] == "edo"


def test_unavailable_and_bad_region(client, monkeypatch):
    monkeypatch.setattr(ws.requests, "get", lambda url, **kw: FakeResponse(500, {}))
    assert client.get("/api/weather?region=lagos").status_code == 503
    assert client.get("/api/weather?region=mars").status_code == 400


def test_dashboard_has_weather_card(client):
    html = client.get("/dashboard").data.decode()
    assert 'id="weather-hero"' in html and "js/weather.js" in html and "Hi there!" in html
    client.post("/api/profile", json={"name": "Bolaji Adigun"})
    assert "Hi Bolaji!" in client.get("/dashboard").data.decode()
    for icon in ["clear-day", "clear-night", "partly-day", "partly-night", "cloudy", "fog", "drizzle", "rain",
                 "showers-day", "showers-night", "thunder"]:
        assert client.get(f"/static/img/weather/{icon}.svg").status_code == 200
