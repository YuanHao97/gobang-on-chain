import assert from "node:assert/strict";
import test from "node:test";
import { queryFilterInChunks } from "../src/eventLogs.js";

test("queries contract events in ranges of no more than 10,000 blocks", async () => {
  const requests = [];
  const contract = {
    runner: { getBlockNumber: async () => 28_828 },
    queryFilter: async (_filter, fromBlock, toBlock) => {
      requests.push([fromBlock, toBlock]);
      return [`${fromBlock}-${toBlock}`];
    }
  };

  const events = await queryFilterInChunks(contract, "filter", 0);

  assert.deepEqual(requests, [
    [0, 9_999],
    [10_000, 19_999],
    [20_000, 28_828]
  ]);
  assert.deepEqual(events, ["0-9999", "10000-19999", "20000-28828"]);
});

test("supports an explicit end block and a smaller provider limit", async () => {
  const requests = [];
  const contract = {
    runner: {},
    queryFilter: async (_filter, fromBlock, toBlock) => {
      requests.push([fromBlock, toBlock]);
      return [];
    }
  };

  await queryFilterInChunks(contract, "filter", 12, 22, 5);
  assert.deepEqual(requests, [[12, 16], [17, 21], [22, 22]]);
});

test("does not query when the requested range is empty", async () => {
  let queryCount = 0;
  const contract = {
    runner: { provider: { getBlockNumber: async () => 10 } },
    queryFilter: async () => { queryCount += 1; return []; }
  };

  assert.deepEqual(await queryFilterInChunks(contract, "filter", 11), []);
  assert.equal(queryCount, 0);
});
