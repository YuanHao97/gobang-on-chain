export const MAX_LOG_BLOCKS_PER_REQUEST = 10_000;

function blockNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative block number.`);
  return parsed;
}

export async function queryFilterInChunks(
  contract,
  filter,
  fromBlock,
  toBlock = "latest",
  maximumBlocks = MAX_LOG_BLOCKS_PER_REQUEST
) {
  const startBlock = blockNumber(fromBlock, "fromBlock");
  const blockLimit = blockNumber(maximumBlocks, "maximumBlocks");
  if (blockLimit === 0) throw new Error("maximumBlocks must be greater than zero.");

  const provider = typeof contract.runner?.getBlockNumber === "function"
    ? contract.runner
    : contract.runner?.provider;
  if (toBlock === "latest" && typeof provider?.getBlockNumber !== "function") {
    throw new Error("The contract runner cannot resolve the latest block.");
  }
  const endBlock = toBlock === "latest"
    ? blockNumber(await provider.getBlockNumber(), "latest block")
    : blockNumber(toBlock, "toBlock");
  if (endBlock < startBlock) return [];

  const events = [];
  for (let chunkStart = startBlock; chunkStart <= endBlock; chunkStart += blockLimit) {
    const chunkEnd = Math.min(chunkStart + blockLimit - 1, endBlock);
    events.push(...await contract.queryFilter(filter, chunkStart, chunkEnd));
  }
  return events;
}
