def chat(client, question, context=None, **extra):
    payload = {"question": question, "context": context or {}, **extra}
    response = client.post("/api/assistant/chat", json=payload)
    return response


def test_requires_question(client):
    assert chat(client, "").status_code == 400
    assert client.post("/api/assistant/chat", json={"question": 5}).status_code == 400
    assert client.post("/api/assistant/chat", data="x", content_type="text/plain").status_code == 400


def test_greeting(client):
    body = chat(client, "Hi Omi").get_json()
    assert "Lagos" in body["answer"] and body["analysis"] is None


def test_prd_conversation_asks_for_period_then_analyses(client):
    first = chat(client, "Hi Omi, I want to investigate how rainfall has changed in Lagos over the years.").get_json()
    assert first["awaiting"] == "period"
    assert first["analysis"] is None
    assert first["params"]["variable"] == "rainfall"

    second = chat(client, "Let's use 2001 to 2025.", {"params": first["params"], "awaiting": first["awaiting"]}).get_json()
    assert second["analysis"]["period"]["start_year"] == 2001
    assert second["analysis"]["variable"]["id"] == "rainfall"
    assert "2001" in second["answer"]

    follow = chat(client, "Is it statistically significant?",
                  {"params": second["params"], "has_result": True}).get_json()
    assert "significan" in follow["answer"].lower()


def test_last_n_years(client):
    body = chat(client, "How has temperature changed in Lagos over the last 20 years?").get_json()
    assert body["analysis"]["period"] == {"start_year": 2006, "end_year": 2025, "years": 20}


def test_asks_for_variable_and_region(client):
    body = chat(client, "Can you investigate trends for me?").get_json()
    assert body["awaiting"] == "variable"
    body = chat(client, "temperature", {"params": body["params"], "awaiting": "variable"}).get_json()
    assert body["awaiting"] == "region"


def test_comparison_request(client):
    body = chat(client, "Compare rainfall in Lagos and Edo from 1981 to 2025").get_json()
    assert len(body["analysis"]["regions"]) == 2


def test_method_question_uses_glossary(client):
    body = chat(client, "What is the Mann-Kendall test?").get_json()
    assert "monotonic" in body["answer"]


def test_out_of_range_years_are_clamped(client):
    body = chat(client, "temperature in edo from 1960 to 2030").get_json()
    assert body["analysis"]["period"]["start_year"] == 1981
    assert "1981" in body["answer"]


def test_voice_endpoint_returns_speech(client):
    body = client.post("/api/assistant/voice", json={"question": "How has temperature changed in Edo since 2000?"}).get_json()
    assert body["speech"]
    assert "°" not in body["speech"]


def test_detail_levels_change_explanation(client):
    simple = chat(client, "temperature in lagos 1990 to 2020", detail="simple").get_json()["answer"]
    research = chat(client, "temperature in lagos 1990 to 2020", detail="research").get_json()["answer"]
    assert len(research) > len(simple)
    assert "MERRA-2" in research
