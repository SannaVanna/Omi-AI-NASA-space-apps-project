
from routes.regions import regions_bp
from routes.analysis import analysis_bp
from routes.uploads import uploads_bp
from routes.assistant import assistant_bp
from routes.profile import profile_bp
from routes.settings import settings_bp
from routes.challenge import challenge_bp


def register_blueprints(app):

    app.register_blueprint(
        regions_bp,
        url_prefix="/api"
    )

    app.register_blueprint(
        analysis_bp,
        url_prefix="/api/analysis"
    )

    app.register_blueprint(
        uploads_bp,
        url_prefix="/api/uploads"
    )

    app.register_blueprint(
        assistant_bp,
        url_prefix="/api/assistant"
    )

    app.register_blueprint(
        profile_bp,
        url_prefix="/api/profile"
    )

    app.register_blueprint(
        settings_bp,
        url_prefix="/api/settings"
    )

    app.register_blueprint(
        challenge_bp,
        url_prefix="/api/challenge"
    )
