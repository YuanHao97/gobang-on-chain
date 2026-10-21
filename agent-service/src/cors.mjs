const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "https://yuanhao97.github.io"
];

function normalizeOrigin(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  try {
    return new URL(candidate).origin;
  } catch {
    return candidate.replace(/\/$/, "");
  }
}

export function parseAllowedOrigins(value) {
  const configured = String(value || "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

export function applyVercelCors(response, origin, allowedOrigins, methods = "GET, POST, OPTIONS") {
  response.setHeader("Access-Control-Allow-Methods", methods);
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "86400");
  response.setHeader("Vary", "Origin");
  if (origin && allowedOrigins.has(normalizeOrigin(origin))) {
    response.setHeader("Access-Control-Allow-Origin", normalizeOrigin(origin));
  }
}

export function isAllowedOrigin(origin, allowedOrigins) {
  return !origin || allowedOrigins.has(normalizeOrigin(origin));
}

