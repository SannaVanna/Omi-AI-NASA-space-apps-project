"""Giovanni time-series request settings for NASA GPM IMERG daily rainfall.

Dataset: GPM_3IMERGDF_07 (IMERG Final Run, daily, 0.1° x 0.1°), variable
``precipitation`` in mm/day. IMERG V07 starts in June 2000, so complete
years are available from 2001.
"""

DATASET = "GPM_3IMERGDF_07_precipitation"
FIRST_COMPLETE_YEAR = 2001

# Example request for Lagos State (same point the rest of Omi AI uses).
rainfall = {
    "lat": 6.5244,
    "lon": 3.3792,
    "time_start": "2001-01-01T00:00:00",
    "time_end": "2001-12-31T23:59:59",
    "dataset": DATASET,
}
