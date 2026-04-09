import "dotenv/config";
import { pipelineIngestVoiceOnly } from "../pipeline/runner.js";

async function main(): Promise<void> {
  const r = await pipelineIngestVoiceOnly();
  console.log(
    `Ingest voice done. ${r.bookChunks} book chunk(s) kept, ${r.voiceChunks} new voice chunk(s). Index: ${r.indexDir}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
