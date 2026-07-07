import { readFileSync } from "node:fs";
import type { KbEntry } from "./retrieve";

// undefined: not tried yet. null: unavailable, run ungrounded. The result is
// cached either way; a broken source logs once per instance, not per edit.
let cached: KbEntry[] | null | undefined;

export async function getKbIndex(): Promise<KbEntry[] | null> {
  if (cached !== undefined) return cached;
  const url = process.env.KB_INDEX_URL;
  const path = process.env.KB_INDEX_PATH;
  try {
    if (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`kb index fetch: ${res.status}`);
      cached = (await res.json()) as KbEntry[];
    } else if (path) {
      cached = JSON.parse(readFileSync(path, "utf8")) as KbEntry[];
    } else {
      cached = null;
    }
  } catch (err) {
    console.error(`kb index unavailable, edits run ungrounded: ${err instanceof Error ? err.message : err}`);
    cached = null;
  }
  return cached;
}
