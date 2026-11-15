"""World map + redesign additions."""


def test_dashboard_has_map_and_leaflet(client):
    html = client.get("/dashboard").data.decode()
    assert 'id="region-map"' in html
    assert "vendor/leaflet/leaflet.js" in html and "js/region_map.js" in html
    for asset in ["vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css", "js/region_map.js"]:
        assert client.get(f"/static/{asset}").status_code == 200


def test_existing_dashboard_hooks_are_kept(client):
    html = client.get("/dashboard").data.decode()
    for element_id in ["investigation-form", "inv-region", "inv-variable", "inv-source", "inv-start", "inv-end",
                       "inv-detail", "investigate-btn", "results-panel", "results-kpis", "results-chart",
                       "results-explanation", "results-stats", "comparison-card", "results-source", "ask-omi-btn",
                       "results-insight", "map-compare-btn"]:
        assert f'id="{element_id}"' in html, element_id
    assert 'data-analyse-region="lagos"' in html and 'data-analyse-region="edo"' in html


def test_regions_expose_coordinates_for_map(client):
    regions = {r["id"]: r for r in client.get("/api/regions").get_json()}
    assert regions["lagos"]["latitude"] == 6.5244 and regions["edo"]["longitude"] == 5.8987


def test_analysis_includes_extremes_and_summary(client):
    body = client.post("/api/analyze", json={"region": "lagos", "variable": "temperature", "start_year": 2001, "end_year": 2025}).get_json()
    ex = body["extremes"]
    assert ex["highest_month"]["value"] >= ex["lowest_month"]["value"]
    assert len(ex["highest_month"]["date"]) == 7
    assert 2001 <= ex["highest_year"]["year"] <= 2025
    assert body["summary"] and len(body["summary"]) < len(body["explanation"]) + 1


def test_comparison_includes_summary(client):
    body = client.post("/api/compare", json={"variable": "rainfall", "start_year": 1990, "end_year": 2020}).get_json()
    assert body["summary"].startswith("Comparing rainfall")


def test_sidebar_shows_saved_profile(client):
    assert b"Create free account" in client.get("/dashboard").data
    client.post("/api/profile", json={"name": "Bolaji Adigun", "email": "b@example.org"})
    html = client.get("/assistant").data.decode()
    assert "Bolaji Adigun" in html and "sidebar-user-avatar" in html


def test_topbar_search_points_to_assistant(client):
    html = client.get("/upload").data.decode()
    assert 'action="/assistant"' in html and 'name="q"' in html


def test_sample_csv_download(client):
    response = client.get("/samples/lagos_monthly_temperature_nasa_power.csv")
    assert response.status_code == 200
    assert response.data.startswith(b"date,temperature_c")
    assert client.get("/samples/../app.py").status_code == 404
    assert client.get("/samples/notes.txt").status_code == 404


def test_system_theme_setting(client):
    assert client.post("/api/settings", json={"theme": "system"}).status_code == 200
    assert b'data-set-theme="system"' in client.get("/settings").data
