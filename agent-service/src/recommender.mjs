import "reflect-metadata";
import OpenAI from "openai";
import { ActionProvider, AgentKit, WalletProvider } from "@coinbase/agentkit";
import { z } from "zod";
import { rankCandidateMoves, validateRecommendationRequest } from "./game.mjs";

const REQUEST_SCHEMA = z.object({
  board: z.array(z.number().int().min(0).max(2)).length(225),
  boardSize: z.literal(15),
  playerStone: z.union([z.literal(1), z.literal(2)])
});

const RECOMMENDATION_SCHEMA = z.object({
  x: z.number().int().min(0).max(14),
  y: z.number().int().min(0).max(14),
  reason: z.string().min(1).max(280),
  confidence: z.number().min(0).max(1)
});

const RECOMMENDATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    x: { type: "integer", minimum: 0, maximum: 14 },
    y: { type: "integer", minimum: 0, maximum: 14 },
    reason: { type: "string", minLength: 1, maxLength: 280 },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  required: ["x", "y", "reason", "confidence"],
  additionalProperties: false
};

class RecommendationWalletProvider extends WalletProvider {
  trackInitialization() {
    // This read-only provider does not transmit wallet analytics.
  }

  getAddress() {
    return "0x0000000000000000000000000000000000000000";
  }

  getNetwork() {
    return { protocolFamily: "evm", networkId: "ethereum-sepolia", chainId: "11155111" };
  }

  getName() {
    return "gobang_read_only";
  }

  async getBalance() {
    return 0n;
  }

  async nativeTransfer() {
    throw new Error("The recommendation agent cannot submit transactions.");
  }
}

class GobangRecommendationActionProvider extends ActionProvider {
  constructor(invokeRecommendation) {
    super("gobang", []);
    this.invokeRecommendation = invokeRecommendation;
  }

  supportsNetwork() {
    return true;
  }

  getActions() {
    return [{
      name: "gobang_recommend_gobang_move",
      description: "Recommend one legal move for a 15x15 Gobang position without submitting a transaction.",
      schema: REQUEST_SCHEMA,
      invoke: (input) => this.invokeRecommendation(REQUEST_SCHEMA.parse(input))
    }];
  }
}

function fallbackRecommendation(candidates, reason) {
  const move = candidates[0];
  return {
    x: move.x,
    y: move.y,
    reason: reason || move.reason,
    confidence: 0.5
  };
}

export async function createGobangRecommender(options = {}) {
  const model = options.model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-flash";
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  if (!options.deepseekClient && !apiKey) throw new Error("DEEPSEEK_API_KEY is required.");

  const deepseek = options.deepseekClient || new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
    maxRetries: 1,
    timeout: 20_000
  });
  const actionProvider = new GobangRecommendationActionProvider(async (input) => {
      const request = validateRecommendationRequest(input);
      const candidates = rankCandidateMoves(request);
      let response;
      try {
        response = await deepseek.responses.create({
          model,
          instructions: [
            "You are a concise Gobang move advisor.",
            "Choose exactly one move from the supplied candidate list.",
            "Prioritize an immediate win, then blocking an immediate loss, then creating or blocking strong lines.",
            "Do not claim the move was played and do not provide hidden chain-of-thought.",
            "Return only the requested structured recommendation."
          ].join(" "),
          input: JSON.stringify({
            boardSize: request.boardSize,
            playerStone: request.playerStone,
            board: request.board,
            candidates
          }),
          reasoning: { effort: "none" },
          max_output_tokens: 512,
          text: {
            format: {
              type: "json_schema",
              name: "gobang_move_recommendation",
              schema: RECOMMENDATION_JSON_SCHEMA
            }
          }
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown provider error.";
        throw new Error(`DeepSeek API request failed: ${detail}`);
      }

      let recommendation;
      try {
        recommendation = RECOMMENDATION_SCHEMA.parse(JSON.parse(response.output_text));
      } catch {
        recommendation = fallbackRecommendation(candidates, "The tactical fallback selected the strongest legal move.");
      }

      const selectedCandidate = candidates.find((candidate) => (
        candidate.x === recommendation.x && candidate.y === recommendation.y
      ));
      if (!selectedCandidate || request.board[recommendation.y * request.boardSize + recommendation.x] !== 0) {
        recommendation = fallbackRecommendation(candidates, "The model suggestion was invalid, so the tactical fallback selected a legal move.");
      }

      return JSON.stringify({ ...recommendation, model, source: "coinbase-agentkit-deepseek" });
  });

  const agentKit = await AgentKit.from({
    walletProvider: new RecommendationWalletProvider(),
    actionProviders: [actionProvider]
  });
  const action = agentKit.getActions().find((candidate) => candidate.name.endsWith("_recommend_gobang_move"));
  if (!action) throw new Error("The AgentKit Gobang recommendation action was not registered.");

  return async (input) => JSON.parse(await action.invoke(input));
}
