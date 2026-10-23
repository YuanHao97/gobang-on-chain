import { applyVercelCors, isAllowedOrigin, parseAllowedOrigins } from "../src/cors.mjs";
import { createSepoliaRelayer } from "../src/relay.mjs";

const MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_REQUESTS_PER_MINUTE = 30;
let relayerPromise;
let transactionQueue = Promise.resolve();
const clients = new Map();

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

function clientAddress(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  return (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0]?.trim())
    || request.socket?.remoteAddress
    || "unknown";
}

function withinRateLimit(request) {
  const limit = Number(process.env.RELAY_REQUESTS_PER_MINUTE || DEFAULT_REQUESTS_PER_MINUTE);
  const now = Date.now();
  const key = clientAddress(request);
  const current = clients.get(key);
  const state = !current || now - current.startedAt >= 60_000
    ? { startedAt: now, count: 0 }
    : current;
  state.count += 1;
  clients.set(key, state);
  return state.count <= limit;
}

function enqueue(action) {
  const result = transactionQueue.then(action, action);
  transactionQueue = result.catch(() => undefined);
  return result;
}

async function configuredRelayer() {
  relayerPromise ||= Promise.resolve().then(() => createSepoliaRelayer());
  return relayerPromise;
}

export function createVercelRelayHandler({ getRelayer = configuredRelayer } = {}) {
  return async function relayHandler(request, response) {
    const origin = request.headers.origin;
    const allowedOrigins = parseAllowedOrigins(process.env.RELAY_ALLOWED_ORIGINS || process.env.AI_ALLOWED_ORIGINS);
    applyVercelCors(response, origin, allowedOrigins, "POST, OPTIONS");

    if (!isAllowedOrigin(origin, allowedOrigins)) {
      return response.status(403).json({ error: "This origin is not allowed." });
    }
    if (request.method === "OPTIONS") return response.status(204).end();
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS");
      return response.status(405).json({ error: "Method not allowed." });
    }
    if (!withinRateLimit(request)) {
      return response.status(429).json({ error: "Too many relay requests. Try again in a minute." });
    }

    try {
      const operation = String(request.query?.operation || "");
      if (!["activate", "move", "computerPrepare", "computerJoin", "computerMove"].includes(operation)) {
        return response.status(404).json({ error: "Unknown relay operation." });
      }
      const body = requestBody(request);
      const result = await enqueue(async () => {
        const relayer = await getRelayer();
        return relayer[operation](body);
      });
      return response.status(200).json(result);
    } catch (error) {
      const message = error?.shortMessage || error?.message || "Relay request failed.";
      const status = message.includes("not configured") ? 503 : 400;
      return response.status(status).json({ error: message });
    }
  };
}

export default createVercelRelayHandler();

