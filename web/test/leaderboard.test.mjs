import assert from "node:assert/strict";
import test from "node:test";
import { buildVictoryLeaderboard } from "../src/leaderboard.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const CAROL = "0x3333333333333333333333333333333333333333";
const DAVE = "0x4444444444444444444444444444444444444444";

test("returns the three addresses with the most finished-match wins", () => {
  const matches = [
    { status: 2, winner: ALICE },
    { status: 2, winner: BOB },
    { status: 2, winner: ALICE },
    { status: 2, winner: CAROL },
    { status: 2, winner: BOB },
    { status: 2, winner: ALICE },
    { status: 2, winner: DAVE }
  ];

  assert.deepEqual(buildVictoryLeaderboard(matches), [
    { address: ALICE, wins: 3 },
    { address: BOB, wins: 2 },
    { address: CAROL, wins: 1 }
  ]);
});

test("ignores unfinished matches and finished matches without a winner", () => {
  const matches = [
    { status: 1, winner: ALICE },
    { status: 2, winner: ZERO_ADDRESS },
    { status: 2, winner: BOB }
  ];

  assert.deepEqual(buildVictoryLeaderboard(matches), [{ address: BOB, wins: 1 }]);
});

test("combines checksum variants and supports an explicit result limit", () => {
  const checksumAddress = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
  const lowercaseAddress = checksumAddress.toLowerCase();
  const matches = [
    { status: 2, winner: checksumAddress },
    { status: 2, winner: lowercaseAddress },
    { status: 2, winner: BOB }
  ];

  assert.deepEqual(buildVictoryLeaderboard(matches, 1), [{ address: checksumAddress, wins: 2 }]);
});
