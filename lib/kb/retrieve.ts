// Keyword retrieval over the firm's past proposals. Five documents do not
// need a vector database; IDF-weighted term overlap is what keeps a common
// word like "engineering" from outranking a rare one like "wastewater".

export type KbEntry = { doc: string; section: string | null; text: string };

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with", "is",
  "are", "was", "were", "be", "been", "this", "that", "these", "those", "it",
  "its", "as", "at", "by", "from", "we", "our", "you", "your", "their",
  "they", "has", "have", "had", "will", "would", "can", "could", "should",
  "about", "into", "more", "most", "other", "some", "such", "no", "not",
  "only", "than", "then", "so", "up", "out", "if", "but", "all", "any",
  "each", "sentence", "paragraph", "add", "rewrite", "make",
]);

export function tokenize(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
    ),
  ];
}

export function retrieve(index: KbEntry[], query: string, k = 2): KbEntry[] {
  const entryTokens = index.map((e) => new Set(tokenize(`${e.section ?? ""} ${e.text}`)));
  const df = new Map<string, number>();
  for (const tokens of entryTokens) {
    for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const scored = index.map((entry, i) => {
    let score = 0;
    for (const term of tokenize(query)) {
      if (entryTokens[i].has(term)) {
        score += Math.log(1 + index.length / (df.get(term) ?? index.length));
      }
    }
    return { entry, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.entry);
}
