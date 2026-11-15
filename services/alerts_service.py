"""Weather alerts, route weather and Omi's mood, derived from live forecasts.

Everything here is computed from the live forecast returned by
weather_service (MET Norway, fallback Open-Meteo). Nothing is invented:
when a place's forecast is unavailable it is skipped and reported.
"""

import math
from datetime import datetime, timedelta, timezone

from flask import current_app

from services.weather_service import WeatherUnavailable, get_weather, get_weather_point, resolve_place

LAGOS_TZ = timezone(timedelta(hours=1))

SEVERITY_ORDER = {"severe": 0, "warning": 1, "info": 2}

# Thresholds (mm of rain in one hour, °C, % relative humidity).
HEAVY_RAIN_MM = 5.0
MODERATE_RAIN_MM = 1.0
HEAT_C = 34
HARMATTAN_MONTHS = {11, 12, 1, 2}
HARMATTAN_HUMIDITY = 40


def alerts_for(weather):
    """Turn one place's forecast into a list of alerts (may be empty)."""
    place = weather["region"]["name"]
    out = []
    rain = weather.get("alert") or {}
    look = weather.get("outlook") or {}
    if rain.get("minutes") is not None:
        mm = rain.get("mm") or 0
        peak = max(mm, look.get("max_precip_mm") or 0)
        if peak >= HEAVY_RAIN_MM:
            sev, title = "severe", "Heavy rain warning"
            detail = f"{rain['text']} · up to {peak:g} mm in an hour. Avoid flood-prone roads."
        elif peak >= MODERATE_RAIN_MM:
            sev, title = "warning", "Rain expected"
            detail = f"{rain['text']} · about {peak:g} mm in an hour. Take an umbrella."
        else:
            sev, title = "info", "Light rain possible"
            detail = f"{rain['text']} · light showers ({peak:g} mm)."
        out.append({"severity": sev, "kind": "rain", "title": title, "detail": detail, "at": rain.get("at")})
    if look.get("thunder"):
        out.append({"severity": "warning", "kind": "thunder", "title": "Thunderstorms likely",
                    "detail": "Thunder is in the forecast for the next 12 hours. Stay indoors during lightning.", "at": None})
    if look.get("max_temp") is not None and look["max_temp"] >= HEAT_C:
        out.append({"severity": "warning", "kind": "heat", "title": "Heat advisory",
                    "detail": f"Up to {look['max_temp']} °C today. Drink water and avoid the midday sun.", "at": None})
    month = datetime.now(LAGOS_TZ).month
    if month in HARMATTAN_MONTHS and look.get("min_humidity") is not None and look["min_humidity"] <= HARMATTAN_HUMIDITY:
        out.append({"severity": "info", "kind": "harmattan", "title": "Harmattan conditions",
                    "detail": f"Dry air (humidity down to {look['min_humidity']}%). Protect eyes and skin; drive slowly in haze.", "at": None})
    for a in out:
        a["place"] = place
        a["place_id"] = weather["region"]["id"]
    return out


def collect_alerts(place_ids):
    alerts, places, unavailable = [], [], []
    for pid in place_ids:
        try:
            w = get_weather(pid)
        except ValueError:
            raise
        except WeatherUnavailable:
            unavailable.append(pid)
            continue
        places.append({"id": w["region"]["id"], "name": w["region"]["name"], "current": w["current"]})
        alerts.extend(alerts_for(w))
    alerts.sort(key=lambda a: (SEVERITY_ORDER[a["severity"]], a["place"]))
    return {
        "alerts": alerts,
        "places": places,
        "unavailable": unavailable,
        "counts": {s: sum(1 for a in alerts if a["severity"] == s) for s in SEVERITY_ORDER},
        "generated": datetime.now(LAGOS_TZ).isoformat(timespec="minutes"),
    }


def mood_for(current, outlook=None):
    """Which of Omi's five weather moods fits the current conditions."""
    outlook = outlook or {}
    icon = (current or {}).get("icon", "")
    month = datetime.now(LAGOS_TZ).month
    if icon.startswith("thunder") or outlook.get("thunder"):
        return "stormy"
    if icon.startswith(("rain", "showers", "drizzle")):
        return "rainy"
    if month in HARMATTAN_MONTHS and (outlook.get("min_humidity") or 100) <= HARMATTAN_HUMIDITY:
        return "harmattan"
    if icon.startswith(("cloudy", "fog")):
        return "cloudy"
    return "sunny"


# ------------------------------------------------------------------ routes
ROAD_FACTOR = 1.3      # roads are longer than the straight line
AVERAGE_KMH = 65


def haversine_km(a, b):
    r = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, (a["latitude"], a["longitude"], b["latitude"], b["longitude"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _risk(weather):
    look = weather.get("outlook") or {}
    if look.get("thunder") or (look.get("max_precip_mm") or 0) >= HEAVY_RAIN_MM:
        return "high"
    if (look.get("max_precip_mm") or 0) >= MODERATE_RAIN_MM:
        return "medium"
    return "low"


def route_weather(from_id, to_id, stops=2):
    start, end = resolve_place(from_id), resolve_place(to_id)
    if start["id"] == end["id"]:
        raise ValueError("Pick two different places.")
    points = [start]
    for i in range(1, stops + 1):
        f = i / (stops + 1)
        points.append({
            "id": None,
            "name": f"{round(f * 100)}% of the way",
            "latitude": start["latitude"] + (end["latitude"] - start["latitude"]) * f,
            "longitude": start["longitude"] + (end["longitude"] - start["longitude"]) * f,
        })
    points.append(end)

    segments = []
    for p in points:
        try:
            w = get_weather(p["id"]) if p["id"] else get_weather_point(p["latitude"], p["longitude"], p["name"])
        except WeatherUnavailable:
            segments.append({"name": p["name"], "latitude": p["latitude"], "longitude": p["longitude"], "available": False})
            continue
        segments.append({
            "name": p["name"], "latitude": p["latitude"], "longitude": p["longitude"], "available": True,
            "temperature": w["current"]["temperature"], "condition": w["current"]["condition"],
            "icon": w["current"]["icon"], "rain": (w.get("alert") or {}).get("text"), "risk": _risk(w),
        })

    straight = haversine_km(start, end)
    road_km = straight * ROAD_FACTOR
    risks = [s["risk"] for s in segments if s.get("available")]
    overall = "high" if "high" in risks else "medium" if "medium" in risks else "low"
    advice = {
        "low": "Good conditions along the way. Safe travels!",
        "medium": "Some rain on the way. Drive carefully and allow extra time.",
        "high": "Heavy rain or storms on the route. Consider leaving later or waiting it out.",
    }[overall]
    return {
        "from": {"id": start["id"], "name": start["name"], "latitude": start["latitude"], "longitude": start["longitude"]},
        "to": {"id": end["id"], "name": end["name"], "latitude": end["latitude"], "longitude": end["longitude"]},
        "straight_km": round(straight),
        "estimated_road_km": round(road_km),
        "estimated_hours": round(road_km / AVERAGE_KMH, 1),
        "estimate_note": "Distance and time are estimates (straight line × 1.3 at about 65 km/h), not turn-by-turn directions.",
        "segments": segments,
        "risk": overall,
        "advice": advice,
    }


def places_list():
    return [
        {k: v for k, v in p.items()}
        for p in current_app.config.get("PLACES", {}).values()
    ]
