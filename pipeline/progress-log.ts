const MAX_LINES = 400;
const buffer: string[] = [];

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: true,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Logs to stderr (visible in the terminal running editor-api) and keeps a buffer for the UI. */
export function logPipeline(message: string): void {
  const line = `[${timestamp()}] ${message}`;
  buffer.push(line);
  while (buffer.length > MAX_LINES) buffer.shift();
  console.error(`[pipeline] ${line}`);
}

export function snapshotPipelineLog(): string[] {
  return [...buffer];
}

export function clearPipelineLog(): void {
  buffer.length = 0;
}
