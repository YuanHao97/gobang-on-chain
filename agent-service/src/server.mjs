import "dotenv/config";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { createGobangRecommender } from "./recommender.mjs";

const MAX_BODY_BYTES = 64 * 1024;

function parseAllowedOrigins(value) {
  return new Set((value || "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean));
}

function sendJson(response, status, payload, origin, allowedOrigins) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8"
  };
  if (origin && allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  response.writeHead(status, headers);
  response.end(JSON.stringify(payload));
}

async function parseBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw new Error("The request body is too large.");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function createRecommendationServer({
  recommend,
  allowedOrigins = parseAllowedOrigins(process.env.AI_ALLOWED_ORIGINS),
  requestsPerMinute = Number(process.env.AI_REQUESTS_PER_MINUTE || 10)
}) {
  const clients = new Map();

  return http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return sendJson(response, 403, { error: "This origin is not allowed." }, origin, allowedOrigins);
    }
    if (request.method === "OPTIONS") return sendJson(response, 204, {}, origin, allowedOrigins);
    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, { ok: true, service: "gobang-agentkit-recommender" }, origin, allowedOrigins);
    }
    if (request.method !== "POST" || request.url !== "/recommend") {
      return sendJson(response, 404, { error: "Unknown endpoint." }, origin, allowedOrigins);
    }

    const now = Date.now();
    const forwardedFor = request.headers["x-forwarded-for"];
    const clientId = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0]?.trim())
      || request.socket.remoteAddress
      || "unknown";
    const current = clients.get(clientId);
    const windowState = !current || now - current.startedAt >= 60_000
      ? { startedAt: now, count: 0 }
      : current;
    windowState.count += 1;
    clients.set(clientId, windowState);
    if (windowState.count > requestsPerMinute) {
      return sendJson(response, 429, { error: "Too many recommendation requests. Try again in a minute." }, origin, allowedOrigins);
    }

    try {
      const input = await parseBody(request);
      const recommendation = await recommend(input);
      return sendJson(response, 200, recommendation, origin, allowedOrigins);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recommendation failed.";
      const status = message.includes("OpenAI") || message.includes("model") ? 502 : 400;
      return sendJson(response, status, { error: message }, origin, allowedOrigins);
    }
  });
}

async function main() {
  const host = process.env.AI_RECOMMENDER_HOST || "127.0.0.1";
  const port = Number(process.env.PORT || process.env.AI_RECOMMENDER_PORT || 8790);
  const recommend = await createGobangRecommender();
  const server = createRecommendationServer({ recommend });
  server.listen(port, host, () => {
    console.log(`AgentKit move recommender is ready at http://${host}:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
