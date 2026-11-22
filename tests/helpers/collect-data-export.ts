import { streamDataExport, type DataExport } from '@/lib/account/data-export';

/** API-02 tests: read the whole streamed export (the downloaded file) and parse it, like a user's JSON tool would. */
export async function collectDataExport(
  ...args: Parameters<typeof streamDataExport>
): Promise<{ data: DataExport; text: string; chunks: number; largestChunk: number }> {
  let text = '';
  let chunks = 0;
  let largestChunk = 0;
  for await (const chunk of streamDataExport(...args)) {
    text += chunk;
    chunks += 1;
    largestChunk = Math.max(largestChunk, chunk.length);
  }
  return { data: JSON.parse(text) as DataExport, text, chunks, largestChunk };
}
