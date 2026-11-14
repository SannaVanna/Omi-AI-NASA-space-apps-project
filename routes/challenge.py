from flask import Blueprint, jsonify, request

from services.challenge_service import new_challenge, reveal
from services.nasa_service import NasaDataError

challenge_bp = Blueprint("challenge", __name__)


def _body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


@challenge_bp.route("/new", methods=["POST"])
def create():
    data = _body()
    try:
        return jsonify(new_challenge(data.get("region", "random"), data.get("variable", "random")))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except NasaDataError as error:
        return jsonify({"error": f"NASA data is temporarily unavailable: {error}"}), 502


@challenge_bp.route("/answer", methods=["POST"])
def answer():
    data = _body()
    try:
        alpha = float(data.get("alpha") or 0.05)
        if not 0 < alpha < 0.5:
            raise ValueError("Significance level must be between 0 and 0.5.")
        return jsonify(reveal(data.get("challenge_id"), data.get("guess"), alpha=alpha))
    except (TypeError, ValueError) as error:
        return jsonify({"error": str(error)}), 400
    except NasaDataError as error:
        return jsonify({"error": f"NASA data is temporarily unavailable: {error}"}), 502
