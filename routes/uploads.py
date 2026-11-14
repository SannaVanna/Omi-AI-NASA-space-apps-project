from flask import Blueprint, jsonify, request

from services.upload_service import analyze_uploaded_csv

uploads_bp = Blueprint("uploads", __name__)


@uploads_bp.route("/analyze", methods=["POST"])
def upload_dataset():
    uploaded_file = request.files.get("file")

    if not uploaded_file or not uploaded_file.filename:
        return jsonify({"error": "Please upload a CSV file."}), 400

    if not uploaded_file.filename.lower().endswith(".csv"):
        return jsonify({"error": "Only CSV files are supported."}), 400

    form = request.form
    try:
        result = analyze_uploaded_csv(
            uploaded_file,
            form.get("date_column", "date"),
            form.get("value_column", "value"),
            alpha=form.get("alpha"),
            unit=form.get("unit", ""),
            variable=form.get("variable", ""),
            region=form.get("custom_region") or form.get("region", ""),
        )
        return jsonify(result)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
