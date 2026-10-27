export function relayOptionsForChain(requestedChainId, env = process.env) {
  // Requests without a chain ID retain the existing hosting configuration.
  const defaultChainId = Number(env.RELAY_CHAIN_ID || 11155111);
  const chainId = requestedChainId == null ? defaultChainId : Number(requestedChainId);
  if (![11155111, 84532].includes(chainId)) throw new Error("Unsupported relay chain ID.");
  const prefix = chainId === 84532 ? "BASE_SEPOLIA" : "ETHEREUM_SEPOLIA";
  const isDefault = chainId === defaultChainId;
  return {
    chainId,
    rpcUrl: env[`${prefix}_RPC_URL`]
      || (chainId === 11155111 ? env.SEPOLIA_RPC_URL : undefined)
      || (isDefault ? env.RELAY_RPC_URL : undefined),
    gameManagerAddress: env[`${prefix}_GAME_MANAGER_ADDRESS`] || (isDefault ? env.GAME_MANAGER_ADDRESS : undefined),
    privateKey: env[`${prefix}_RELAYER_PRIVATE_KEY`] || env.RELAYER_PRIVATE_KEY,
    // Never reuse a computer NFT ID from the other network.
    computerPieceId: env[`${prefix}_ROBOT_PIECE_ID`] ?? (isDefault ? env.ROBOT_PIECE_ID || "" : "")
  };
}

export function relayNetworkConfig(env = process.env) {
  const { rpcUrl, chainId } = relayOptionsForChain(undefined, env);
  return { rpcUrl, chainId };
}
