import "dotenv/config";
import { pipelineDraft } from "../pipeline/runner.js";

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
      'Usage: npm run draft -- --prompt "Describe what the post should cover (12+ characters)."',
    );
    process.exit(1);
  }
  const r = await pipelineDraft({ customTopicPrompt: prompt });
  console.log(`Wrote ${r.filePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
