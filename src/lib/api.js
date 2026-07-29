/* ------------------------------------------------------------------ *
 * Live world data — free, key-less public APIs
 *
 *   • Geocoding & weather:  Open-Meteo   (open-meteo.com)
 *   • Place summaries:      Wikipedia REST API
 *
 * All calls are best-effort: any failure resolves to null so the UI can
 * fall back gracefully (bundled atlas, or simply hide the card). Results
 * are cached in-memory for the session.
 *
 * NOTE ON PRODUCTION: these free tiers are generous but rate-limited with
 * no SLA. For a real launch, route these through a small serverless proxy
 * (see /api or a Vercel/Netlify function) to add server-side caching, respect
 * rate limits, and optionally swap in keyed providers (Google Places, etc.)
 * without exposing keys in client code.
 * ------------------------------------------------------------------ */

const _geoCache = new Map();
const _wxCache = new Map();
const _wikiCache = new Map();

// WMO weather codes -> [label, emoji]  (Open-Meteo uses WMO codes)
export function weatherFromCode(code) {
  const m = {
    0: ["Clear sky", "\u2600\uFE0F"], 1: ["Mainly clear", "\uD83C\uDF24\uFE0F"],
    2: ["Partly cloudy", "\u26C5"], 3: ["Overcast", "\u2601\uFE0F"],
    45: ["Fog", "\uD83C\uDF2B\uFE0F"], 48: ["Rime fog", "\uD83C\uDF2B\uFE0F"],
    51: ["Light drizzle", "\uD83C\uDF26\uFE0F"], 53: ["Drizzle", "\uD83C\uDF26\uFE0F"],
    55: ["Heavy drizzle", "\uD83C\uDF27\uFE0F"], 61: ["Light rain", "\uD83C\uDF26\uFE0F"],
    63: ["Rain", "\uD83C\uDF27\uFE0F"], 65: ["Heavy rain", "\uD83C\uDF27\uFE0F"],
    66: ["Freezing rain", "\uD83C\uDF27\uFE0F"], 67: ["Freezing rain", "\uD83C\uDF27\uFE0F"],
    71: ["Light snow", "\uD83C\uDF28\uFE0F"], 73: ["Snow", "\uD83C\uDF28\uFE0F"],
    75: ["Heavy snow", "\u2744\uFE0F"], 77: ["Snow grains", "\uD83C\uDF28\uFE0F"],
    80: ["Light showers", "\uD83C\uDF26\uFE0F"], 81: ["Showers", "\uD83C\uDF27\uFE0F"],
    82: ["Violent showers", "\u26C8\uFE0F"], 85: ["Snow showers", "\uD83C\uDF28\uFE0F"],
    86: ["Snow showers", "\u2744\uFE0F"], 95: ["Thunderstorm", "\u26C8\uFE0F"],
    96: ["Storm w/ hail", "\u26C8\uFE0F"], 99: ["Storm w/ hail", "\u26C8\uFE0F"],
  };
  return m[code] || ["\u2014", "\uD83C\uDF0D"];
}

async function fetchJSON(url, timeout = 8000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error("bad status " + r.status);
    return await r.json();
  } finally {
    clearTimeout(to);
  }
}

/** Geocoding: place name -> array of real locations (or null if API down). */
export async function geoSearch(name, count = 6) {
  const key = name.trim().toLowerCase();
  if (!key) return [];
  if (_geoCache.has(key)) return _geoCache.get(key);
  try {
    const url =
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}` +
      `&count=${count}&language=en&format=json`;
    const j = await fetchJSON(url);
    const out = (j.results || []).map((r) => ({
      name: r.name,
      lat: r.latitude,
      lng: r.longitude,
      country: r.country || "",
      region: r.admin1 || "",
      countryCode: r.country_code || "",
      population: r.population || 0,
      label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
    }));
    _geoCache.set(key, out);
    return out;
  } catch {
    return null; // signal "API unavailable" so caller can fall back
  }
}

/** Current weather at a coordinate (or null). */
export async function fetchWeather(lat, lng) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (_wxCache.has(key)) return _wxCache.get(key);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day` +
      `&timezone=auto`;
    const j = await fetchJSON(url);
    const c = j.current || {};
    const [desc, icon] = weatherFromCode(c.weather_code);
    const wx = {
      temp: Math.round(c.temperature_2m),
      feels: Math.round(c.apparent_temperature),
      wind: Math.round(c.wind_speed_10m),
      isDay: c.is_day === 1,
      desc,
      icon,
      tzOffset: j.utc_offset_seconds || 0,
      fetchedAt: Date.now(),
    };
    _wxCache.set(key, wx);
    return wx;
  } catch {
    return null;
  }
}

/** Wikipedia one-line summary for a place (or null). */
export async function fetchWiki(title) {
  const key = title.trim().toLowerCase();
  if (!key) return null;
  if (_wikiCache.has(key)) return _wikiCache.get(key);
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const j = await fetchJSON(url);
    if (j.type === "disambiguation" || !j.extract) throw new Error("no summary");
    const out = {
      extract: j.extract,
      url: j.content_urls && j.content_urls.desktop ? j.content_urls.desktop.page : null,
    };
    _wikiCache.set(key, out);
    return out;
  } catch {
    return null;
  }
}

/** Local wall-clock time at a place, given its UTC offset in seconds. */
export function localTimeAt(tzOffsetSec) {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const d = new Date(utcMs + tzOffsetSec * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
