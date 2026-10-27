import { Contract } from "ethers";

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const ABI = ["function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)"];

export async function readBoard(game, matchId, boardSize, chainId) {
  const count = Number(boardSize) ** 2;
  if (![84532, 11155111].includes(Number(chainId))) {
    return Promise.all(Array.from({ length: count }, (_, i) => game.getCell(matchId, i % boardSize, Math.floor(i / boardSize)).then(Number)));
  }
  const target = await game.getAddress();
  const multicall = new Contract(MULTICALL3, ABI, game.runner.provider || game.runner);
  const calls = Array.from({ length: count }, (_, i) => ({
    target, allowFailure: false,
    callData: game.interface.encodeFunctionData("getCell", [matchId, i % boardSize, Math.floor(i / boardSize)])
  }));
  const results = await multicall.aggregate3.staticCall(calls);
  if (results.length !== count) throw new Error("The board response is incomplete.");
  return results.map((result) => {
    if (!result.success) throw new Error("An on-chain board read failed.");
    const stone = Number(game.interface.decodeFunctionResult("getCell", result.returnData)[0]);
    if (![0, 1, 2].includes(stone)) throw new Error("The board contains an invalid stone.");
    return stone;
  });
}
