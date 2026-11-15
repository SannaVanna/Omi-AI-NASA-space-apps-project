import os

from flask import Flask, abort, jsonify, render_template, request, send_from_directory, session
from werkzeug.exceptions import HTTPException

from config import Config
from routes import register_blueprints


def create_app(config_overrides=None):
    app = Flask(__name__)
    app.config.from_object(Config)
    if config_overrides:
        app.config.update(config_overrides)

    os.makedirs(app.config["CACHE_FOLDER"], exist_ok=True)

    register_blueprints(app)

    if app.config.get("CORS_ORIGINS"):
        from flask_cors import CORS

        CORS(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})

    img_dir = os.path.join(app.static_folder, "img")

    def first_image(stem, fallback):
        # Drop e.g. static/img/omi-mascot.png or static/img/avatar.jpg into the
        # repo to replace the built-in illustrations without code changes.
        for ext in ("png", "webp", "jpg", "jpeg"):
            if os.path.exists(os.path.join(img_dir, f"{stem}.{ext}")):
                return f"img/{stem}.{ext}"
        return fallback

    from routes.profile import MODES, ROLES, default_mode

    role_labels = {
        "student": ("Student", "Visual charts and clear explanations"),
        "researcher": ("Researcher / Scientist", "Full statistics, methods and data export"),
        "educator": ("Educator", "Teaching-ready visuals and quizzes"),
        "policy": ("Policy & Planning", "Risk summaries and regional comparisons"),
        "farmer": ("Farmer / Agriculture", "Rain timing and seasonal outlooks"),
        "everyday": ("Everyday user", "Simple weather and safety tips"),
    }

    @app.context_processor
    def inject_profile():
        # Shown in the sidebar user card and top bar on every workspace page.
        profile = session.get("profile") or {}
        mode = profile.get("mode")
        if mode not in MODES:
            mode = default_mode(profile.get("role"))
        return {
            "current_profile": profile,
            "insight_mode": mode,
            "role_labels": role_labels,
            "role_modes": ROLES,
            "signed_in": bool(profile.get("name")),
            "mascot_image": first_image("omi-mascot", "img/omi-mascot.svg"),
            "avatar_image": first_image("avatar", "img/avatar-default.svg"),
        }

    @app.route("/")
    def landing():
        return render_template("landing.html")

    @app.route("/dashboard")
    def dashboard():
        return render_template("dashboard.html")

    @app.route("/compare")
    def compare():
        return render_template("compare.html")

    @app.route("/challenge")
    def challenge():
        return render_template("challenge.html")

    @app.route("/assistant")
    def assistant():
        return render_template("assistant.html")

    @app.route("/profile")
    def profile():
        return render_template("profile.html", user=session.get("profile"))

    @app.route("/settings")
    def settings():
        return render_template("settings.html")

    @app.route("/signup")
    def signup():
        return render_template("signup.html")

    @app.route("/login")
    def login():
        return render_template("login.html")

    @app.route("/map")
    def map_radar():
        return render_template("map.html")

    @app.route("/alerts")
    def alerts_page():
        return render_template("alerts.html")

    @app.route("/route")
    def route_page():
        return render_template("route.html")

    @app.route("/places")
    def places_page():
        return render_template("places.html")

    @app.route("/upload")
    def upload():
        return render_template("upload.html")

    @app.route("/samples/<path:name>")
    def sample_file(name):
        folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "sample")
        if not name.endswith(".csv"):
            abort(404)
        return send_from_directory(folder, name, as_attachment=True)

    @app.route("/health")
    def health():
        return {
            "status": "ok",
            "application": "Omi AI",
            "ai_model": "gemini" if app.config.get("GOOGLE_API_KEY") else "built-in",
        }

    @app.errorhandler(HTTPException)
    def handle_http_error(error):
        # API callers always get JSON, never an HTML error page.
        if request.path.startswith("/api/"):
            return jsonify({"error": error.description or error.name}), error.code
        return error

    @app.errorhandler(Exception)
    def handle_unexpected(error):
        if isinstance(error, HTTPException):
            return handle_http_error(error)
        app.logger.exception("Unhandled error")
        if request.path.startswith("/api/"):
            return jsonify({"error": "Unexpected server error. Please try again."}), 500
        return "Internal Server Error", 500

    return app


app = create_app()

if __name__ == "__main__":
    app.run(
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5000")),
        debug=app.config["DEBUG"],
    )
