const DEFAULTS = Object.freeze({
  idealApparentTemperature: 50,
  idealEstimatedWbgtMin: 41,
  idealEstimatedWbgtMax: 50,
  earliestHour: 5,
  latestHour: 22,
  fallbackLatitude: 40,
});

export function rankForecast(hours, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const now = settings.now instanceof Date ? settings.now : new Date();
  const futureHours = hours
    .filter((hour) => hour.time instanceof Date && hour.time.getTime() >= now.getTime() - 60 * 60 * 1000)
    .map((hour) => scoreHour(hour, settings));

  const days = collectDayKeys(futureHours, settings.daysCount || 3).map((dateKey, index) => {
    const allHours = futureHours.filter((hour) => hour.dateKey === dateKey);
    const eligibleHours = settings.showAllHours
      ? allHours
      : allHours.filter((hour) => isEligibleRunHour(hour.localHour, settings));
    const scoredHours = eligibleHours.length ? eligibleHours : allHours;
    const rankedHours = [...scoredHours].sort(compareHours);

    return {
      dateKey,
      label: labelDay(dateKey, index),
      usedAllHoursFallback: !settings.showAllHours && !eligibleHours.length && allHours.length > 0,
      top: rankedHours.slice(0, 3),
      hours: [...allHours].sort(compareByTime),
    };
  });

  const bestOverall = days.flatMap((day) => day.top).sort(compareHours)[0] || null;

  return {
    days,
    bestOverall,
  };
}

export function scoreHour(hour, settings = {}) {
  const merged = { ...DEFAULTS, ...settings };
  const apparent = numberOrNull(hour.apparentTemperature);
  const temperature = numberOrNull(hour.temperature);
  const dewPoint = numberOrNull(hour.dewPoint);
  const precipProbability = numberOrZero(hour.precipProbability);
  const qpf = numberOrZero(hour.qpf);
  const windSpeed = numberOrNull(hour.windSpeed);
  const windGust = numberOrNull(hour.windGust);
  const cloudCover = numberOrNull(hour.cloudCover);
  const dewTemp = numberOrNull(dewPoint !== null && temperature !== null ? dewPoint + temperature : null);
  const relativeHumidity = resolveRelativeHumidity(temperature, dewPoint, hour.humidity);
  const wetBulb = computeWetBulbTemperature(temperature, relativeHumidity);
  const estimatedWbgt = estimateWbgt({
    temperature,
    wetBulb,
    windSpeed,
    cloudCover,
    dateKey: hour.dateKey,
    localHour: hour.localHour,
    latitude: numberOrNull(merged.latitude) ?? numberOrNull(hour.latitude) ?? merged.fallbackLatitude,
  });
  const thermalScore = scoreThermalStress(estimatedWbgt, apparent, temperature, merged);
  const rainScore = scoreRain(precipProbability, qpf);
  const windScore = scoreWind(windSpeed, windGust);
  const confidence = scoreConfidence({
    temperature,
    dewPoint,
    forecastHumidity: numberOrNull(hour.humidity),
    relativeHumidity,
    windSpeed,
    cloudCover,
    dateKey: hour.dateKey,
    localHour: hour.localHour,
  });
  const safetyCap = calculateSafetyCap({
    estimatedWbgt,
    apparent,
    temperature,
    windSpeed,
  });
  const weightedScore = thermalScore * 0.7 + rainScore * 0.2 + windScore * 0.1;
  const timePenalty = settings.showAllHours ? outsideHoursPenalty(hour.localHour, merged) : 0;
  const confidencePenalty = (1 - confidence) * 20;
  const adjustedScore = weightedScore - timePenalty - confidencePenalty;
  const score = clamp(Math.round(Math.min(safetyCap, adjustedScore)), 0, 100);

  const scoreParts = {
    thermalScore: round1(thermalScore),
    rainScore: round1(rainScore),
    windScore: round1(windScore),
    safetyCap: round1(safetyCap),
    estimatedWbgt: round1OrNull(estimatedWbgt),
    wetBulb: round1OrNull(wetBulb),
    confidence: round2(confidence),
    relativeHumidity: round1OrNull(relativeHumidity),
    weightedScore: round1(weightedScore),
    timePenalty: round1(timePenalty),
    confidencePenalty: round1(confidencePenalty),
    sunAngle: round1OrNull(estimateSunAngle(hour.dateKey, hour.localHour, numberOrNull(merged.latitude) ?? merged.fallbackLatitude)),
  };

  return {
    ...hour,
    score,
    runScore: score,
    scoreParts,
    paceAdjustment: dewTempPaceAdjustment(dewTemp),
    reasons: buildReasons({
      apparent,
      dewPoint,
      estimatedWbgt,
      precipProbability,
      qpf,
      windSpeed: numberOrZero(windSpeed),
      windGust: numberOrZero(windGust),
      thermalScore,
      rainScore,
      windScore,
      safetyCap,
      confidence,
      score,
    }),
  };
}

