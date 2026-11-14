from flask import Blueprint, jsonify, request, session

profile_bp = Blueprint("profile", __name__)

FIELDS = ("name", "email", "affiliation", "role")
LIST_FIELDS = ("interests", "study_regions")


@profile_bp.route("/", methods=["GET"], strict_slashes=False)
def get_profile():
    return jsonify({"profile": session.get("profile", {}), "authenticated": False})


@profile_bp.route("/", methods=["POST"], strict_slashes=False)
def save_profile():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Send the profile as JSON."}), 400

    profile = {}
    for field in FIELDS:
        value = data.get(field)
        if value is not None:
            profile[field] = str(value).strip()[:200]
    for field in LIST_FIELDS:
        value = data.get(field)
        if isinstance(value, list):
            profile[field] = [str(v)[:100] for v in value][:20]

    email = profile.get("email", "")
    if email and "@" not in email:
        return jsonify({"error": "Please enter a valid email address."}), 400

    # Stored in the signed session cookie until user accounts are added.
    session["profile"] = profile
    return jsonify({"profile": profile, "saved": True})
