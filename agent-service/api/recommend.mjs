import { createGobangRecommender } from "../src/recommender.mjs";
import { applyVercelCors, isAllowedOrigin, parseAllowedOrigins } from "../src/cors.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_REQUESTS_PER_MINUTE = 10;
let recommenderPromise;

function clientAddress(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  return (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0]?.trim())
    || request.socket?.remoteAddress
    || "unknown";
}

function requestBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    const serialized = JSON.stringify(request.body);
    if (Buffer.byteLength(serialized) > MAX_BODY_BYTES) throw new Error("The request body is too large.");
    return request.body;
  }

  const raw = Buffer.isBuffer(request.body) ? request.body.toString("utf8") : String(request.body || "");
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new Error("The request body is too large.");
  return raw ? JSON.parse(raw) : {};
}

async function defaultRecommender(input) {
  recommenderPromise ||= createGobangRecommender();
  const recommend = await recommenderPromise;
  return recommend(input);
}

export function createVercelRecommendationHandler({
  recommend = defaultRecommender,
  allowedOrigins = parseAllowedOrigins(process.env.AI_ALLOWED_ORIGINS),
  requestsPerMinute = Number(process.env.AI_REQUESTS_PER_MINUTE || DEFAULT_REQUESTS_PER_MINUTE)
} = {}) {
  const clients = new Map();

  return async function recommendationHandler(request, response) {
    const origin = request.headers.origin;
    applyVercelCors(response, origin, allowedOrigins, "POST, OPTIONS");

    if (!isAllowedOrigin(origin, allowedOrigins)) {
      return response.status(403).json({ error: "This origin is not allowed." });
    }
    if (request.method === "OPTIONS") return response.status(204).end();
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS");
      return response.status(405).json({ error: "Method not allowed." });
    }

    const now = Date.now();
    const clientId = clientAddress(request);
    const current = clients.get(clientId);
    const windowState = !current || now - current.startedAt >= 60_000
      ? { startedAt: now, count: 0 }
      : current;
    windowState.count += 1;
    clients.set(clientId, windowState);
    if (windowState.count > requestsPerMinute) {
      return response.status(429).json({ error: "Too many recommendation requests. Try again in a minute." });
    }

    try {
      const recommendation = await recommend(requestBody(request));
      return response.status(200).json(recommendation);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recommendation failed.";
      const status = message.includes("DeepSeek") || message.includes("model") ? 502 : 400;
      return response.status(status).json({ error: message });
    }
  };
}

export default createVercelRecommendationHandler();
