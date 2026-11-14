# Omi AI — Earth System Trend Detective

NASA Space Apps Challenge 2026 · *Be An Earth System Trend Detective!*

Omi AI helps anyone investigate how **temperature** and **rainfall** have changed
in **Lagos State** and **Edo State**, Nigeria, using real NASA data, real
statistics and plain-language explanations. There are three ways in, and all of
them use the same analysis engine:

1. **Dashboard**: pick a region (or compare both), a variable and a period.
2. **Text assistant**: e.g. *"How has rainfall changed in Lagos since 2001?"* Omi asks
   for anything missing, runs the analysis, and shows the chart in the chat.
3. **Voice assistant**: tap the mic, ask out loud, and hear the answer (browser Web Speech API).

You can also upload your own CSV time series on **Analyse a Dataset**.

## Data

| | |
|---|---|
| Product | NASA POWER Monthly & Annual API v2 (no API key needed) |
| Underlying data | NASA GMAO MERRA-2 reanalysis, 0.5° × 0.625° grid |
| Temperature | `T2M`: air temperature at 2 m, monthly mean, °C |
| Rainfall | `PRECTOTCORR`: bias-corrected precipitation, mm/day → converted to mm/month and mm/year |
| Coverage | 1981 to last complete year |
| Points | Lagos 6.5244°N 3.3792°E · Edo 6.5438°N 5.8987°E |

Each region/variable is downloaded once and cached in `data/processed/` (git-ignored).

**Optional second rainfall source: NASA GPM IMERG** (the data team's Giovanni integration,
`data_ingestion/nasa_client.py`). This is IMERG Final Run daily data (`GPM_3IMERGDF_07`, 0.1° ≈ 11 km,
satellite-based, from 2001), retrieved from the NASA Giovanni time-series API and summed into monthly
and yearly totals. Set `EARTHDATA_TOKEN` to enable it. You can then pick it in the dashboard's
"Data source" menu, or ask the assistant for "GPM satellite rainfall". Without a token the option is
shown as unavailable and everything else works with NASA POWER. To test the client on its own, run
`python -m data_ingestion.nasa_client`.

## Statistics

Monthly values are aggregated to one value per complete year (mean for
temperature, total for rainfall) so the seasonal cycle does not hide the trend.

- **Linear regression**: rate of change, 95 % confidence interval, R², p-value
- **Sen's slope** (Theil-Sen): robust rate of change with confidence interval
- **Mann-Kendall** with the **Hamed & Rao autocorrelation correction**: is the trend significant?
- **Seasonal Mann-Kendall** on the monthly series as a robustness check
- The significance level is configurable in Settings (0.01 / 0.05 / 0.10)

Every response includes the source metadata, units, data quality and limitations.
Explanations say what changed, never claim a proven cause, and come in three
levels: simple, detailed and research.

## AI assistant

- Without a key, Omi parses requests, asks follow-up questions, runs the analysis and
  explains the calculated numbers with its built-in explainer.
- With `GOOGLE_API_KEY` set, Gemini words the answers, but it only receives the structured
  analysis results and is told not to invent data. If Gemini fails, Omi falls back to the
  built-in explainer.

## Run it locally

Requires Python 3.10+.

**Windows (PowerShell)**

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python app.py
```

**macOS / Linux**

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

Open http://127.0.0.1:5000. The first investigation for a region downloads data from
NASA POWER (a few seconds), and after that it is instant.

## Tests

```bash
pytest
```

The tests mock NASA POWER, so they run offline.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/regions` | Supported regions with coordinates |
| GET | `/api/variables` | Supported variables, units and NASA parameters |
| GET | `/api/coverage`, `/api/sources` | Available years and data sources (POWER, IMERG) |
| GET | `/api/data?region=&variable=&start=&end=` | Monthly + annual records |
| POST | `/api/analyze` | `{region, variable, start_year, end_year, source?, alpha?, detail?}` → full analysis |
| POST | `/api/compare` | `{variable, start_year, end_year, regions?, source?, alpha?, detail?}` → both regions + comparison |
| POST | `/api/assistant/chat` | `{question, context?, detail?, history?}` → answer, params, analysis |
| POST | `/api/assistant/voice` | Same as chat, plus a `speech` field for reading aloud |
| POST | `/api/uploads/analyze` | CSV upload (form fields `file`, `date_column`, `value_column`, `unit`) |
| POST | `/api/analysis/trend`, `/api/analysis/compare` | Analyse caller-supplied series |
| GET/POST | `/api/profile`, `/api/settings` | Profile and preferences (session-based for now) |

## Deploy

- Combined deployment: the `Procfile` runs `gunicorn app:app`. Set `SECRET_KEY` (and
  optionally `GOOGLE_API_KEY`) on the host.
- Separate frontend: set `CORS_ORIGINS` to the frontend's URL.

## Project layout

```
app.py                     Flask app, page routes, JSON error handling
config.py                  Regions, variables, NASA POWER settings
routes/                    API blueprints
services/nasa_service.py   NASA POWER + GPM IMERG retrieval, parsing, caching
data_ingestion/            Giovanni (GPM IMERG) client and request settings
services/analysis_service.py  Shared investigation/comparison engine
services/explain.py        Grounded plain-language explanations
services/ai_service.py     Text/voice assistant (parsing, follow-ups, Gemini)
processing/                Cleaning, validation, trend tests, statistics
static/js/results.js       Shared chart/statistics rendering
templates/                 Jinja pages
data/sample/               Sample CSV (real NASA POWER Lagos temperature)
tests/                     pytest suite
```
