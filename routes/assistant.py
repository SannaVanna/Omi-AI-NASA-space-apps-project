from flask import Blueprint, jsonify, request

from services.ai_service import answer_question
from services.nasa_service import NasaDataError

assistant_bp = Blueprint("assistant", __name__)


def _handle(voice):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}

    question = data.get("question", data.get("message", ""))
    if not isinstance(question, str) or not question.strip():
        return jsonify({"error": "Please enter a question."}), 400

    history = data.get("history")
    if not isinstance(history, list):
        history = []

    try:
        result = answer_question(
            question,
            context=data.get("context"),
            detail=data.get("detail", "detailed"),
            history=history,
            voice=voice or bool(data.get("voice")),
            alpha=data.get("alpha"),
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except NasaDataError as error:
        return jsonify({"error": f"NASA data is temporarily unavailable: {error}"}), 502

    return jsonify(result)


@assistant_bp.route("/chat", methods=["POST"])
def chat():
    return _handle(voice=False)


@assistant_bp.route("/voice", methods=["POST"])
def voice():
    """Voice turns: the browser does speech-to-text and text-to-speech
    (Web Speech API) and sends the transcript here. The response adds a
    short ``speech`` field written for reading aloud."""
    return _handle(voice=True)
