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
  healthHandler({ method: "GET" }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
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
