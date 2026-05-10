import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parseWeatherGovDwml, buildWeatherGovUrl, computeApparentTemperature } from "../js/weatherGov.js";
import { dewTempPaceAdjustment, rankForecast } from "../js/scoring.js";

const fixture = await fs.readFile(new URL("./fixtures/weather.gov.dwml.xml", import.meta.url), "utf8");
const forecast = parseWeatherGovDwml(fixture);

assert.equal(forecast.locationName, "Roxbury MA, MA");
assert.equal(forecast.hours.length, 6);
assert.equal(forecast.hours[0].dateKey, "2026-05-10");
assert.equal(forecast.hours[0].forecastLabel, "Mostly Clear/Mostly Sunny");
assert.equal(forecast.hours[2].rainLabel, "likely");
assert.equal(forecast.hours[5].apparentTemperature, 84);

assert.equal(
  buildWeatherGovUrl({ latitude: 42.329277, longitude: -71.112033 }),
  "https://forecast.weather.gov/MapClick.php?lat=42.32928&lon=-71.11203&FcstType=digitalDWML",
);

assert.equal(computeApparentTemperature(45, 35, 60, 10), 39.8);
assert.equal(dewTempPaceAdjustment(100), 0);
assert.equal(dewTempPaceAdjustment(120), 0.01);
assert.equal(dewTempPaceAdjustment(140), 0.03);

const ranked = rankForecast(forecast.hours, {
  daysCount: 3,
  now: new Date("2026-05-10T05:00:00-04:00"),
});

assert.equal(ranked.days.length, 3);
assert.equal(ranked.bestOverall.isoTime, "2026-05-11T07:00:00-04:00");
assert.ok(ranked.bestOverall.score > ranked.days[0].top[0].score);
assert.ok(ranked.days[0].top.every((hour) => hour.localHour >= 5 && hour.localHour <= 22));

const allHours = rankForecast(forecast.hours, {
  daysCount: 3,
  showAllHours: true,
  now: new Date("2026-05-10T05:00:00-04:00"),
});

assert.equal(allHours.days[0].hours.length, 3);

console.log("All parser and scoring checks passed.");
