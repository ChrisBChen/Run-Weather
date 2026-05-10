const DEFAULTS = Object.freeze({
  idealApparentTemperature: 50,
  earliestHour: 5,
  latestHour: 22,
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
  const windSpeed = numberOrZero(hour.windSpeed);
  const windGust = numberOrZero(hour.windGust);
  const dewTemp = numberOrNull(dewPoint !== null && temperature !== null ? dewPoint + temperature : null);

  const tempDelta = apparent === null ? 18 : Math.abs(apparent - merged.idealApparentTemperature);
  const tempPenalty = tempDelta * 2.2;
  const dewPenalty =
    (dewPoint === null ? 0 : Math.max(0, dewPoint - 55) * 0.9) +
    (dewTemp === null ? 0 : Math.max(0, dewTemp - 100) * 0.28);
  const rainPenalty = precipProbability * 0.34 + qpf * 380;
  const windPenalty = Math.max(0, windSpeed - 10) * 1.4 + Math.max(0, windGust - 20) * 0.9;
  const timePenalty = settings.showAllHours ? outsideHoursPenalty(hour.localHour, merged) : 0;
  const missingPenalty = [apparent, temperature, dewPoint].filter((value) => value === null).length * 4;
  const rawScore = 100 - tempPenalty - dewPenalty - rainPenalty - windPenalty - timePenalty - missingPenalty;
  const score = clamp(Math.round(rawScore), 0, 100);

  return {
    ...hour,
    score,
    scoreParts: {
      tempDelta,
      tempPenalty,
      dewTemp,
      dewPenalty,
      rainPenalty,
      windPenalty,
      timePenalty,
      missingPenalty,
    },
    paceAdjustment: dewTempPaceAdjustment(dewTemp),
    reasons: buildReasons({
      apparent,
      dewPoint,
      dewTemp,
      precipProbability,
      qpf,
      windSpeed,
      windGust,
      score,
      ideal: merged.idealApparentTemperature,
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
    numberOrZero(a.scoreParts?.tempDelta) - numberOrZero(b.scoreParts?.tempDelta) ||
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

  if (values.apparent !== null) {
    const delta = Math.abs(values.apparent - values.ideal);
    if (delta <= 4) reasons.push(`near ${values.ideal}F`);
    else if (values.apparent > values.ideal) reasons.push(`${Math.round(delta)}F warm`);
    else reasons.push(`${Math.round(delta)}F cool`);
  }

  if (values.dewPoint !== null) {
    if (values.dewPoint < 55) reasons.push("comfortable dew point");
    else if (values.dewPoint < 65) reasons.push("humid");
    else reasons.push("very humid");
  }

  if (values.precipProbability <= 10 && values.qpf <= 0.01) {
    reasons.push("low rain risk");
  } else if (values.precipProbability >= 50 || values.qpf >= 0.05) {
    reasons.push("rain likely");
  } else {
    reasons.push(`${Math.round(values.precipProbability)}% rain`);
  }

  if (values.windSpeed <= 10 && values.windGust <= 20) {
    reasons.push("manageable wind");
  } else {
    reasons.push("windy");
  }

  return reasons.slice(0, 4);
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
