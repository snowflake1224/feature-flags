import { afterEach, describe, expect, it, vi } from "vitest";
import { RedisService } from "../src/redis/redis.service";

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("RedisService shared subscriber", () => {
  const services: RedisService[] = [];

  afterEach(() => {
    for (const svc of services) {
      svc.client.disconnect();
      svc.subscriber.disconnect();
    }
    services.length = 0;
  });

  function setup() {
    const svc = new RedisService();
    services.push(svc);
    const subscribe = vi.fn(async () => 1);
    const unsubscribe = vi.fn(async () => 1);
    svc.subscriber.subscribe = subscribe as typeof svc.subscriber.subscribe;
    svc.subscriber.unsubscribe = unsubscribe as typeof svc.subscriber.unsubscribe;
    return { svc, subscribe, unsubscribe };
  }

  it("keeps other listeners when one client disconnects", async () => {
    const { svc, subscribe, unsubscribe } = setup();
    const first: number[] = [];
    const second: number[] = [];
    const stopFirst = svc.subscribeToChanges("env-a", (payload) => first.push(payload.version));
    const stopSecond = svc.subscribeToChanges("env-a", (payload) => second.push(payload.version));
    await flush();

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith("flagship:changes:env-a");

    svc.subscriber.emit("message", "flagship:changes:env-a", JSON.stringify({ version: 2 }));
    expect(first).toEqual([2]);
    expect(second).toEqual([2]);

    stopFirst();
    svc.subscriber.emit("message", "flagship:changes:env-a", JSON.stringify({ version: 3 }));
    expect(first).toEqual([2]);
    expect(second).toEqual([2, 3]);
    expect(unsubscribe).not.toHaveBeenCalled();

    stopSecond();
    stopSecond();
    await flush();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledWith("flagship:changes:env-a");

    svc.subscriber.emit("message", "flagship:changes:env-a", JSON.stringify({ version: 4 }));
    expect(second).toEqual([2, 3]);
  });

  it("does not unsubscribe a different environment", async () => {
    const { svc, subscribe, unsubscribe } = setup();
    const envA: number[] = [];
    const envB: number[] = [];
    const stopA = svc.subscribeToChanges("env-a", (payload) => envA.push(payload.version));
    svc.subscribeToChanges("env-b", (payload) => envB.push(payload.version));
    await flush();
    expect(subscribe.mock.calls.map((call) => call[0])).toEqual([
      "flagship:changes:env-a",
      "flagship:changes:env-b",
    ]);

    stopA();
    await flush();
    expect(unsubscribe.mock.calls.map((call) => call[0])).toEqual(["flagship:changes:env-a"]);

    svc.subscriber.emit("message", "flagship:changes:env-b", JSON.stringify({ version: 9 }));
    expect(envA).toEqual([]);
    expect(envB).toEqual([9]);
  });

  it("isolates a throwing listener and ignores malformed payloads", async () => {
    const { svc } = setup();
    const seen: number[] = [];
    svc.subscribeToChanges("env-a", () => {
      throw new Error("broken stream");
    });
    svc.subscribeToChanges("env-a", (payload) => seen.push(payload.version));
    await flush();

    expect(() =>
      svc.subscriber.emit("message", "flagship:changes:env-a", JSON.stringify({ version: 5 })),
    ).not.toThrow();
    expect(seen).toEqual([5]);

    svc.subscriber.emit("message", "flagship:changes:env-a", "not-json");
    expect(seen).toEqual([5]);
  });

  it("does not drop a listener that replaced one during an in-flight subscribe", async () => {
    const { svc, subscribe, unsubscribe } = setup();
    let releaseFirst: (value: number) => void = () => undefined;
    subscribe.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    subscribe.mockImplementation(async () => 1);

    const stop = svc.subscribeToChanges("env-a", () => undefined);
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    stop();
    const seen: number[] = [];
    svc.subscribeToChanges("env-a", (payload) => seen.push(payload.version));
    releaseFirst(1);
    await flush();

    expect(unsubscribe).not.toHaveBeenCalled();
    svc.subscriber.emit("message", "flagship:changes:env-a", JSON.stringify({ version: 7 }));
    expect(seen).toEqual([7]);
  });
});
