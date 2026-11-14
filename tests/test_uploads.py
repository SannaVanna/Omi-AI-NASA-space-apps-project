import io


def test_upload_requires_file(client):
    assert client.post("/api/uploads/analyze").status_code == 400


def test_upload_rejects_non_csv(client):
    response = client.post("/api/uploads/analyze", data={"file": (io.BytesIO(b"a"), "a.txt")})
    assert response.status_code == 400


def test_upload_analyses_csv(client):
    csv = b"when,temp\n2020-01-01,1\n2020-02-01,2\nbad,3\n2020-03-01,3\n2020-04-01,5\n2020-05-01,\n"
    response = client.post("/api/uploads/analyze", data={
        "file": (io.BytesIO(csv), "data.csv"), "date_column": "when", "value_column": "temp", "unit": "°C",
    })
    assert response.status_code == 200
    body = response.get_json()
    assert body["statistics"]["count"] == 4
    assert body["data_quality"]["rows_removed"] == 2
    assert len(body["series"]) == 4 and body["trend"]["trend_line"]
    assert body["date_range"] == {"start": "2020-01-01", "end": "2020-04-01"}


def test_upload_missing_column(client):
    response = client.post("/api/uploads/analyze", data={
        "file": (io.BytesIO(b"a,b\n1,2\n"), "data.csv"), "date_column": "date", "value_column": "value",
    })
    assert response.status_code == 400
    assert "not found" in response.get_json()["error"]


def test_sample_csv_analyses(client):
    with open("data/sample/lagos_monthly_temperature_nasa_power.csv", "rb") as handle:
        response = client.post("/api/uploads/analyze", data={
            "file": (handle, "sample.csv"), "date_column": "date", "value_column": "temperature_c",
        })
    assert response.status_code == 200
    assert response.get_json()["trend"]["seasonal_mann_kendall"] is not None
