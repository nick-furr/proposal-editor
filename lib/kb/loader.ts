import { readFileSync } from "node:fs";
import { get } from "@vercel/blob";
import type { KbEntry } from "./retrieve";

// The index carries client document text, so it never rides in the public
// repo: local dev reads the gitignored file, the deployed app reads a
// private Vercel Blob with the store token the platform injects.
const BLOB_PATHNAME = "kb-index.json";

// undefined: not tried yet. null: unavailable, run ungrounded. The result is
// cached either way; a broken source logs once per instance, not per edit.
let cached: KbEntry[] | null | undefined;

export async function getKbIndex(): Promise<KbEntry[] | null> {
  if (cached !== undefined) return cached;
  const path = process.env.KB_INDEX_PATH;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    if (path) {
      cached = JSON.parse(readFileSync(path, "utf8")) as KbEntry[];
    } else if (blobToken) {
      const result = await get(BLOB_PATHNAME, { access: "private", token: blobToken });
      if (!result || result.statusCode !== 200) {
        throw new Error(`blob get returned ${result ? result.statusCode : "not found"}`);
      }
      cached = JSON.parse(await new Response(result.stream).text()) as KbEntry[];
    } else {
      cached = null;
    }
  } catch (err) {
    console.error(`kb index unavailable, edits run ungrounded: ${err instanceof Error ? err.message : err}`);
    cached = null;
  }
  return cached;
}
