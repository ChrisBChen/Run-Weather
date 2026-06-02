import { DEFAULT_LOCATION, fetchWeatherGovForecast } from "./weatherGov.js";
import { rankForecast } from "./scoring.js";
import {
  renderBestRun,
  renderDayCards,
  renderForecastUpdated,
  renderHourlyDetail,
  renderLocationSummary,
  renderScoreChart,
  renderStatus,
} from "./render.js";

const STORAGE_KEY = "run-weather-recommender:v1";

const elements = {
  latitude: document.querySelector("#latitude-input"),
  longitude: document.querySelector("#longitude-input"),
  useLocation: document.querySelector("#use-location"),
  useManual: document.querySelector("#use-manual"),
  refresh: document.querySelector("#refresh-weather"),
  days: document.querySelector("#days-select"),
  showAllHours: document.querySelector("#show-all-hours"),
  status: document.querySelector("#status-banner"),
  bestRun: document.querySelector("#best-run"),
  dayCards: document.querySelector("#day-cards"),
  scoreChart: document.querySelector("#score-chart"),
  hourlyDetail: document.querySelector("#hourly-detail"),
  locationSummary: document.querySelector("#location-summary"),
  forecastUpdated: document.querySelector("#forecast-updated"),
};

const state = {
  location: loadStoredLocation() || DEFAULT_LOCATION,
  forecast: null,
  ranked: null,
  daysCount: Number(elements.days.value) || 3,
  showAllHours: elements.showAllHours.checked,
  loading: false,
};

init();

function init() {
  syncLocationInputs();
  bindEvents();
  render();
  loadForecast(state.location, { message: "Loading demo forecast..." });
}

function bindEvents() {
  elements.useLocation.addEventListener("click", requestBrowserLocation);
  elements.useManual.addEventListener("click", useManualLocation);
  elements.refresh.addEventListener("click", () => loadForecast(state.location, { message: "Refreshing forecast..." }));
  elements.days.addEventListener("change", () => {
    state.daysCount = Number(elements.days.value) || 3;
    recalculate();
  });
  elements.showAllHours.addEventListener("change", () => {
    state.showAllHours = elements.showAllHours.checked;
    recalculate();
  });
}

async function requestBrowserLocation() {
  if (!navigator.geolocation) {
    renderStatus(elements.status, {
      message: "Geolocation is not available in this browser. Enter coordinates instead.",
      tone: "warning",
    });
    return;
  }

  setLoading(true);
  renderStatus(elements.status, { message: "Requesting your location..." });

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const location = {
        latitude: roundCoordinate(position.coords.latitude),
        longitude: roundCoordinate(position.coords.longitude),
        label: "Your location",
      };
      syncLocation(location);
      loadForecast(location, { message: "Loading forecast for your location..." });
    },
    (error) => {
      setLoading(false);
      renderStatus(elements.status, {
        message: geolocationErrorMessage(error),
        tone: "warning",
      });
    },
    {
      enableHighAccuracy: false,
      maximumAge: 10 * 60 * 1000,
      timeout: 12 * 1000,
    },
  );
}

function useManualLocation() {
  const latitude = Number(elements.latitude.value);
  const longitude = Number(elements.longitude.value);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    renderStatus(elements.status, { message: "Enter a latitude between -90 and 90.", tone: "error" });
    elements.latitude.focus();
    return;
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    renderStatus(elements.status, { message: "Enter a longitude between -180 and 180.", tone: "error" });
    elements.longitude.focus();
    return;
  }

  const location = {
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
    label: "Manual location",
  };
  syncLocation(location);
  loadForecast(location, { message: "Loading forecast for coordinates..." });
}

async function loadForecast(location, { message } = {}) {
  setLoading(true);
  renderStatus(elements.status, { message: message || "Loading forecast..." });

  try {
    const forecast = await fetchWeatherGovForecast(location);
    state.location = location;
    state.forecast = forecast;
    storeLocation(location);
    recalculate({ silent: true });
    renderStatus(elements.status, {
      message: `Loaded ${forecast.hours.length} hourly rows from Weather.gov.`,
    });
  } catch (error) {
    state.forecast = null;
    state.ranked = null;
    render();
    renderStatus(elements.status, {
      message: `${error.message} Weather.gov DWML forecasts are US-only; try another US coordinate.`,
      tone: "error",
    });
  } finally {
    setLoading(false);
  }
}

function recalculate({ silent = false } = {}) {
  if (!state.forecast) {
    state.ranked = null;
    render();
    return;
  }

  state.ranked = rankForecast(state.forecast.hours, {
    daysCount: state.daysCount,
    showAllHours: state.showAllHours,
    latitude: state.location.latitude,
  });
  render();

  if (!silent) {
    renderStatus(elements.status, { message: "Updated ranking." });
  }
}

function render() {
  renderLocationSummary(elements.locationSummary, state.location, state.forecast);
  renderForecastUpdated(elements.forecastUpdated, state.forecast, state.location);
  renderBestRun(elements.bestRun, state.ranked?.bestOverall || null);
  renderDayCards(elements.dayCards, state.ranked?.days || []);
  renderScoreChart(elements.scoreChart, state.ranked?.days || []);
  renderHourlyDetail(elements.hourlyDetail, state.ranked?.days || []);
}

function syncLocation(location) {
  state.location = location;
  syncLocationInputs();
  renderLocationSummary(elements.locationSummary, state.location, state.forecast);
}

function syncLocationInputs() {
  elements.latitude.value = Number(state.location.latitude).toFixed(5);
  elements.longitude.value = Number(state.location.longitude).toFixed(5);
}

function setLoading(isLoading) {
  state.loading = isLoading;
  elements.useLocation.disabled = isLoading;
  elements.useManual.disabled = isLoading;
  elements.refresh.disabled = isLoading;
}

function loadStoredLocation() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed.latitude) || !Number.isFinite(parsed.longitude)) return null;
    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      label: parsed.label || "Last location",
    };
  } catch {
    return null;
  }
}

function storeLocation(location) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        latitude: location.latitude,
        longitude: location.longitude,
        label: location.label,
        savedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Local storage can fail in private browsing modes; the app still works without it.
  }
}

function geolocationErrorMessage(error) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location access was denied. Enter coordinates instead.";
  }
  if (error.code === error.TIMEOUT) {
    return "Location lookup timed out. Enter coordinates or try again.";
  }
  return "Location lookup failed. Enter coordinates instead.";
}

function roundCoordinate(value) {
  return Math.round(Number(value) * 100000) / 100000;
}
