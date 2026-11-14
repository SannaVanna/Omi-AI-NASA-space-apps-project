"""Live weather for the dashboard's Omi weather card.

Primary source: MET Norway Locationforecast 2.0 (free, no API key; needs an
identifying User-Agent). Fallback: Open-Meteo (free, no API key).
Results are cached per region for 15 minutes; if both sources fail, the
last good forecast is returned and marked as stale.

This is *current weather*, shown for context. All trend analysis in Omi AI
still uses NASA POWER climate records.
"""

import threading
import time
from datetime import datetime, timedelta, timezone

import requests
from flask import current_app

from services.nasa_service import get_region

LAGOS_TZ = timezone(timedelta(hours=1))  # West Africa Time (no DST)
CACHE_TTL = 15 * 60
RAIN_THRESHOLD_MM = 0.2

_cache = {}
_lock = threading.Lock()


class WeatherUnavailable(Exception):
    pass


# ---------------------------------------------------------------- conditions
# Normalised condition -> (label, icon key). Icon keys map to
# static/img/weather/<key>-<day|night>.svg (or <key>.svg when time-neutral).
CONDITIONS = {
    "clear": ("Clear sky", "clear"),
    "mostly_clear": ("Mostly sunny", "partly"),
    "partly_cloudy": ("Partly cloudy", "partly"),
    "cloudy": ("Cloudy", "cloudy"),
    "fog": ("Foggy", "fog"),
    "drizzle": ("Light drizzle", "drizzle"),
    "rain": ("Rain", "rain"),
    "heavy_rain": ("Heavy rain", "rain"),
    "showers": ("Rain showers", "showers"),
    "thunder": ("Thunderstorms", "thunder"),
}

MET_SYMBOLS = {
    "clearsky": "clear", "fair": "mostly_clear", "partlycloudy": "partly_cloudy", "cloudy": "cloudy",
    "fog": "fog", "lightrain": "drizzle", "rain": "rain", "heavyrain": "heavy_rain",
    "lightrainshowers": "showers", "rainshowers": "showers", "heavyrainshowers": "showers",
    "lightsleet": "rain", "sleet": "rain", "heavysleet": "rain",
}


def condition_from_met(symbol):
    symbol = str(symbol or "cloudy")
    is_day = not symbol.endswith("_night")
    base = symbol.split("_")[0]
    if "thunder" in base:
        key = "thunder"
    else:
        key = MET_SYMBOLS.get(base, "cloudy")
    return key, is_day


def condition_from_wmo(code):
    code = int(code or 3)
    if code == 0:
        return "clear"
    if code == 1:
        return "mostly_clear"
    if code == 2:
        return "partly_cloudy"
    if code == 3:
        return "cloudy"
    if code in (45, 48):
        return "fog"
    if 51 <= code <= 57:
        return "drizzle"
    if code in (61, 63, 66):
        return "rain"
    if code in (65, 67):
        return "heavy_rain"
    if 80 <= code <= 82:
        return "showers"
    if code >= 95:
        return "thunder"
    return "cloudy"


def icon_for(key, is_day):
    icon = CONDITIONS[key][1]
    if icon in ("clear", "partly", "showers"):
        return f"{icon}-{'day' if is_day else 'night'}"
    return icon


