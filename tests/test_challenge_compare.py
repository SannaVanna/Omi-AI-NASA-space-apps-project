import random

import pytest


@pytest.mark.parametrize("path", ["/compare", "/challenge"])
def test_new_pages_render(client, path):
    html = client.get(path).data.decode()
    assert "Compare Regions" in html and "Trend Challenge" in html  # sidebar links


def test_mascot_and_avatar_assets(client):
    html = client.get("/assistant").data.decode()
    assert "img/omi-mascot" in html and "img/avatar" in html
    assert client.get("/static/img/omi-mascot.svg").status_code == 200
    assert client.get("/static/img/avatar-default.svg").status_code == 200
    assert client.get("/static/data/nigeria_states.geojson").status_code == 200


def test_challenge_hides_answer_until_guess(client):
    c = client.post("/api/challenge/new", json={"region": "lagos", "variable": "temperature"}).get_json()
    assert c["region"]["id"] == "lagos"
    assert len(c["shown"]) == 72 and c["hidden_count"] == c["total"] - 72
    assert "answer" not in c and "series" not in c
    assert all("value" not in str(d) for d in c["hidden_dates"])

    r = client.post("/api/challenge/answer", json={"challenge_id": c["challenge_id"], "guess": "increasing"}).get_json()
    assert r["answer"] in ("increasing", "decreasing", "no trend")
    assert r["correct"] == (r["answer"] == "increasing")
    assert len(r["series"]) == c["total"]
    assert r["test"]["name"].startswith("Seasonal")

    # One answer per challenge.
    again = client.post("/api/challenge/answer", json={"challenge_id": c["challenge_id"], "guess": "increasing"})
    assert again.status_code == 400


def test_challenge_validation(client):
    c = client.post("/api/challenge/new", json={}).get_json()
    assert c["region"]["id"] in ("lagos", "edo")
    assert client.post("/api/challenge/answer", json={"challenge_id": c["challenge_id"], "guess": "maybe"}).status_code == 400
    assert client.post("/api/challenge/answer", json={"challenge_id": "wrong", "guess": "increasing"}).status_code == 400
    assert client.post("/api/challenge/new", json={"region": "mars"}).status_code == 400
