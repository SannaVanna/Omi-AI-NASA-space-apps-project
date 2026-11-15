from flask import Blueprint, jsonify, request, session

profile_bp = Blueprint("profile", __name__)

FIELDS = ("name", "email", "affiliation", "role")

# Role chosen at sign-up -> default insight mode. Users can switch any time.
ROLES = {
    "student": "learn",
    "researcher": "research",
    "educator": "learn",
    "policy": "research",
    "farmer": "simple",
    "everyday": "simple",
}
MODES = ("simple", "learn", "research")


def default_mode(role):
    return ROLES.get(role or "", "learn")
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

    role = profile.get("role")
    if role and role not in ROLES:
        profile["role"] = "everyday"
    mode = str(data.get("mode") or "").lower()
    profile["mode"] = mode if mode in MODES else (session.get("profile", {}).get("mode") or default_mode(profile.get("role")))

    email = profile.get("email", "")
    if email and "@" not in email:
        return jsonify({"error": "Please enter a valid email address."}), 400

    # Stored in the signed session cookie until user accounts are added.
    session["profile"] = profile
    return jsonify({"profile": profile, "saved": True})


@profile_bp.route("/mode", methods=["POST"])
def set_mode():
    """Switch between Simple, Learn and Research views."""
    data = request.get_json(silent=True) or {}
    mode = str(data.get("mode") or "").lower()
    if mode not in MODES:
        return jsonify({"error": "Mode must be simple, learn or research."}), 400
    profile = dict(session.get("profile") or {})
    profile["mode"] = mode
    session["profile"] = profile
    return jsonify({"mode": mode, "saved": True})


@profile_bp.route("/logout", methods=["POST"])
def logout():
    session.pop("profile", None)
    return jsonify({"logged_out": True})