# ------------------------------------------------------------------- algorithm
def rain_alert(hours, now):
    """Find when rain is next expected.

    ``hours`` is a time-ordered list of dicts with ``time`` (aware datetime,
    start of the hour) and ``precipitation`` (mm expected during that hour).
    Returns a short message, the minutes until rain (or None) and the hour.
    Linear scan over at most 12 hours, so O(n).
    """
    for hour in hours[:12]:
        mm = hour.get("precipitation") or 0
        if mm >= RAIN_THRESHOLD_MM:
            minutes = max(0, int((hour["time"] - now).total_seconds() // 60))
            local = hour["time"].astimezone(LAGOS_TZ)
            label = local.strftime("%I %p").lstrip("0")
            if minutes <= 10:
                text = "Rain expected now"
            elif minutes < 60:
                text = f"Rain in about {round(minutes / 5) * 5} min"
            else:
                text = f"Rain likely around {label}"
            return {"text": text, "minutes": minutes, "at": local.isoformat(), "mm": round(mm, 1)}
    return {"text": "No rain expected in the next 12 hours", "minutes": None, "at": None, "mm": 0}


# --------------------------------------------------------------------- sources
def _user_agent():
    return current_app.config.get("WEATHER_USER_AGENT") or "OmiAI-NASA-SpaceApps/1.0"


def _from_met(region):
    response = requests.get(
        "https://api.met.no/weatherapi/locationforecast/2.0/compact",
        params={"lat": round(region["latitude"], 4), "lon": round(region["longitude"], 4)},
        headers={"User-Agent": _user_agent()},
        timeout=15,
    )
    if response.status_code != 200:
        raise WeatherUnavailable(f"MET Norway returned HTTP {response.status_code}")
    data = response.json()
    series = data["properties"]["timeseries"]
    now = datetime.now(timezone.utc)

    hours = []
    for entry in series:
        t = datetime.fromisoformat(entry["time"].replace("Z", "+00:00"))
        details = entry["data"]["instant"]["details"]
        nxt = entry["data"].get("next_1_hours") or entry["data"].get("next_6_hours") or {}
        key, is_day = condition_from_met((nxt.get("summary") or {}).get("symbol_code"))
        hours.append({
            "time": t,
            "temperature": details.get("air_temperature"),
            "humidity": details.get("relative_humidity"),
            "wind_kmh": None if details.get("wind_speed") is None else details["wind_speed"] * 3.6,
            "precipitation": (nxt.get("details") or {}).get("precipitation_amount"),
            "condition": key,
            "is_day": is_day,
        })
    # Current = the latest hour that has started.
    started = [h for h in hours if h["time"] <= now + timedelta(minutes=5)]
    current_index = hours.index(started[-1]) if started else 0
    return {
        "hours": hours[current_index:],
        "updated": data["properties"]["meta"].get("updated_at"),
        "source": {
            "name": "MET Norway",
            "url": "https://api.met.no/",
            "attribution": "Weather forecast from MET Norway (CC BY 4.0)",
        },
    }


def _from_open_meteo(region):
    response = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": region["latitude"], "longitude": region["longitude"],
            "hourly": "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code,is_day",
            "forecast_hours": 24, "past_hours": 1, "timezone": "UTC", "wind_speed_unit": "kmh",
        },
        headers={"User-Agent": _user_agent()},
        timeout=15,
    )
    data = response.json() if response.content else {}
    if response.status_code != 200 or data.get("error"):
        raise WeatherUnavailable(data.get("reason") or f"Open-Meteo returned HTTP {response.status_code}")
    h = data["hourly"]
    now = datetime.now(timezone.utc)
    hours = []
    for i, stamp in enumerate(h["time"]):
        t = datetime.fromisoformat(stamp).replace(tzinfo=timezone.utc)
        hours.append({
            "time": t,
            "temperature": h["temperature_2m"][i],
            "humidity": h["relative_humidity_2m"][i],
            "wind_kmh": h["wind_speed_10m"][i],
            "precipitation": h["precipitation"][i],
            "condition": condition_from_wmo(h["weather_code"][i]),
            "is_day": bool(h["is_day"][i]),
        })
    started = [x for x in hours if x["time"] <= now + timedelta(minutes=5)]
    current_index = hours.index(started[-1]) if started else 0
    return {
        "hours": hours[current_index:],
        "updated": now.isoformat(timespec="minutes"),
        "source": {"name": "Open-Meteo", "url": "https://open-meteo.com/", "attribution": "Weather data by Open-Meteo.com (CC BY 4.0)"},
    }


def _shape(region, raw):
    now = datetime.now(timezone.utc)
    hours = [h for h in raw["hours"] if h.get("temperature") is not None]
    if not hours:
        raise WeatherUnavailable("The forecast contained no usable hours.")
    current = hours[0]
    label = CONDITIONS[current["condition"]][0]

    def hour_view(h):
        local = h["time"].astimezone(LAGOS_TZ)
        return {
            "time": local.isoformat(),
            "label": local.strftime("%I %p").lstrip("0"),
            "temperature": round(h["temperature"]),
            "icon": icon_for(h["condition"], h["is_day"]),
            "condition": CONDITIONS[h["condition"]][0],
            "precipitation": None if h.get("precipitation") is None else round(h["precipitation"], 1),
        }

    return {
        "region": {"id": region["id"], "name": region["name"], "latitude": region["latitude"], "longitude": region["longitude"]},
        "current": {
            "temperature": round(current["temperature"]),
            "temperature_exact": current["temperature"],
            "humidity": None if current.get("humidity") is None else round(current["humidity"]),
            "wind_kmh": None if current.get("wind_kmh") is None else round(current["wind_kmh"]),
            "condition": label,
            "icon": icon_for(current["condition"], current["is_day"]),
            "is_day": current["is_day"],
        },
        "hourly": [hour_view(h) for h in hours[1:7]],
        "alert": rain_alert(hours, now),
        "updated": raw.get("updated"),
        "source": raw["source"],
        "note": "Current weather for context. Climate trends in Omi AI use NASA POWER records.",
    }


def get_weather(region_id):
    region = get_region(region_id)
    key = region["id"]
    with _lock:
        cached = _cache.get(key)
        if cached and time.time() - cached["at"] < CACHE_TTL:
            return dict(cached["data"], cached=True)

    errors = []
    for source in (_from_met, _from_open_meteo):
        try:
            data = _shape(region, source(region))
            with _lock:
                _cache[key] = {"at": time.time(), "data": data}
            return dict(data, cached=False)
        except Exception as error:  # try the next source
            errors.append(f"{source.__name__}: {error}")
            current_app.logger.warning("Weather source failed: %s", error)

    with _lock:
        cached = _cache.get(key)
    if cached:
        return dict(cached["data"], cached=True, stale=True)
    raise WeatherUnavailable("Live weather is unavailable right now.")


def clear_cache():
    with _lock:
        _cache.clear()