export function isEligibleRunHour(hour, settings = DEFAULTS) {
  return Number.isFinite(hour) && hour >= settings.earliestHour && hour <= settings.latestHour;
}

export function dewTempPaceAdjustment(dewTemp) {
  if (!Number.isFinite(dewTemp) || dewTemp < 100) return 0;
  if (dewTemp <= 120) return round4((dewTemp - 100) * 0.0005);
  if (dewTemp <= 140) return round4(0.01 + (dewTemp - 120) * 0.001);
  if (dewTemp <= 160) return round4(0.03 + (dewTemp - 140) * 0.0015);
  return round4(Math.min(0.12, 0.06 + (dewTemp - 160) * 0.002));
}

function collectDayKeys(hours, daysCount) {
  const keys = [];
  for (const hour of hours) {
    if (!keys.includes(hour.dateKey)) keys.push(hour.dateKey);
    if (keys.length >= daysCount) break;
  }
  return keys;
}

function compareHours(a, b) {
  return (
    b.score - a.score ||
    numberOrZero(a.precipProbability) - numberOrZero(b.precipProbability) ||
    numberOrZero(b.scoreParts?.thermalScore) - numberOrZero(a.scoreParts?.thermalScore) ||
    numberOrZero(b.scoreParts?.rainScore) - numberOrZero(a.scoreParts?.rainScore) ||
    a.time.getTime() - b.time.getTime()
  );
}

function compareByTime(a, b) {
  return a.time.getTime() - b.time.getTime();
}

