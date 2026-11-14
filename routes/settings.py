from flask import Blueprint, jsonify, request, session

settings_bp = Blueprint("settings", __name__)

DEFAULTS = {
    "theme": "light",
    "temp_unit": "°C",
    "rain_unit": "mm",
    "default_region": "lagos",
    "alpha": "0.05",
}
ALLOWED = {
    "theme": {"light", "dark", "system"},
    "default_region": {"lagos", "edo", "both"},
    "temp_unit": {"°C", "K"},
    "rain_unit": {"mm", "mm/day"},
    "alpha": {"0.01", "0.05", "0.1", "0.10"},
}


@settings_bp.route("/", methods=["GET"], strict_slashes=False)
def get_settings():
    return jsonify({**DEFAULTS, **session.get("settings", {})})


@settings_bp.route("/", methods=["POST"], strict_slashes=False)
def save_settings():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Send settings as JSON."}), 400

    settings = dict(session.get("settings", {}))
    for key in DEFAULTS:
        if key not in data:
            continue
        value = str(data[key])[:20]
        if key in ALLOWED and value not in ALLOWED[key]:
            return jsonify({"error": f"Invalid value for {key}."}), 400
        settings[key] = value

    session["settings"] = settings
    return jsonify({**DEFAULTS, **settings, "saved": True})
