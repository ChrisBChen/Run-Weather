export const DEFAULT_LOCATION = Object.freeze({
  latitude: 42.3293,
  longitude: -71.1120,
  label: "Demo location",
});

const WEATHER_GOV_DWML_URL = "https://forecast.weather.gov/MapClick.php";

export function buildWeatherGovUrl({ latitude, longitude }) {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("Latitude must be between -90 and 90.");
  }

  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error("Longitude must be between -180 and 180.");
  }

  const url = new URL(WEATHER_GOV_DWML_URL);
  url.searchParams.set("lat", lat.toFixed(5));
  url.searchParams.set("lon", lon.toFixed(5));
  url.searchParams.set("FcstType", "digitalDWML");
  return url.toString();
}

export async function fetchWeatherGovForecast(location, fetcher = globalThis.fetch) {
  if (typeof fetcher !== "function") {
    throw new Error("Fetch is not available in this browser.");
  }

  const sourceUrl = buildWeatherGovUrl(location);
  const response = await fetcher(sourceUrl, {
    headers: {
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Weather.gov returned ${response.status}.`);
  }

  const xmlText = await response.text();
  const forecast = parseWeatherGovDwml(xmlText);

  if (!forecast.hours.length) {
    throw new Error("Weather.gov did not return hourly forecast rows for this location.");
  }

  return {
    ...forecast,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
  };
}

export function parseWeatherGovDwml(xmlText) {
  if (typeof xmlText !== "string" || !xmlText.trim()) {
    throw new Error("Forecast XML is empty.");
  }

  if (typeof DOMParser !== "undefined") {
    return parseWithDom(xmlText);
  }

  return parseWithText(xmlText);
}

function parseWithDom(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];

  if (parserError) {
    throw new Error("Weather.gov returned invalid XML.");
  }

  const hourlyTemperatureNode = findByAttribute(doc, "temperature", "type", "hourly");
  const timeLayoutKey = hourlyTemperatureNode?.getAttribute("time-layout") || firstLayoutKey(doc);
  const times = readTimesFromDom(doc, timeLayoutKey);

  const values = {
    temperature: readNumericValues(hourlyTemperatureNode),
    dewPoint: readNumericValues(findByAttribute(doc, "temperature", "type", "dew point")),
    heatIndex: readNumericValues(findByAttribute(doc, "temperature", "type", "heat index")),
    windChill: readNumericValues(findByAttribute(doc, "temperature", "type", "wind chill")),
    precipProbability: readNumericValues(
      findByAttribute(doc, "probability-of-precipitation", "type", "floating"),
    ),
    qpf: readNumericValues(findByAttribute(doc, "hourly-qpf", "type", "floating")),
    windSpeed: readNumericValues(findByAttribute(doc, "wind-speed", "type", "sustained")),
    windGust: readNumericValues(findByAttribute(doc, "wind-speed", "type", "gust")),
    cloudCover: readNumericValues(doc.getElementsByTagName("cloud-amount")[0]),
    humidity: readNumericValues(findByAttribute(doc, "humidity", "type", "relative")),
    rainLabel: readWeatherLabelsFromDom(doc),
  };

  return buildForecast(times, values, {
    locationName: getText(doc.getElementsByTagName("description")[0]) || getText(doc.getElementsByTagName("city")[0]),
    createdAt: doc.getElementsByTagName("creation-date")[0]?.textContent?.trim() || null,
  });
}

function parseWithText(xmlText) {
  const hourlyTemperatureBlock = findOpeningBlock(xmlText, "temperature", 'type="hourly"');
  const timeLayoutKey = getAttribute(hourlyTemperatureBlock?.opening || "", "time-layout");
  const timeLayoutBlock = timeLayoutKey ? findTimeLayoutBlock(xmlText, timeLayoutKey) : null;
  const times = readTimesFromText(timeLayoutBlock?.body || "");

  const values = {
    temperature: readNumericValuesFromText(hourlyTemperatureBlock?.body || ""),
    dewPoint: readNumericValuesFromText(findOpeningBlock(xmlText, "temperature", 'type="dew point"')?.body || ""),
    heatIndex: readNumericValuesFromText(findOpeningBlock(xmlText, "temperature", 'type="heat index"')?.body || ""),
    windChill: readNumericValuesFromText(findOpeningBlock(xmlText, "temperature", 'type="wind chill"')?.body || ""),
    precipProbability: readNumericValuesFromText(
      findOpeningBlock(xmlText, "probability-of-precipitation", 'type="floating"')?.body || "",
    ),
    qpf: readNumericValuesFromText(findOpeningBlock(xmlText, "hourly-qpf", 'type="floating"')?.body || ""),
    windSpeed: readNumericValuesFromText(findOpeningBlock(xmlText, "wind-speed", 'type="sustained"')?.body || ""),
    windGust: readNumericValuesFromText(findOpeningBlock(xmlText, "wind-speed", 'type="gust"')?.body || ""),
    cloudCover: readNumericValuesFromText(findOpeningBlock(xmlText, "cloud-amount")?.body || ""),
    humidity: readNumericValuesFromText(findOpeningBlock(xmlText, "humidity", 'type="relative"')?.body || ""),
    rainLabel: readWeatherLabelsFromText(findOpeningBlock(xmlText, "weather")?.body || ""),
  };

  return buildForecast(times, values, {
    locationName: textBetween(xmlText, "description") || textBetween(xmlText, "city"),
    createdAt: textBetween(xmlText, "creation-date"),
  });
}

function buildForecast(times, values, metadata) {
  const hours = times
    .map((iso, index) => {
      const time = new Date(iso);
      if (Number.isNaN(time.getTime())) return null;

      const temperature = valueAt(values.temperature, index);
      const dewPoint = valueAt(values.dewPoint, index);
      const humidity = valueAt(values.humidity, index);
      const windSpeed = valueAt(values.windSpeed, index);
      const apparentTemperature =
        valueAt(values.heatIndex, index) ??
        valueAt(values.windChill, index) ??
        computeApparentTemperature(temperature, dewPoint, humidity, windSpeed);

      return {
        isoTime: iso,
        time,
        dateKey: iso.slice(0, 10),
        localHour: readIsoHour(iso),
        temperature,
        dewPoint,
        humidity,
        apparentTemperature,
        precipProbability: valueAt(values.precipProbability, index),
        qpf: valueAt(values.qpf, index),
        rainLabel: normalizeRainLabel(valueAt(values.rainLabel, index)),
        windSpeed,
        windGust: valueAt(values.windGust, index),
        cloudCover: valueAt(values.cloudCover, index),
        forecastLabel: labelCloudCover(valueAt(values.cloudCover, index)),
      };
    })
    .filter(Boolean);

  return {
    ...metadata,
    hours,
  };
}

export function computeApparentTemperature(temperatureF, dewPointF, humidityPct, windMph) {
  if (!Number.isFinite(temperatureF)) return null;

  if (temperatureF >= 80 && Number.isFinite(humidityPct) && (!Number.isFinite(dewPointF) || dewPointF > 54)) {
    return round1(
      -42.379 +
        2.04901523 * temperatureF +
        10.14333127 * humidityPct -
        0.22475541 * temperatureF * humidityPct -
        0.00683783 * temperatureF ** 2 -
        0.05481717 * humidityPct ** 2 +
        0.00122874 * temperatureF ** 2 * humidityPct +
        0.00085282 * temperatureF * humidityPct ** 2 -
        0.00000199 * temperatureF ** 2 * humidityPct ** 2,
    );
  }

  if (temperatureF < 50 && Number.isFinite(windMph) && windMph > 3) {
    return round1(
      35.74 +
        0.6215 * temperatureF -
        35.75 * windMph ** 0.16 +
        0.4275 * temperatureF * windMph ** 0.16,
    );
  }

  return round1(temperatureF);
}

export function labelCloudCover(cloudCover) {
  if (!Number.isFinite(cloudCover)) return "Forecast unavailable";
  if (cloudCover < 12.5) return "Clear/Sunny";
  if (cloudCover < 37.5) return "Mostly Clear/Mostly Sunny";
  if (cloudCover < 62.5) return "Partly Cloudy/Partly Sunny";
  if (cloudCover < 87.5) return "Mostly Cloudy";
  return "Cloudy";
}

function findByAttribute(doc, tagName, attributeName, attributeValue) {
  return Array.from(doc.getElementsByTagName(tagName)).find(
    (node) => node.getAttribute(attributeName) === attributeValue,
  );
}

function firstLayoutKey(doc) {
  return getText(doc.getElementsByTagName("layout-key")[0]);
}

function readTimesFromDom(doc, layoutKey) {
  const layouts = Array.from(doc.getElementsByTagName("time-layout"));
  const layout =
    layouts.find((candidate) => getText(candidate.getElementsByTagName("layout-key")[0]) === layoutKey) ||
    layouts[0];

  return Array.from(layout?.getElementsByTagName("start-valid-time") || [])
    .map((node) => node.textContent?.trim())
    .filter(Boolean);
}

function readNumericValues(node) {
  if (!node) return [];

  return Array.from(node.children)
    .filter((child) => child.localName === "value" || child.tagName === "value")
    .map((valueNode) => {
      const nilValue =
        valueNode.getAttribute("xsi:nil") === "true" ||
        valueNode.getAttribute("nil") === "true" ||
        valueNode.hasAttribute("xsi:nil");

      if (nilValue) return null;
      const value = Number.parseFloat(valueNode.textContent || "");
      return Number.isFinite(value) ? value : null;
    });
}

function readWeatherLabelsFromDom(doc) {
  const weatherNode = doc.getElementsByTagName("weather")[0];
  if (!weatherNode) return [];

  return Array.from(weatherNode.getElementsByTagName("weather-conditions")).map((conditionsNode) => {
    const nilValue =
      conditionsNode.getAttribute("xsi:nil") === "true" ||
      conditionsNode.getAttribute("nil") === "true" ||
      conditionsNode.hasAttribute("xsi:nil");

    if (nilValue) return "none";

    const values = Array.from(conditionsNode.getElementsByTagName("value"));
    const rainValue =
      values.find((node) => node.getAttribute("weather-type") === "rain") ||
      values.find((node) => node.getAttribute("weather-type") === "thunderstorms") ||
      values[0];

    return rainValue?.getAttribute("coverage") || rainValue?.getAttribute("weather-type") || "none";
  });
}

function findOpeningBlock(xmlText, tagName, attrNeedle = "") {
  const escapedTag = escapeRegExp(tagName);
  const escapedNeedle = escapeRegExp(attrNeedle);
  const needlePattern = attrNeedle ? `(?=[^>]*${escapedNeedle})` : "";
  const pattern = new RegExp(`<${escapedTag}(?=[\\s>/])${needlePattern}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i");
  const match = xmlText.match(pattern);

  if (!match) return null;

  return {
    opening: match[0].slice(0, match[0].indexOf(">") + 1),
    body: match[1],
  };
}

function findTimeLayoutBlock(xmlText, layoutKey) {
  const pattern = /<time-layout\b[^>]*>([\s\S]*?)<\/time-layout>/gi;
  let match;

  while ((match = pattern.exec(xmlText))) {
    if (textBetween(match[1], "layout-key") === layoutKey) {
      return { body: match[1] };
    }
  }

  return null;
}

function readTimesFromText(body) {
  const matches = [...body.matchAll(/<start-valid-time\b[^>]*>([\s\S]*?)<\/start-valid-time>/gi)];
  return matches.map((match) => decodeXml(match[1].trim())).filter(Boolean);
}

function readNumericValuesFromText(body) {
  const values = [];
  const pattern = /<value\b([^>]*)\/>|<value\b([^>]*)>([\s\S]*?)<\/value>/gi;
  let match;

  while ((match = pattern.exec(body))) {
    const attrs = match[1] || match[2] || "";
    const nilValue = /\bnil\s*=\s*"true"|\bxsi:nil\s*=\s*"true"/i.test(attrs);

    if (nilValue) {
      values.push(null);
      continue;
    }

    const raw = decodeXml((match[3] || "").trim());
    const value = Number.parseFloat(raw);
    values.push(Number.isFinite(value) ? value : null);
  }

  return values;
}

function readWeatherLabelsFromText(body) {
  const labels = [];
  const pattern = /<weather-conditions\b([^>]*)\/>|<weather-conditions\b([^>]*)>([\s\S]*?)<\/weather-conditions>/gi;
  let match;

  while ((match = pattern.exec(body))) {
    const attrs = match[1] || match[2] || "";
    if (/\bnil\s*=\s*"true"|\bxsi:nil\s*=\s*"true"/i.test(attrs)) {
      labels.push("none");
      continue;
    }

    const inner = match[3] || "";
    const valueMatches = [
      ...inner.matchAll(/<value\b([^>]*)\/>|<value\b([^>]*)>([\s\S]*?)<\/value>/gi),
    ];
    const rainValue =
      valueMatches.find((valueMatch) => /weather-type\s*=\s*"rain"/i.test(valueMatch[1] || valueMatch[2] || "")) ||
      valueMatches.find((valueMatch) => /weather-type\s*=\s*"thunderstorms"/i.test(valueMatch[1] || valueMatch[2] || "")) ||
      valueMatches[0];
    const valueAttrs = rainValue?.[1] || rainValue?.[2] || "";
    const coverage = getAttribute(valueAttrs, "coverage");
    const weatherType = getAttribute(valueAttrs, "weather-type");

    labels.push(coverage || weatherType || "none");
  }

  return labels;
}

function textBetween(xmlText, tagName) {
  const escapedTag = escapeRegExp(tagName);
  const pattern = new RegExp(`<${escapedTag}(?=[\\s>/])[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i");
  const match = xmlText.match(pattern);
  return match ? decodeXml(match[1].trim()) : "";
}

function getAttribute(text, attributeName) {
  const pattern = new RegExp(`${escapeRegExp(attributeName)}\\s*=\\s*"([^"]*)"`, "i");
  return text.match(pattern)?.[1] || "";
}

function getText(node) {
  return node?.textContent?.trim() || "";
}

function valueAt(values, index) {
  const value = values?.[index];
  return value === undefined ? null : value;
}

function readIsoHour(iso) {
  const hour = Number.parseInt(iso.slice(11, 13), 10);
  return Number.isFinite(hour) ? hour : null;
}

function normalizeRainLabel(label) {
  if (label === true || label === "true" || label === null || label === undefined || label === "") return "none";
  return String(label).trim().toLowerCase() || "none";
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function round1(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}
