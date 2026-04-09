import "dotenv/config";
import { pipelineEmbed } from "../pipeline/runner.js";

async function main(): Promise<void> {
  const r = await pipelineEmbed();
  console.log(`Embeddings saved for ${r.vectorCount} chunks (${r.model}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
