import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parseWeatherGovDwml, buildWeatherGovUrl, computeApparentTemperature } from "../js/weatherGov.js";
import { dewTempPaceAdjustment, rankForecast, scoreHour } from "../js/scoring.js";

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
  latitude: 42.3293,
});

assert.equal(ranked.days.length, 3);
assert.equal(ranked.bestOverall.isoTime, "2026-05-11T06:00:00-04:00");
assert.ok(ranked.bestOverall.score > ranked.days[0].top[0].score);
assert.ok(ranked.days[0].top.every((hour) => hour.localHour >= 5 && hour.localHour <= 22));
assert.ok(ranked.bestOverall.scoreParts.estimatedWbgt >= 41);
assert.ok(ranked.bestOverall.scoreParts.estimatedWbgt <= 50);
assert.equal(ranked.bestOverall.scoreParts.thermalScore, 100);

const allHours = rankForecast(forecast.hours, {
  daysCount: 3,
  showAllHours: true,
  now: new Date("2026-05-10T05:00:00-04:00"),
  latitude: 42.3293,
});

assert.equal(allHours.days[0].hours.length, 3);

const baseHour = {
  isoTime: "2026-07-15T07:00:00-04:00",
  time: new Date("2026-07-15T07:00:00-04:00"),
  dateKey: "2026-07-15",
  localHour: 7,
  temperature: 50,
  dewPoint: 38,
  humidity: 62,
  apparentTemperature: 50,
  precipProbability: 0,
  qpf: 0,
  windSpeed: 5,
  windGust: null,
  cloudCover: 20,
  forecastLabel: "Clear/Sunny",
};

const idealHour = scoreHour(baseHour, { latitude: 42.3293 });
assert.ok(idealHour.score >= 95);
assert.equal(idealHour.scoreParts.thermalScore, 100);
assert.ok(idealHour.scoreParts.estimatedWbgt >= 41);
assert.ok(idealHour.scoreParts.estimatedWbgt <= 50);

const hotHumidHour = scoreHour(
  {
    ...baseHour,
    isoTime: "2026-07-15T13:00:00-04:00",
    time: new Date("2026-07-15T13:00:00-04:00"),
    localHour: 13,
    temperature: 92,
    dewPoint: 76,
    humidity: 70,
    apparentTemperature: 105,
    cloudCover: 10,
  },
  { latitude: 42.3293 },
);
assert.ok(hotHumidHour.score <= hotHumidHour.scoreParts.safetyCap);
assert.ok(hotHumidHour.scoreParts.safetyCap <= 20);
assert.ok(hotHumidHour.scoreParts.estimatedWbgt >= 86);

const rainyHour = scoreHour(
  {
    ...baseHour,
    precipProbability: 80,
    qpf: 0.1,
    rainLabel: "likely",
  },
  { latitude: 42.3293 },
);
assert.ok(rainyHour.score < idealHour.score);
assert.ok(rainyHour.scoreParts.rainScore < idealHour.scoreParts.rainScore);
assert.equal(rainyHour.scoreParts.thermalScore, idealHour.scoreParts.thermalScore);

const coldHourInput = {
  ...baseHour,
  isoTime: "2026-01-15T07:00:00-05:00",
  time: new Date("2026-01-15T07:00:00-05:00"),
  dateKey: "2026-01-15",
  temperature: 28,
  dewPoint: 15,
  humidity: 55,
  apparentTemperature: 16,
  windSpeed: 25,
  windGust: 40,
  cloudCover: 30,
};
const windyColdHour = scoreHour(coldHourInput, { latitude: 42.3293 });
const calmColdHour = scoreHour(
  {
    ...coldHourInput,
    apparentTemperature: 28,
    windSpeed: 5,
    windGust: null,
  },
  { latitude: 42.3293 },
);
assert.ok(windyColdHour.score < calmColdHour.score);
assert.ok(windyColdHour.scoreParts.windScore < calmColdHour.scoreParts.windScore);
assert.ok(windyColdHour.scoreParts.safetyCap <= 70);

const missingMoistureHour = scoreHour(
  {
    ...baseHour,
    dewPoint: null,
    humidity: null,
  },
  { latitude: 42.3293 },
);
assert.equal(missingMoistureHour.scoreParts.estimatedWbgt, null);
assert.equal(missingMoistureHour.scoreParts.wetBulb, null);
assert.ok(missingMoistureHour.scoreParts.confidence < idealHour.scoreParts.confidence);
assert.ok(missingMoistureHour.score < idealHour.score);

console.log("All parser and scoring checks passed.");
