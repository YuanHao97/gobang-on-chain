import { applyVercelCors, isAllowedOrigin, parseAllowedOrigins } from "../src/cors.mjs";

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

  const relayerConfigured = Boolean(
    /^https?:\/\//.test(process.env.SEPOLIA_RPC_URL || "")
    && /^0x[0-9a-fA-F]{64}$/.test(process.env.RELAYER_PRIVATE_KEY || "")
    && /^0x[0-9a-fA-F]{40}$/.test(process.env.GAME_MANAGER_ADDRESS || "")
  );
  return response.status(200).json({
    ok: true,
    service: "gobang-agentkit-recommender",
    relayerConfigured,
    relayChainId: Number(process.env.RELAY_CHAIN_ID || 11155111)
  });
}