function labelDay(dateKey, index) {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  if (index === 2) return "Day After";

  const date = new Date(`${dateKey}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
}

function buildReasons(values) {
  const reasons = [];

  if (values.estimatedWbgt !== null) {
    if (values.estimatedWbgt >= 41 && values.estimatedWbgt <= 50) {
      reasons.push("ideal estimated WBGT");
    } else if (values.estimatedWbgt > 74) {
      reasons.push("high heat stress");
    } else if (values.estimatedWbgt > 50) {
      reasons.push("warm thermal load");
    } else if (values.apparent !== null && values.apparent <= 20) {
      reasons.push("cold wind chill");
    } else {
      reasons.push("cool thermal load");
    }
  } else {
    reasons.push("limited thermal data");
  }

  if (values.dewPoint !== null) {
    if (values.dewPoint < 55) reasons.push("comfortable dew point");
    else if (values.dewPoint < 65) reasons.push("sticky dew point");
    else reasons.push("oppressive dew point");
  }

  if (values.precipProbability <= 10 && values.qpf <= 0.01) {
    reasons.push("low rain risk");
  } else if (values.precipProbability >= 50 || values.qpf >= 0.05) {
    reasons.push("rain likely");
  } else {
    reasons.push(`${Math.round(values.precipProbability)}% rain`);
  }

  if (values.windScore >= 85) {
    reasons.push("manageable wind");
  } else {
    reasons.push("windy");
  }

  if (values.safetyCap < 100) {
    reasons.push("safety cap applied");
  } else if (values.confidence < 0.8) {
    reasons.push("lower confidence");
  }

  return reasons.slice(0, 4);
}

function resolveRelativeHumidity(temperature, dewPoint, forecastHumidity) {
  const humidity = numberOrNull(forecastHumidity);
  if (humidity !== null) return clamp(humidity, 1, 100);
  if (temperature === null || dewPoint === null) return null;

  const tempC = fahrenheitToCelsius(temperature);
  const dewC = fahrenheitToCelsius(dewPoint);
  const saturationAtDewPoint = saturationVaporPressure(dewC);
  const saturationAtTemperature = saturationVaporPressure(tempC);

  if (!Number.isFinite(saturationAtDewPoint) || !Number.isFinite(saturationAtTemperature) || saturationAtTemperature <= 0) {
    return null;
  }

  return clamp((saturationAtDewPoint / saturationAtTemperature) * 100, 1, 100);
}

function computeWetBulbTemperature(temperature, relativeHumidity) {
  if (temperature === null || relativeHumidity === null) return null;

  const tempC = fahrenheitToCelsius(temperature);
  const humidity = clamp(relativeHumidity, 1, 100);
  const wetBulbC =
    tempC * Math.atan(0.151977 * Math.sqrt(humidity + 8.313659)) +
    Math.atan(tempC + humidity) -
    Math.atan(humidity - 1.676331) +
    0.00391838 * humidity ** 1.5 * Math.atan(0.023101 * humidity) -
    4.686035;

  return celsiusToFahrenheit(wetBulbC);
}

function estimateWbgt({ temperature, wetBulb, windSpeed, cloudCover, dateKey, localHour, latitude }) {
  if (temperature === null || wetBulb === null) return null;

  const wind = Math.max(0, windSpeed ?? 5);
  const clouds = clamp(cloudCover ?? 50, 0, 100);
  const sunAngle = estimateSunAngle(dateKey, localHour, latitude);
  const sunFactor = sunAngle === null ? 0 : Math.sin(toRadians(clamp(sunAngle, 0, 90)));
  const cloudTransmission = 1 - (clouds / 100) * 0.78;
  const windRelief = clamp((wind - 3) / 17, 0, 0.65);
  const solarAddition = 11 * sunFactor * cloudTransmission * (1 - windRelief);
  const stillAirHeat = temperature >= 70 ? Math.max(0, 4 - wind) * 0.35 : 0;
  const globeEstimate = temperature + solarAddition + stillAirHeat;

  return wetBulb * 0.7 + globeEstimate * 0.2 + temperature * 0.1;
}

function scoreThermalStress(estimatedWbgt, apparent, temperature, settings) {
  if (estimatedWbgt === null) {
    const fallbackTemperature = apparent ?? temperature;
    if (fallbackTemperature === null) return 45;

    const delta = Math.abs(fallbackTemperature - settings.idealApparentTemperature);
    const penalty = fallbackTemperature > settings.idealApparentTemperature ? delta * 2.4 : delta * 1.4;
    return clamp(85 - penalty, 0, 85);
  }

  if (estimatedWbgt >= settings.idealEstimatedWbgtMin && estimatedWbgt <= settings.idealEstimatedWbgtMax) {
    return 100;
  }

  if (estimatedWbgt < settings.idealEstimatedWbgtMin) {
    const coldDelta = settings.idealEstimatedWbgtMin - estimatedWbgt;
    const penalty = Math.min(coldDelta, 20) * 1.35 + Math.max(0, coldDelta - 20) * 2;
    return clamp(100 - penalty, 0, 100);
  }

  const warmDelta = estimatedWbgt - settings.idealEstimatedWbgtMax;
  const penalty =
    Math.min(warmDelta, 10) * 2 +
    Math.min(Math.max(0, warmDelta - 10), 10) * 3.3 +
    Math.max(0, warmDelta - 20) * 5.2;

  return clamp(100 - penalty, 0, 100);
}

function scoreRain(precipProbability, qpf) {
  const probability = clamp(precipProbability, 0, 100);
  const hourlyQpf = Math.max(0, qpf);
  const penalty = probability * 0.45 + hourlyQpf * 520 + Math.max(0, hourlyQpf - 0.05) * 260;

  return clamp(100 - penalty, 0, 100);
}

function scoreWind(windSpeed, windGust) {
  if (windSpeed === null && windGust === null) return 82;

  const sustained = Math.max(0, windSpeed ?? 0);
  const gust = Math.max(0, windGust ?? sustained);
  const penalty =
    Math.max(0, sustained - 10) * 3 +
    Math.max(0, sustained - 20) * 2 +
    Math.max(0, gust - 20) * 2 +
    Math.max(0, gust - 35) * 1.5;

  return clamp(100 - penalty, 0, 100);
}

function scoreConfidence({ temperature, dewPoint, forecastHumidity, relativeHumidity, windSpeed, cloudCover, dateKey, localHour }) {
  let confidence = 1;

  if (temperature === null) confidence -= 0.45;
  if (forecastHumidity === null && dewPoint === null) confidence -= 0.35;
  else if (forecastHumidity === null) confidence -= 0.05;
  if (relativeHumidity === null) confidence -= 0.15;
  if (windSpeed === null) confidence -= 0.05;
  if (cloudCover === null) confidence -= 0.08;
  if (!dateKey || !Number.isFinite(localHour)) confidence -= 0.05;

  return clamp(confidence, 0.35, 1);
}

function calculateSafetyCap({ estimatedWbgt, apparent, temperature, windSpeed }) {
  let cap = 100;
  const heatIndex = temperature !== null && temperature >= 80 ? apparent : null;
  const windChill = temperature !== null && temperature < 50 ? apparent : null;

  if (estimatedWbgt !== null) {
    if (estimatedWbgt >= 86) cap = Math.min(cap, 20);
    else if (estimatedWbgt >= 82) cap = Math.min(cap, 35);
    else if (estimatedWbgt >= 78) cap = Math.min(cap, 50);
    else if (estimatedWbgt >= 74) cap = Math.min(cap, 65);
    else if (estimatedWbgt >= 70) cap = Math.min(cap, 80);
  }

  if (heatIndex !== null) {
    if (heatIndex >= 105) cap = Math.min(cap, 20);
    else if (heatIndex >= 100) cap = Math.min(cap, 35);
    else if (heatIndex >= 95) cap = Math.min(cap, 50);
    else if (heatIndex >= 90) cap = Math.min(cap, 70);
  }

  if (windChill !== null) {
    if (windChill <= -5) cap = Math.min(cap, 20);
    else if (windChill <= 5) cap = Math.min(cap, 35);
    else if (windChill <= 15) cap = Math.min(cap, 50);
    else if (windChill <= 25) cap = Math.min(cap, 70);
  }

  if (temperature !== null && temperature <= 20 && windSpeed !== null && windSpeed >= 20) {
    cap = Math.min(cap, 60);
  }

  return cap;
}

function estimateSunAngle(dateKey, localHour, latitude = DEFAULTS.fallbackLatitude) {
  const dayOfYear = dayOfYearFromDateKey(dateKey);
  if (!dayOfYear || !Number.isFinite(localHour)) return null;

  const latRad = toRadians(clamp(latitude, -89, 89));
  const declination = toRadians(23.44 * Math.sin(toRadians((360 / 365) * (dayOfYear - 81))));
  const hourAngle = toRadians(15 * (localHour + 0.5 - 12));
  const altitude =
    Math.sin(latRad) * Math.sin(declination) +
    Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);

  return clamp(toDegrees(Math.asin(clamp(altitude, -1, 1))), 0, 90);
}

function dayOfYearFromDateKey(dateKey) {
  if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;

  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7)) - 1;
  const day = Number(dateKey.slice(8, 10));
  const date = Date.UTC(year, month, day);
  const start = Date.UTC(year, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;

  return Math.floor((date - start) / dayMs);
}

function saturationVaporPressure(tempC) {
  return Math.exp((17.625 * tempC) / (243.04 + tempC));
}

function fahrenheitToCelsius(value) {
  return (value - 32) * (5 / 9);
}

function celsiusToFahrenheit(value) {
  return value * (9 / 5) + 32;
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function toDegrees(value) {
  return (value * 180) / Math.PI;
}

function outsideHoursPenalty(hour, settings) {
  if (!Number.isFinite(hour)) return 8;
  if (hour < settings.earliestHour) return (settings.earliestHour - hour) * 3;
  if (hour > settings.latestHour) return (hour - settings.latestHour) * 3;
  return 0;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round4(value) {
  return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : 0;
}

function round2(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function round1(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

function round1OrNull(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}
