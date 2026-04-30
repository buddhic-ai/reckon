import { getLatestSuggestions } from "@/lib/db/suggestions";
import { FALLBACK_SUGGESTIONS } from "@/lib/home/types";
import { HomeClient } from "./HomeClient";

export const dynamic = "force-dynamic";

export default function Home() {
  const cached = getLatestSuggestions();
  const suggestions = cached?.suggestions ?? FALLBACK_SUGGESTIONS;
  return <HomeClient suggestions={suggestions} />;
}
