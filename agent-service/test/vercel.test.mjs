import assert from "node:assert/strict";
import test from "node:test";
import healthHandler from "../api/health.mjs";
import { createVercelRecommendationHandler } from "../api/recommend.mjs";

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    payload: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
    end() { return this; }
  };
}

test("serves Vercel health responses", () => {
  const response = mockResponse();
  healthHandler({ method: "GET", headers: { origin: "https://yuanhao97.github.io" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "https://yuanhao97.github.io");
});

test("serves Vercel recommendation responses with approved CORS", async () => {
  const handler = createVercelRecommendationHandler({
    recommend: async () => ({ x: 7, y: 7, reason: "Center control.", confidence: 0.7 }),
    allowedOrigins: new Set(["https://yuanhao97.github.io"])
  });
  const request = {
    method: "POST",
    headers: { origin: "https://yuanhao97.github.io", "x-forwarded-for": "127.0.0.1" },
    body: { board: Array(225).fill(0), boardSize: 15, playerStone: 1 }
  };
  const response = mockResponse();

  await handler(request, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.x, 7);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "https://yuanhao97.github.io");
});

test("rejects unapproved Vercel browser origins", async () => {
  const handler = createVercelRecommendationHandler({
    recommend: async () => ({}),
    allowedOrigins: new Set(["https://yuanhao97.github.io"])
  });
  const response = mockResponse();

  await handler({ method: "POST", headers: { origin: "https://untrusted.example" }, body: {} }, response);
  assert.equal(response.statusCode, 403);
});

test("normalizes configured origins that include a path", async () => {
  const previousOrigins = process.env.AI_ALLOWED_ORIGINS;
  process.env.AI_ALLOWED_ORIGINS = "https://yuanhao97.github.io/gobang-on-chain/";
  try {
    const response = mockResponse();
    await createVercelRecommendationHandler({
      recommend: async () => ({ x: 7 }),
      allowedOrigins: undefined
    })({
      method: "OPTIONS",
      headers: { origin: "https://yuanhao97.github.io" }
    }, response);
    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["Access-Control-Allow-Origin"], "https://yuanhao97.github.io");
    assert.equal(response.headers.Vary, "Origin");
  } finally {
    if (previousOrigins === undefined) delete process.env.AI_ALLOWED_ORIGINS;
    else process.env.AI_ALLOWED_ORIGINS = previousOrigins;
  }
});
