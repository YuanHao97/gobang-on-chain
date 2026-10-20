export default function healthHandler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed." });
  }

  return response.status(200).json({ ok: true, service: "gobang-agentkit-recommender" });
}
