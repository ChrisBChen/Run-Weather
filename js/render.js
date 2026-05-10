export function renderStatus(element, { message = "", tone = "info" } = {}) {
  element.textContent = message;
  element.className = "status-banner";

  if (!message) return;

  element.classList.add("is-visible");
  if (tone === "error") element.classList.add("is-error");
  if (tone === "warning") element.classList.add("is-warning");
}

export function renderBestRun(element, bestHour) {
  if (!bestHour) {
    element.replaceChildren();
    return;
  }

  element.innerHTML = `
    <div>
      <p class="best-kicker">Recommendation</p>
      <h2 class="best-title">${escapeHtml(formatDayAndTime(bestHour))}</h2>
      <p class="best-copy">${escapeHtml(summarySentence(bestHour))}</p>
    </div>
    <div class="score-pill" aria-label="Comfort score ${bestHour.score} out of 100">
      <strong>${bestHour.score}</strong>
      <span>score</span>
    </div>
  `;
}

export function renderDayCards(element, rankedDays) {
  if (!rankedDays.length) {
    element.innerHTML = `<div class="day-card is-empty">No hourly forecast rows are available yet.</div>`;
    return;
  }

  element.innerHTML = rankedDays.map(renderDayCard).join("");
}

export function renderHourlyDetail(element, rankedDays) {
  if (!rankedDays.length) {
    element.innerHTML = `<div class="empty-state">No hourly details yet.</div>`;
    return;
  }

  element.innerHTML = rankedDays.map(renderHourGroup).join("");
}

