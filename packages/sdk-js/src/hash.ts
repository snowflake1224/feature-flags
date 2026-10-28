import { createHash } from "crypto";

/**
 * Stable rollout bucketing.
 *
 * The same (flagKey, salt, bucketByValue) triple always maps to the same
 * point in [0, 1). This is what makes percentage rollouts sticky: a user who
 * lands in the first 10% at 10% rollout stays in that bucket when you bump the
 * flag to 20%, so they never flip-flop between variations.
 *
 * sha1 of "key.salt.bucketBy", take the first 15 hex digits, and divide by
 * 0xFFFFFFFFFFFFFFF (15 nibbles of 0xF).
 */
const LONG_SCALE = 0xfffffffffffffffn; // 15 hex F's => 60 bits

export function bucket(key: string, salt: string, bucketBy: string): number {
  const hex = createHash("sha1").update(`${key}.${salt}.${bucketBy}`).digest("hex").slice(0, 15);
  return Number(BigInt(`0x${hex}`)) / Number(LONG_SCALE);
}

/**
 * Pick a variation index from a set of weighted variations using the bucket
 * point. Weights are percentages (0..100). If they don't sum to 100 the last
 * bucket absorbs the remainder so we never fall through the end.
 */
export function pickVariation(
  point: number,
  variations: Array<{ variation: number; weight: number }>,
): number {
  let sum = 0;
  for (const wv of variations) {
    sum += wv.weight / 100;
    if (point < sum) return wv.variation;
  }
  const last = variations[variations.length - 1];
  return last ? last.variation : 0;
}
