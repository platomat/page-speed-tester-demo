const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatTime(hour, minute) {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function parseField(field) {
  if (field === "*") return { kind: "any" };
  if (field.startsWith("*/")) {
    const step = Number(field.slice(2));
    if (!Number.isFinite(step) || step <= 0) return { kind: "invalid" };
    return { kind: "step", step };
  }
  const parts = field.split(",").map((part) => {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      const values = [];
      for (let i = a; i <= b; i++) values.push(i);
      return values;
    }
    const n = Number(part);
    return Number.isFinite(n) ? [n] : null;
  });
  if (parts.some((p) => p == null)) return { kind: "invalid" };
  const values = [...new Set(parts.flat())].sort((a, b) => a - b);
  return { kind: "list", values };
}

function listText(values, formatter) {
  if (values.length === 1) return formatter(values[0]);
  if (values.length === 2) return `${formatter(values[0])} and ${formatter(values[1])}`;
  return `${values.slice(0, -1).map(formatter).join(", ")}, and ${formatter(values.at(-1))}`;
}

function weekdayName(d) {
  return WEEKDAYS[d] ?? String(d);
}

function monthName(m) {
  return (
    [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ][m - 1] ?? String(m)
  );
}

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

/**
 * Human-readable summary for supported 5-field cron expressions (instance local time).
 */
function describeCron(expression, timezone = "UTC") {
  const trimmed = expression?.trim();
  if (!trimmed) {
    return "No automatic schedule — manual runs only.";
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return "Cron must have 5 fields: minute hour day month weekday.";
  }

  const [minuteField, hourField, domField, monthField, dowField] = parts;
  const minute = parseField(minuteField);
  const hour = parseField(hourField);
  const dom = parseField(domField);
  const month = parseField(monthField);
  const dow = parseField(dowField);

  if ([minute, hour, dom, month, dow].some((f) => f.kind === "invalid")) {
    return "Could not parse this cron expression.";
  }

  const tzLabel = timezone && timezone !== "UTC" ? ` (${timezone})` : "";

  if (minute.kind === "step" && hour.kind === "any" && dom.kind === "any" && month.kind === "any" && dow.kind === "any") {
    const n = minute.step;
    return n === 1
      ? `Runs every minute${tzLabel}.`
      : `Runs every ${n} minutes${tzLabel}.`;
  }

  if (minute.kind === "list" && hour.kind === "any" && dom.kind === "any" && month.kind === "any" && dow.kind === "any") {
    return `Runs every hour at minute ${listText(minute.values, (m) => String(m))}${tzLabel}.`;
  }

  if (minute.kind === "list" && hour.kind === "step" && dom.kind === "any" && month.kind === "any" && dow.kind === "any") {
    const mins = minute.values.length === 1 ? `at minute ${minute.values[0]}` : `at minutes ${minute.values.join(", ")}`;
    return `Runs ${mins}, every ${hour.step} hours${tzLabel}.`;
  }

  if (minute.kind === "list" && hour.kind === "list" && dom.kind === "any" && month.kind === "any" && dow.kind === "any") {
    if (minute.values.length === 1 && hour.values.length === 1) {
      return `Runs every day at ${formatTime(hour.values[0], minute.values[0])}${tzLabel}.`;
    }
    const times = [];
    for (const h of hour.values) {
      for (const m of minute.values) {
        times.push(formatTime(h, m));
      }
    }
    return `Runs daily at ${listText(times, (t) => t)}${tzLabel}.`;
  }

  if (minute.kind === "list" && hour.kind === "list" && dom.kind === "any" && month.kind === "any" && dow.kind === "list") {
    if (minute.values.length === 1 && hour.values.length === 1) {
      const time = formatTime(hour.values[0], minute.values[0]);
      if (dow.values.length === 7) {
        return `Runs every day at ${time}${tzLabel}.`;
      }
      if (dow.values.length === 5 && dow.values.every((d) => d >= 1 && d <= 5)) {
        return `Runs on weekdays at ${time}${tzLabel}.`;
      }
      if (dow.values.length === 2 && dow.values.includes(0) && dow.values.includes(6)) {
        return `Runs on weekends at ${time}${tzLabel}.`;
      }
      return `Runs on ${listText(dow.values, weekdayName)} at ${time}${tzLabel}.`;
    }
  }

  if (minute.kind === "list" && hour.kind === "list" && dom.kind === "list" && month.kind === "any" && dow.kind === "any") {
    if (minute.values.length === 1 && hour.values.length === 1) {
      const time = formatTime(hour.values[0], minute.values[0]);
      if (dom.values.length === 1) {
        return `Runs on the ${ordinal(dom.values[0])} of each month at ${time}${tzLabel}.`;
      }
      return `Runs on days ${dom.values.join(", ")} of each month at ${time}${tzLabel}.`;
    }
  }

  if (minute.kind === "list" && hour.kind === "list" && dom.kind === "list" && month.kind === "list" && dow.kind === "any") {
    if (minute.values.length === 1 && hour.values.length === 1 && dom.values.length === 1 && month.values.length === 1) {
      const time = formatTime(hour.values[0], minute.values[0]);
      return `Runs once a year on ${monthName(month.values[0])} ${dom.values[0]} at ${time}${tzLabel}.`;
    }
  }

  if (minute.kind === "any" && hour.kind === "any" && dom.kind === "any" && month.kind === "any" && dow.kind === "any") {
    return `Runs every minute${tzLabel}.`;
  }

  return `Custom schedule${tzLabel}: ${trimmed}`;
}

function bindCronPreview(input, previewEl) {
  const update = () => {
    previewEl.textContent = describeCron(input.value, getInstanceTimezone());
  };
  input.addEventListener("input", update);
  input.addEventListener("change", update);
  update();
}

function refreshAllCronPreviews() {
  const tz = getInstanceTimezone();
  document.querySelectorAll("[data-cron-preview-for]").forEach((preview) => {
    const id = preview.getAttribute("data-cron-preview-for");
    const input = document.getElementById(id) ?? preview.closest("tr")?.querySelector('[data-field="cron"]');
    if (input) preview.textContent = describeCron(input.value, tz);
  });
  document.querySelectorAll("tr[data-project-id] [data-field='cron']").forEach((input) => {
    const preview = input.closest("td")?.querySelector(".cron-preview");
    if (preview) preview.textContent = describeCron(input.value, tz);
  });
}