export function renderScoreChart(element, rankedDays) {
  const points = rankedDays.flatMap((day) => day.hours.map((hour) => ({ ...hour, dayLabel: day.label })));

  if (points.length < 2) {
    element.innerHTML = `<div class="empty-state">No score chart yet.</div>`;
    return;
  }

  const width = 900;
  const height = 260;
  const left = 46;
  const right = 18;
  const top = 18;
  const bottom = 42;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const xFor = (index) => left + (index / Math.max(points.length - 1, 1)) * chartWidth;
  const yFor = (score) => top + (1 - score / 100) * chartHeight;
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${xFor(index).toFixed(2)} ${yFor(point.score).toFixed(2)}`)
    .join(" ");
  const dayStarts = rankedDays
    .map((day) => ({ day, index: points.findIndex((point) => point.dateKey === day.dateKey) }))
    .filter((entry) => entry.index >= 0);
  const best = points.reduce((winner, point) => (point.score > winner.score ? point : winner), points[0]);
  const bestIndex = points.indexOf(best);

  element.innerHTML = `
    <svg class="score-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Hourly run score over time">
      <g class="chart-grid">
        ${[0, 25, 50, 75, 100]
          .map((score) => {
            const y = yFor(score);
            return `
              <line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line>
              <text x="8" y="${y + 4}">${score}</text>
            `;
          })
          .join("")}
      </g>
      <g class="chart-day-lines">
        ${dayStarts
          .map(({ day, index }) => {
            const x = xFor(index);
            return `
              <line x1="${x}" y1="${top}" x2="${x}" y2="${height - bottom}"></line>
              <text x="${x + 6}" y="${height - 14}">${escapeHtml(day.label)}</text>
            `;
          })
          .join("")}
      </g>
      <path class="score-line" d="${linePath}"></path>
      <circle class="score-active-point" cx="${xFor(bestIndex)}" cy="${yFor(best.score)}" r="6"></circle>
      <circle class="score-best-point" cx="${xFor(bestIndex)}" cy="${yFor(best.score)}" r="5"></circle>
      <g class="score-hit-targets">
        ${points
          .map(
            (point, index) => `
              <circle
                class="score-hit-target"
                tabindex="0"
                role="button"
                aria-label="${escapeHtml(chartPointLabel(point))}"
                data-chart-index="${index}"
                cx="${xFor(index)}"
                cy="${yFor(point.score)}"
                r="9"
              >
                <title>${escapeHtml(chartPointLabel(point))}</title>
              </circle>
            `,
          )
          .join("")}
      </g>
    </svg>
    <div class="chart-summary" aria-live="polite">
      <span class="chart-summary-label">Selected hour:</span>
      <span data-chart-readout>${renderChartReadout(best)}</span>
    </div>
  `;

  const activePoint = element.querySelector(".score-active-point");
  const readout = element.querySelector("[data-chart-readout]");

  for (const target of element.querySelectorAll("[data-chart-index]")) {
    const index = Number(target.getAttribute("data-chart-index"));
    const point = points[index];
    const setActive = () => {
      activePoint.setAttribute("cx", target.getAttribute("cx"));
      activePoint.setAttribute("cy", target.getAttribute("cy"));
      readout.innerHTML = renderChartReadout(point);
    };

    target.addEventListener("pointerenter", setActive);
    target.addEventListener("focus", setActive);
    target.addEventListener("click", setActive);
  }
}

export function renderForecastUpdated(element, forecast, sourceLocation) {
  if (!forecast) {
    element.textContent = "";
    return;
  }

  const updated = forecast.fetchedAt ? new Date(forecast.fetchedAt) : null;
  const updatedLabel =
    updated && !Number.isNaN(updated.getTime())
      ? new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(updated)
      : "just now";

  element.textContent = `${sourceLocation.label || forecast.locationName || "Forecast"} updated ${updatedLabel}`;
}

export function renderLocationSummary(element, location, forecast) {
  const name = forecast?.locationName || location.label || "Selected location";
  element.textContent = `${name} (${formatCoordinate(location.latitude)}, ${formatCoordinate(location.longitude)})`;
}

function renderDayCard(day) {
  if (!day.top.length) {
    return `
      <article class="day-card is-empty">
        <h3>${escapeHtml(day.label)}</h3>
        <p class="date-label">${escapeHtml(formatDateKey(day.dateKey))}</p>
        <p>No ranked hours are available for this day.</p>
      </article>
    `;
  }

  const fallback = day.usedAllHoursFallback
    ? `<p class="muted">Showing all hours because no rows matched the default run window.</p>`
    : "";

  return `
    <article class="day-card">
      <h3>${escapeHtml(day.label)}</h3>
      <p class="date-label">${escapeHtml(formatDateKey(day.dateKey))}</p>
      ${fallback}
      <ol class="window-list">
        ${day.top.map(renderWindow).join("")}
      </ol>
    </article>
  `;
}

function renderWindow(hour) {
  return `
    <li class="run-window">
      <div class="time-block">${escapeHtml(formatHour(hour))}</div>
      <div class="window-metrics">
        <strong>${formatNumber(hour.apparentTemperature)}F apparent</strong>
        · ${formatNumber(hour.temperature)}F temp
        · ${formatNumber(hour.dewPoint)}F dew
        · ${formatRain(hour)}
        <div class="reason-list">
          ${hour.reasons.map((reason) => renderReason(reason)).join("")}
        </div>
      </div>
      <div class="mini-score">${hour.score}</div>
    </li>
  `;
}

function renderHourGroup(day) {
  const rows = day.hours.map(renderHourRow).join("");

  return `
    <details class="hour-group" ${day.label === "Today" ? "open" : ""}>
      <summary>
        <span>${escapeHtml(day.label)}</span>
        <span class="muted">${escapeHtml(formatDateKey(day.dateKey))}</span>
      </summary>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Score</th>
              <th>Apparent</th>
              <th>Temp</th>
              <th>Dew</th>
              <th>Rain</th>
              <th>Wind</th>
              <th>Forecast</th>
              <th>Pace Adj.</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>
  `;
}

function renderHourRow(hour) {
  return `
    <tr>
      <td>${escapeHtml(formatHour(hour))}</td>
      <td class="score-cell">${hour.score}</td>
      <td>${formatNumber(hour.apparentTemperature)}F</td>
      <td>${formatNumber(hour.temperature)}F</td>
      <td>${formatNumber(hour.dewPoint)}F</td>
      <td class="rain-cell">${escapeHtml(formatRain(hour))}</td>
      <td>${escapeHtml(formatWind(hour))}</td>
      <td>${escapeHtml(hour.forecastLabel || "Unavailable")}</td>
      <td>${formatPaceAdjustment(hour.paceAdjustment)}</td>
    </tr>
  `;
}

function renderChartReadout(hour) {
  return `
    <strong>${escapeHtml(formatDateKey(hour.dateKey))} ${escapeHtml(formatHour(hour))}</strong>
    · score <strong>${hour.score}</strong>
    · ${escapeHtml(summarySentence(hour))}
  `;
}

function chartPointLabel(hour) {
  return `${formatDateKey(hour.dateKey)} ${formatHour(hour)}, score ${hour.score}, ${summarySentence(hour)}`;
}

function renderReason(reason) {
  const rainClass = reason.includes("rain") ? " is-rain" : "";
  return `<span class="reason-chip${rainClass}">${escapeHtml(reason)}</span>`;
}

function summarySentence(hour) {
  return `${formatNumber(hour.apparentTemperature)}F apparent, ${formatNumber(hour.dewPoint)}F dew point, ${formatRain(hour)}, ${formatWind(hour).toLowerCase()}.`;
}

function formatDayAndTime(hour) {
  return `${formatDateKey(hour.dateKey)} at ${formatHour(hour)}`;
}

function formatDateKey(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatHour(hour) {
  const localHour = hour.localHour;
  if (!Number.isFinite(localHour)) return "Unknown";

  const suffix = localHour >= 12 ? "PM" : "AM";
  const displayHour = localHour % 12 || 12;
  return `${displayHour} ${suffix}`;
}

function formatRain(hour) {
  const probability = Number.isFinite(hour.precipProbability) ? `${Math.round(hour.precipProbability)}%` : "n/a";
  const label = hour.rainLabel && hour.rainLabel !== "none" ? ` ${hour.rainLabel}` : "";
  return `${probability}${label}`;
}

function formatWind(hour) {
  const sustained = Number.isFinite(hour.windSpeed) ? `${Math.round(hour.windSpeed)} mph` : "n/a";
  const gust = Number.isFinite(hour.windGust) ? `, gust ${Math.round(hour.windGust)}` : "";
  return `${sustained}${gust}`;
}

function formatPaceAdjustment(value) {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`;
}

function formatNumber(value) {
  return Number.isFinite(value) ? `${Math.round(value)}` : "n/a";
}

function formatCoordinate(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(4) : "n/a";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
