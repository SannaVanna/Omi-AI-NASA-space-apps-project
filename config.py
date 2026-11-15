import os
from datetime import date

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "development-secret-change-this")

    DEBUG = os.getenv("FLASK_DEBUG", "false").lower() == "true"

    MAX_CONTENT_LENGTH = 10 * 1024 * 1024

    UPLOAD_FOLDER = os.path.join(BASE_DIR, "data", "raw")
    CACHE_FOLDER = os.path.join(BASE_DIR, "data", "processed")

    # Comma-separated list of origins allowed to call /api/* when the
    # frontend is hosted separately. Empty = same-origin only.
    CORS_ORIGINS = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "").split(",")
        if origin.strip()
    ]

    # --- AI assistant (optional) -------------------------------------------
    # Without a key the assistant still works: it parses requests, runs the
    # real analysis and explains the calculated results with built-in text.
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    # Earthdata Login: only needed for the optional GPM IMERG rainfall source
    # (NASA Giovanni). NASA POWER, the default source, needs no login.
    EARTHDATA_TOKEN = os.getenv("EARTHDATA_TOKEN")

    # Live weather card (MET Norway asks clients to identify themselves).
    WEATHER_USER_AGENT = os.getenv(
        "WEATHER_USER_AGENT", "OmiAI-NASA-SpaceApps/1.0 (NASA Space Apps 2026 project)"
    )

    # --- NASA POWER ----------------------------------------------------------
    NASA_POWER_URL = os.getenv(
        "NASA_POWER_URL",
        "https://power.larc.nasa.gov/api/temporal/monthly/point",
    )
    NASA_POWER_TIMEOUT = int(os.getenv("NASA_POWER_TIMEOUT", "90"))

    # POWER's MERRA-2 based meteorology starts in 1981. The monthly API only
    # publishes complete years, so the last supported year is last year.
    DATA_START_YEAR = 1981
    DATA_END_YEAR = int(os.getenv("DATA_END_YEAR", str(date.today().year - 1)))

    SOURCES = {
        "power": {
            "id": "power",
            "name": "NASA POWER (MERRA-2)",
            "variables": ["temperature", "rainfall"],
            "start_year": 1981,
            "requires_login": False,
        },
        "imerg": {
            "id": "imerg",
            "name": "NASA GPM IMERG (satellite rainfall)",
            "variables": ["rainfall"],
            "start_year": 2001,
            "requires_login": True,
        },
    }

    DEFAULT_ALPHA = 0.05
    MIN_YEARS = 5

    REGIONS = {
        "lagos": {
            "id": "lagos",
            "name": "Lagos State",
            "description": "Coastal urban region, South-West Nigeria",
            "latitude": 6.5244,
            "longitude": 3.3792,
        },
        "edo": {
            "id": "edo",
            "name": "Edo State",
            "description": "Inland forest-transition region, South-South Nigeria",
            "latitude": 6.5438,
            "longitude": 5.8987,
        },
    }

    # Places with live weather only (alerts, saved places, route weather).
    # Climate trend analysis stays limited to REGIONS above.
    PLACES = {
        "lagos": {"id": "lagos", "name": "Lagos", "state": "Lagos", "latitude": 6.5244, "longitude": 3.3792},
        "edo": {"id": "edo", "name": "Benin City", "state": "Edo", "latitude": 6.3350, "longitude": 5.6037},
        "ibadan": {"id": "ibadan", "name": "Ibadan", "state": "Oyo", "latitude": 7.3775, "longitude": 3.9470},
        "abuja": {"id": "abuja", "name": "Abuja", "state": "FCT", "latitude": 9.0765, "longitude": 7.3986},
        "port-harcourt": {"id": "port-harcourt", "name": "Port Harcourt", "state": "Rivers", "latitude": 4.8156, "longitude": 7.0498},
        "kano": {"id": "kano", "name": "Kano", "state": "Kano", "latitude": 12.0022, "longitude": 8.5920},
        "enugu": {"id": "enugu", "name": "Enugu", "state": "Enugu", "latitude": 6.4584, "longitude": 7.5464},
        "lokoja": {"id": "lokoja", "name": "Lokoja", "state": "Kogi", "latitude": 7.8023, "longitude": 6.7333},
        "kaduna": {"id": "kaduna", "name": "Kaduna", "state": "Kaduna", "latitude": 10.5105, "longitude": 7.4165},
        "jos": {"id": "jos", "name": "Jos", "state": "Plateau", "latitude": 9.8965, "longitude": 8.8583},
    }

    VARIABLES = {
        "temperature": {
            "id": "temperature",
            "name": "Temperature",
            "parameter": "T2M",
            "long_name": "Mean air temperature at 2 metres",
            "unit": "°C",
            "monthly_unit": "°C",
            "annual_unit": "°C",
            "aggregation": "mean",
        },
        "rainfall": {
            "id": "rainfall",
            "name": "Rainfall",
            "parameter": "PRECTOTCORR",
            "long_name": "Bias-corrected total precipitation",
            "unit": "mm",
            "monthly_unit": "mm/month",
            "annual_unit": "mm/year",
            "aggregation": "sum",
        },
    }
