import { describe, expect, it } from "vitest";
import { bucket, pickVariation } from "../src/hash";

describe("stable rollout hashing", () => {
  it("is deterministic for the same inputs", () => {
    const a = bucket("my-flag", "salt123", "user-42");
    const b = bucket("my-flag", "salt123", "user-42");
    expect(a).toBe(b);
  });

  it("matches a fixed point so the hash cannot drift silently", () => {
    expect(bucket("new-checkout", "checkoutsalt00000", "user-42")).toBe(0.5588033430205928);
  });

  it("produces values in [0, 1)", () => {
    for (let i = 0; i < 1000; i++) {
      const p = bucket("flag", "salt", `user-${i}`);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
  });

  it("is roughly uniform across many keys (10% bucket ~ 10%)", () => {
    let inBucket = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      if (bucket("flag", "salt", `user-${i}`) < 0.1) inBucket++;
    }
    const ratio = inBucket / N;
    expect(ratio).toBeGreaterThan(0.08);
    expect(ratio).toBeLessThan(0.12);
  });

  it("is sticky: users in the 10% bucket stay when rolled to 20%", () => {
    const stickyBroken: string[] = [];
    for (let i = 0; i < 5000; i++) {
      const key = `user-${i}`;
      const p = bucket("flag", "salt", key);
      const at10 = p < 0.1;
      const at20 = p < 0.2;
      if (at10 && !at20) stickyBroken.push(key);
    }
    expect(stickyBroken).toHaveLength(0);
  });

  it("pickVariation respects weights", () => {
    const counts = [0, 0];
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const point = bucket("f", "s", `u-${i}`);
      const variation = pickVariation(point, [
        { variation: 0, weight: 30 },
        { variation: 1, weight: 70 },
      ]);
      counts[variation]++;
    }
    expect(counts[0] / N).toBeGreaterThan(0.27);
    expect(counts[0] / N).toBeLessThan(0.33);
  });
});
