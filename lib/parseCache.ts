import { PARSER_VERSION } from "./parser/parser";
import type { ParsedDoc } from "./types";

// Parse once per file, serve from cache after. localStorage survives a
// refresh; the in-memory map covers private browsing and quota failures.
const memory = new Map<string, ParsedDoc>();

const cacheKey = (hash: string) => `parse:v${PARSER_VERSION}:${hash}`;

export function getCachedParse(hash: string): ParsedDoc | null {
  const key = cacheKey(hash);
  const cached = memory.get(key);
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as ParsedDoc) : null;
  } catch {
    // Unavailable storage or a corrupted entry is a cache miss, not an error.
    return null;
  }
}

export function cacheParse(doc: ParsedDoc): void {
  const key = cacheKey(doc.fileHash);
  memory.set(key, doc);
  try {
    localStorage.setItem(key, JSON.stringify(doc));
  } catch {
    // Quota or private mode: the in-memory cache still covers this session.
  }
}
