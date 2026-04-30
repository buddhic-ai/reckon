import { getLatestSuggestions } from "@/lib/db/suggestions";
import { FALLBACK_SUGGESTIONS } from "@/lib/home/types";

export const runtime = "nodejs";

export async function GET() {
  const cached = getLatestSuggestions();
  if (cached) {
    return Response.json({
      suggestions: cached.suggestions,
      generatedAt: cached.generatedAt,
      source: "db" as const,
    });
  }
  return Response.json({
    suggestions: FALLBACK_SUGGESTIONS,
    generatedAt: null,
    source: "fallback" as const,
  });
}
