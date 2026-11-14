import pytest


@pytest.mark.parametrize("path", ["/", "/dashboard", "/assistant", "/profile", "/settings", "/upload"])
def test_pages_render(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert b"Omi AI" in response.data


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_regions_endpoint(client):
    data = client.get("/api/regions").get_json()
    assert [r["id"] for r in data] == ["lagos", "edo"]
    assert all("latitude" in r and "longitude" in r for r in data)


def test_variables_and_coverage(client):
    variables = client.get("/api/variables").get_json()
    assert {v["parameter"] for v in variables} == {"T2M", "PRECTOTCORR"}
    coverage = client.get("/api/coverage").get_json()
    assert coverage["start_year"] == 1981 and coverage["end_year"] == 2025


def test_unknown_api_route_returns_json(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert "error" in response.get_json()


def test_static_assets_exist(client):
    for name in ["main.js", "results.js", "dashboard.js", "assistant.js", "upload.js"]:
        assert client.get(f"/static/js/{name}").status_code == 200


def test_profile_and_settings_round_trip(client):
    saved = client.post("/api/profile", json={"name": "Ada", "email": "ada@example.org"})
    assert saved.status_code == 200
    assert client.get("/api/profile").get_json()["profile"]["name"] == "Ada"
    assert b"Ada" in client.get("/profile").data

    bad = client.post("/api/profile", json={"email": "not-an-email"})
    assert bad.status_code == 400

    settings = client.post("/api/settings", json={"alpha": "0.10", "default_region": "both", "temp_unit": "K"})
    assert settings.status_code == 200
    assert client.get("/api/settings").get_json()["alpha"] == "0.10"
    assert client.post("/api/settings", json={"alpha": "0.7"}).status_code == 400
