/** Standard normal CDF via the Abramowitz & Stegun approximation. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/**
 * Two-proportion z-test comparing a variant against control.
 * Returns the z-score, two-sided p-value, and relative uplift.
 */
export function twoProportionTest(
  controlConversions: number,
  controlExposures: number,
  variantConversions: number,
  variantExposures: number,
) {
  if (controlExposures === 0 || variantExposures === 0) {
    return { z: 0, pValue: 1, relativeUplift: 0, significant: false };
  }
  const p1 = controlConversions / controlExposures;
  const p2 = variantConversions / variantExposures;
  const pPool = (controlConversions + variantConversions) / (controlExposures + variantExposures);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / controlExposures + 1 / variantExposures));
  const z = se === 0 ? 0 : (p2 - p1) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  const relativeUplift = p1 === 0 ? 0 : (p2 - p1) / p1;
  return { z, pValue, relativeUplift, significant: pValue < 0.05 };
}
