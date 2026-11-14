from flask import Blueprint, current_app, jsonify, request

from services.analysis_service import run_comparison, run_investigation
from services.nasa_service import NasaDataError, available_sources
from services.weather_service import WeatherUnavailable, get_weather

regions_bp = Blueprint("regions", __name__)


def _json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _error(error, status=400):
    return jsonify({"error": str(error)}), status


@regions_bp.route("/regions", methods=["GET"])
def get_regions():
    return jsonify(list(current_app.config["REGIONS"].values()))


@regions_bp.route("/variables", methods=["GET"])
def get_variables():
    return jsonify([
        {
            "id": v["id"],
            "name": v["name"],
            "unit": v["unit"],
            "annual_unit": v["annual_unit"],
            "monthly_unit": v["monthly_unit"],
            "parameter": v["parameter"],
            "description": v["long_name"],
        }
        for v in current_app.config["VARIABLES"].values()
    ])


@regions_bp.route("/coverage", methods=["GET"])
def get_coverage():
    cfg = current_app.config
    return jsonify({
        "start_year": cfg["DATA_START_YEAR"],
        "end_year": cfg["DATA_END_YEAR"],
        "min_years": cfg["MIN_YEARS"],
        "dataset": "NASA POWER Monthly & Annual API (MERRA-2 based)",
        "temporal_resolution": "Monthly",
        "sources": available_sources(),
    })


@regions_bp.route("/sources", methods=["GET"])
def get_sources():
    return jsonify(available_sources())


@regions_bp.route("/data", methods=["GET"])
def get_data():
    """Historical records (monthly + annual) for one region and variable."""
    args = request.args
    try:
        result = run_investigation(
            args.get("region", "lagos"),
            args.get("variable", "temperature"),
            args.get("start"),
            args.get("end"),
            detail="simple",
            source=args.get("source", "power"),
        )
    except ValueError as error:
        return _error(error)
    except NasaDataError as error:
        return _error(error, 502)

    return jsonify({
        "region": result["region"],
        "variable": result["variable"],
        "period": result["period"],
        "units": result["units"],
        "source": result["source"],
        "data_quality": result["data_quality"],
        "annual_series": result["annual_series"],
        "monthly_series": result["monthly_series"],
    })


@regions_bp.route("/analyze", methods=["POST"])
def analyze():
    data = _json_body()
    try:
        result = run_investigation(
            data.get("region", "lagos"),
            data.get("variable", "temperature"),
            data.get("start_year"),
            data.get("end_year"),
            alpha=data.get("alpha"),
            detail=data.get("detail", "detailed"),
            source=data.get("source", "power"),
        )
    except ValueError as error:
        return _error(error)
    except NasaDataError as error:
        return _error(error, 502)
    return jsonify(result)


@regions_bp.route("/compare", methods=["POST"])
def compare():
    data = _json_body()
    regions = data.get("regions")
    if regions is not None and not isinstance(regions, list):
        return _error("'regions' must be a list of two region ids.")
    try:
        result = run_comparison(
            data.get("variable", "temperature"),
            data.get("start_year"),
            data.get("end_year"),
            regions=regions,
            alpha=data.get("alpha"),
            detail=data.get("detail", "detailed"),
            source=data.get("source", "power"),
        )
    except ValueError as error:
        return _error(error)
    except NasaDataError as error:
        return _error(error, 502)
    return jsonify(result)


@regions_bp.route("/weather", methods=["GET"])
def weather():
    """Live weather for the dashboard card (MET Norway, fallback Open-Meteo)."""
    try:
        return jsonify(get_weather(request.args.get("region", "lagos")))
    except ValueError as error:
        return _error(error)
    except WeatherUnavailable as error:
        return _error(error, 503)
