import { afterEach, describe, expect, it, vi } from "vitest";
import { FlagshipClient } from "../src/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FlagshipClient.track", () => {
  it("sends contextKey and the full evaluation context", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FlagshipClient({
      sdkKey: "sdk-test",
      baseUrl: "http://api.test",
      logger: { warn() {}, error() {}, debug() {} },
    });

    await client.track(
      "subscribed",
      { key: "ada", country: "US", plan: "pro" },
      { flagKey: "pricing-experiment", value: 19, metadata: { source: "demo" } },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/sdk/events");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sdk-test");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      eventKey: "subscribed",
      contextKey: "ada",
      context: { key: "ada", country: "US", plan: "pro" },
      flagKey: "pricing-experiment",
      value: 19,
      metadata: { source: "demo" },
    });
    client.close();
  });
});
