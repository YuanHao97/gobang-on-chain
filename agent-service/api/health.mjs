import { applyVercelCors, isAllowedOrigin, parseAllowedOrigins } from "../src/cors.mjs";
import { Wallet } from "ethers";
import { relayOptionsForChain } from "../src/relayConfig.mjs";

export default function healthHandler(request, response) {
  const origin = request.headers?.origin;
  const allowedOrigins = parseAllowedOrigins(process.env.AI_ALLOWED_ORIGINS);
  applyVercelCors(response, origin, allowedOrigins);

  if (!isAllowedOrigin(origin, allowedOrigins)) {
    return response.status(403).json({ error: "This origin is not allowed." });
  }
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET, OPTIONS");
    return response.status(405).json({ error: "Method not allowed." });
  }

  let options;
  try { options = relayOptionsForChain(request.query?.chainId); }
  catch (error) { return response.status(400).json({ error: error.message }); }
  const { rpcUrl, chainId, privateKey, gameManagerAddress } = options;
  const relayerConfigured = Boolean(
    /^https?:\/\//.test(rpcUrl || "")
    && /^0x[0-9a-fA-F]{64}$/.test(privateKey || "")
    && /^0x[0-9a-fA-F]{40}$/.test(gameManagerAddress || "")
  );
  const robotAddress = relayerConfigured ? new Wallet(privateKey).address : null;
  return response.status(200).json({
    ok: true,
    service: "gobang-agentkit-recommender",
    relayerConfigured,
    relayChainId: chainId,
    gameManagerAddress: gameManagerAddress || null,
    robotAddress
  });
}
