import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import { readBoard as serverReadBoard } from "../src/board.mjs";
import { readBoard as clientReadBoard } from "../../web/src/board.js";

const gameInterface = new Interface(["function getCell(uint256,uint8,uint8) view returns(uint8)"]);
const multicallInterface = new Interface(["function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)"]);
for (const readBoard of [serverReadBoard, clientReadBoard]) {
  test(`${readBoard === serverReadBoard ? "server" : "client"} reads 225 cells with one RPC call on either public network`, async () => {
    for (const chainId of [84532, 11155111]) {
      let requests = 0;
      const target = "0x1111111111111111111111111111111111111111";
      const game = {
        interface: gameInterface, getAddress: async () => target,
        runner: { call: async (transaction) => {
          requests += 1;
          const [calls] = multicallInterface.decodeFunctionData("aggregate3", transaction.data);
          assert.equal(calls.length, 225);
          const results = calls.map((call, index) => {
            assert.equal(call.target, target);
            assert.equal(call.allowFailure, false);
            const [matchId, x, y] = gameInterface.decodeFunctionData("getCell", call.callData);
            assert.equal(matchId, 7n);
            assert.equal(Number(x), index % 15);
            assert.equal(Number(y), Math.floor(index / 15));
            return [true, gameInterface.encodeFunctionResult("getCell", [index % 3])];
          });
          return multicallInterface.encodeFunctionResult("aggregate3", [results]);
        } }
      };
      const board = await readBoard(game, 7, 15, chainId);
      assert.equal(requests, 1);
      assert.deepEqual(board, Array.from({ length: 225 }, (_, i) => i % 3));
    }
  });
}
