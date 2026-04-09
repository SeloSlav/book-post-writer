import "dotenv/config";
import { pipelineIngestBooksOnly } from "../pipeline/runner.js";

async function main(): Promise<void> {
  const r = await pipelineIngestBooksOnly();
  console.log(
    `Ingest books done. ${r.bookChunks} book chunks, ${r.voiceChunks} voice chunk(s) kept in index. Index: ${r.indexDir}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
