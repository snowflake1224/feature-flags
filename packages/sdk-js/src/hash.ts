import { createHash } from "crypto";

/**
 * Stable rollout bucketing.
 *
 * The same (flagKey, salt, bucketByValue) triple always maps to the same
 * point in [0, 1). This is what makes percentage rollouts sticky: a user who
 * lands in the first 10% at 10% rollout stays in that bucket when you bump the
 * flag to 20%, so they never flip-flop between variations.
 *
 * Algorithm mirrors LaunchDarkly's: sha1 of "key.salt.bucketBy", take the
 * first 15 hex digits, and divide by 0xFFFFFFFFFFFFFFF (15 nibbles of 0xF).
 * We use BigInt so the 60-bit integer is represented exactly.
 */
const LONG_SCALE = 0xfffffffffffffffn; // 15 hex F's => 60 bits

export function bucket(
  key: string,
  salt: string,
  bucketBy: string,
  seed?: number,
): number {
  const prefix = seed !== undefined ? `${seed}.` : "";
  const hashInput = `${prefix}${key}.${salt}.${bucketBy}`;
  const hex = createHash("sha1").update(hashInput).digest("hex").slice(0, 15);
  const value = BigInt(`0x${hex}`);
  // Divide in floating point after scaling to keep precision reasonable.
  return Number(value) / Number(LONG_SCALE);
}

/**
 * Pick a variation index from a set of weighted variations using the bucket
 * point. Weights are percentages (0..100). If they don't sum to 100 the last
 * bucket absorbs the remainder so we never fall through the end.
 */
export function pickVariation(
  point: number,
  variations: Array<{ variation: number; weight: number }>,
): { variation: number; inExperiment: boolean } {
  let sum = 0;
  for (const wv of variations) {
    sum += wv.weight / 100;
    if (point < sum) {
      return { variation: wv.variation, inExperiment: false };
    }
  }
  // Remainder / rounding: serve the last defined variation.
  const last = variations[variations.length - 1];
  return { variation: last ? last.variation : 0, inExperiment: false };
}
