import "dotenv/config";
import { pipelineIngest } from "../pipeline/runner.js";

async function main(): Promise<void> {
  const r = await pipelineIngest();
  console.log(
    `Ingest all done. ${r.bookChunks} book chunks, ${r.voiceChunks} voice chunks. Index: ${r.indexDir}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
