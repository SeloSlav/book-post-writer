import "dotenv/config";
import { pipelineFull } from "../pipeline/runner.js";

function parseArgs(argv: string[]): { prompt?: string } {
  const out: { prompt?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--prompt" && argv[i + 1]) {
      out.prompt = argv[++i];
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const prompt = args.prompt?.trim() ?? "";
  if (prompt.length < 12) {
    console.error(
      "Usage: npm run full -- --prompt \"Describe what the post should cover (title/subtitle are written in the draft).\"",
    );
    process.exit(1);
  }
  console.log("Running full pipeline (ingest → embed → draft)…");
  const r = await pipelineFull({ customTopicPrompt: prompt });
  console.log("Ingest:", r.ingest);
  console.log("Embed:", r.embed);
  console.log("Draft:", r.draft.filePath);
  console.log("Full pipeline finished.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
