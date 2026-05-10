# Run Weather Recommender

A dependency-free GitHub Pages app that ranks the best time to run from hourly Weather.gov forecast data.

## What It Does

- Uses browser geolocation or manually entered coordinates.
- Fetches Weather.gov DWML data with:
  `https://forecast.weather.gov/MapClick.php?lat={lat}&lon={lon}&FcstType=digitalDWML`
- Parses hourly temperature, dew point, humidity, precipitation probability, QPF, cloud cover, wind, and rain labels.
- Scores run windows for 3, 5, or 7 forecast days.
- Charts hourly score over time with hover, focus, and click/tap readouts.
- Defaults to a 50F ideal apparent temperature, matching the original spreadsheet.

## Calculation Notes

- Dew point is a temperature, shown in F. Relative humidity is the percentage value.
- Apparent temperature uses Weather.gov heat index or wind chill when available. Otherwise the app calculates heat index above 80F and wind chill below 50F.
- Score starts at 100, then subtracts penalties for distance from 50F apparent temperature, high dew point, rain probability/QPF, wind, and missing data.

## Local Preview

```sh
python3 -m http.server 8010 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8010/`.

## Tests

No install is required. If Node is available:

```sh
node tests/run-tests.mjs
```

## GitHub Pages

1. Push this repository to GitHub.
2. In repository settings, go to **Pages**.
3. Set the source to the `main` branch and `/ (root)`.
4. Wait for GitHub Pages to publish the site.

Geolocation works on GitHub Pages because the published site is served over HTTPS. Weather.gov DWML data is US-focused, so manual coordinates should be within the United States.
