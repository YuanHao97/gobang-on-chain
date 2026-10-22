import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createRecommendationServer } from "../src/local-server.mjs";

async function withServer(recommend, callback) {
  const server = createRecommendationServer({
    recommend,
    allowedOrigins: new Set(["http://127.0.0.1:5173"]),
    requestsPerMinute: 10
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("serves health and recommendation responses", async () => {
  await withServer(async () => ({ x: 7, y: 7, reason: "Center control.", confidence: 0.7 }), async (url) => {
    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const recommendation = await fetch(`${url}/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ board: Array(225).fill(0), boardSize: 15, playerStone: 1 })
    });
    assert.equal(recommendation.status, 200);
    assert.equal((await recommendation.json()).x, 7);
  });
});

test("rejects unapproved browser origins", async () => {
  await withServer(async () => ({}), async (url) => {
    const response = await fetch(`${url}/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://untrusted.example" },
      body: "{}"
    });
    assert.equal(response.status, 403);
  });
});
