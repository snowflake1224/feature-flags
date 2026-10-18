import { describe, expect, it } from "vitest";
import { consumeSseBuffer } from "../lib/sse";

describe("consumeSseBuffer", () => {
  it("parses named events and joins multiline data", () => {
    const seen: Array<{ event: string; data: string }> = [];
    const rest = consumeSseBuffer(
      "event: put\ndata: {\"version\":1}\ndata: {\"flags\":{}}\n\n: heartbeat\n\nevent: patch\ndata: {\"version\":2}\n\n",
      (message) => seen.push(message),
    );
    expect(rest).toBe("");
    expect(seen).toEqual([
      { event: "put", data: "{\"version\":1}\n{\"flags\":{}}" },
      { event: "patch", data: "{\"version\":2}" },
    ]);
  });

  it("keeps an incomplete block and emits it on the next chunk", () => {
    const seen: Array<{ event: string; data: string }> = [];
    const rest = consumeSseBuffer("event: put\ndata: {\"a\":1}", (message) => seen.push(message));
    expect(seen).toEqual([]);
    expect(rest).toContain("event: put");
    const leftover = consumeSseBuffer(`${rest}\n\n`, (message) => seen.push(message));
    expect(leftover).toBe("");
    expect(seen).toEqual([{ event: "put", data: "{\"a\":1}" }]);
  });

  it("strips a trailing carriage return and ignores comment-only frames", () => {
    const seen: string[] = [];
    const rest = consumeSseBuffer(": keep-alive\n\ndata: hello\r\n\n", (message) => seen.push(message.data));
    expect(rest).toBe("");
    expect(seen).toEqual(["hello"]);
  });

  it("defaults the event name when the frame only has data", () => {
    const seen: Array<{ event: string; data: string }> = [];
    consumeSseBuffer("data: ping\n\n", (message) => seen.push(message));
    expect(seen).toEqual([{ event: "message", data: "ping" }]);
  });
});
