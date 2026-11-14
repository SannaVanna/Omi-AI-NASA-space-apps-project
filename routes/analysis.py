"""Analysis of caller-supplied series (no NASA retrieval)."""

from flask import Blueprint, jsonify, request

from services.analysis_service import analyze_series, compare_regions

analysis_bp = Blueprint("analysis", __name__)


def _json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


@analysis_bp.route("/trend", methods=["POST"])
def trend_analysis():
    data = _json_body()
    try:
        result = analyze_series(data["dates"], data["values"], alpha=data.get("alpha"))
        return jsonify(result)
    except KeyError as error:
        return jsonify({"error": f"Missing field: {error.args[0]}"}), 400
    except (TypeError, ValueError) as error:
        return jsonify({"error": str(error)}), 400


@analysis_bp.route("/compare", methods=["POST"])
def regional_comparison():
    data = _json_body()
    try:
        result = compare_regions(data["region_a"], data["region_b"], alpha=data.get("alpha"))
        return jsonify(result)
    except KeyError as error:
        return jsonify({"error": f"Missing field: {error.args[0]}"}), 400
    except (TypeError, ValueError) as error:
        return jsonify({"error": str(error)}), 400
