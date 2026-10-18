import type { StreamMessage } from "./types";

/** Parse a text/event-stream chunk buffer into complete events. Returns the leftover fragment. */
export function consumeSseBuffer(buffer: string, onEvent: (message: StreamMessage) => void): string {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  for (const block of parts) {
    const message = parseSseBlock(block);
    if (message) onEvent(message);
  }
  return rest;
}

function parseSseBlock(block: string): StreamMessage | null {
  let event = "message";
  const data: string[] = [];
  let sawData = false;
  for (const rawLine of block.split(/\n/)) {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      sawData = true;
      data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (!sawData) return null;
  return { event, data: data.join("\n") };
}
