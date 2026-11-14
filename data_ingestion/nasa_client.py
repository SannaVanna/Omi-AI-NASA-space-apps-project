"""NASA Giovanni time-series client (GPM IMERG rainfall).

Original retrieval approach by the data team: request a point time series
from the Giovanni API with an Earthdata bearer token. This module is safe to
import: it does not log in or call the API until a function is called.

Authentication (first one found is used):
  1. EARTHDATA_TOKEN                     an Earthdata Login user token
  2. EARTHDATA_USERNAME / EARTHDATA_PASSWORD  via ``earthaccess`` (optional
     dependency: ``pip install earthaccess``)

Run directly for a quick check:  python -m data_ingestion.nasa_client
"""

import csv
import io
import os

import requests
from dotenv import load_dotenv

load_dotenv()

TIME_SERIES_URL = "https://api.giovanni.earthdata.nasa.gov/timeseries"
HEADER_LINES = 13  # Giovanni CSV: 13 "key,value" metadata lines, then data


class GiovanniError(Exception):
    """Raised when the Giovanni time series cannot be retrieved or parsed."""


def has_credentials():
    return bool(
        os.getenv("EARTHDATA_TOKEN")
        or (os.getenv("EARTHDATA_USERNAME") and os.getenv("EARTHDATA_PASSWORD"))
    )


def get_token():
    token = os.getenv("EARTHDATA_TOKEN")
    if token:
        return token.strip()
    if os.getenv("EARTHDATA_USERNAME") and os.getenv("EARTHDATA_PASSWORD"):
        try:
            import earthaccess
        except ImportError as error:
            raise GiovanniError(
                "Set EARTHDATA_TOKEN, or install earthaccess to log in with "
                "EARTHDATA_USERNAME/EARTHDATA_PASSWORD."
            ) from error
        earthaccess.login(strategy="environment")
        return earthaccess.get_edl_token()["access_token"]
    raise GiovanniError(
        "GPM IMERG needs an Earthdata Login token. Set EARTHDATA_TOKEN "
        "(see https://urs.earthdata.nasa.gov/)."
    )


def call_time_series(lat, lon, time_start, time_end, dataset, timeout=120):
    """
    INPUTS:
    lat - latitude
    lon - longitude
    time_start - start of time series in YYYY-MM-DDThh:mm:ss format (UTC)
    time_end - end of the time series in YYYY-MM-DDThh:mm:ss format (UTC)
    dataset - name of the data parameter for the time series

    OUTPUT:
    time series csv output string
    """
    query_parameters = {
        "data": dataset,
        "location": "[{},{}]".format(lat, lon),
        "time": "{}/{}".format(time_start, time_end),
    }
    headers = {"Authorization": f"Bearer {get_token()}"}

    try:
        response = requests.get(
            TIME_SERIES_URL, params=query_parameters, headers=headers, timeout=timeout
        )
    except requests.RequestException as error:
        raise GiovanniError(f"Could not reach NASA Giovanni: {error}") from error

    if response.status_code in (401, 403):
        raise GiovanniError("NASA Giovanni rejected the Earthdata token (check EARTHDATA_TOKEN).")
    if response.status_code != 200:
        raise GiovanniError(f"NASA Giovanni returned HTTP {response.status_code}: {response.text[:300]}")
    return response.text


def parse_time_series(text):
    """Parse Giovanni CSV text into (metadata dict, [(timestamp, value), ...]).

    Metadata lines are "key,value" pairs; the data section starts at the
    "Timestamp" header row. Fill values and negative rainfall become None.
    """
    if not text or not text.strip():
        raise GiovanniError("NASA Giovanni returned an empty time series.")

    lines = text.splitlines()
    metadata = {}
    start = None
    for index, line in enumerate(lines):
        if line.lower().startswith("timestamp"):
            start = index + 1
            break
        if "," in line:
            key, _, value = line.partition(",")
            metadata[key.strip()] = value.strip()
        if index > HEADER_LINES + 5:
            break
    if start is None:
        raise GiovanniError("Unexpected Giovanni response (no 'Timestamp' data header).")

    fill = None
    for key in ("fill_value", "_FillValue", "fill value"):
        if key in metadata:
            try:
                fill = float(metadata[key])
            except ValueError:
                pass

    rows = []
    for record in csv.reader(io.StringIO("\n".join(lines[start:]))):
        if len(record) < 2 or not record[0].strip():
            continue
        try:
            value = float(record[1])
        except ValueError:
            value = None
        if value is not None and ((fill is not None and value == fill) or value < 0):
            value = None
        rows.append((record[0].strip(), value))

    if not rows:
        raise GiovanniError("NASA Giovanni returned no data rows.")
    return metadata, rows


if __name__ == "__main__":
    from data_ingestion.rainfall import rainfall

    meta, data = parse_time_series(call_time_series(**rainfall))
    print(meta)
    print(data[:5], "...", len(data), "rows")
