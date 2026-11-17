// Exact binomial confidence bounds for the wrong-target ceiling.

/** log P(X = i) for X ~ Binomial(n, p), for i = 0..k, summed into log P(X <= k). */
function logBinomialCdf(k: number, n: number, p: number): number {
  if (k >= n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return -Infinity;
  const logP = Math.log(p);
  const logQ = Math.log1p(-p);
  let logTerm = n * logQ;
  let logSum = logTerm;
  for (let i = 0; i < k; i++) {
    logTerm += Math.log((n - i) / (i + 1)) + logP - logQ;
    const hi = Math.max(logSum, logTerm);
    logSum = hi + Math.log(Math.exp(logSum - hi) + Math.exp(logTerm - hi));
  }
  return Math.min(logSum, 0);
}

function bisect(f: (p: number) => number, lo: number, hi: number): number {
  // f is decreasing in p. Finds p where f(p) = 0.
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * One-sided Clopper-Pearson upper bound on a rate, after seeing k events in n trials.
 * With confidence 0.95 the true rate is below the bound in 95% of repeated samples.
 */
export function upperBound(k: number, n: number, confidence = 0.95): number {
  if (n <= 0) return 1;
  if (k >= n) return 1;
  const logAlpha = Math.log(1 - confidence);
  return bisect((p) => logBinomialCdf(k, n, p) - logAlpha, k / n, 1);
}

/** One-sided Clopper-Pearson lower bound on a rate, after seeing k events in n trials. */
export function lowerBound(k: number, n: number, confidence = 0.95): number {
  if (n <= 0 || k <= 0) return 0;
  // P(X >= k) = alpha, which is P(X <= k - 1) = 1 - alpha.
  const logTarget = Math.log(confidence);
  return bisect((p) => logBinomialCdf(k - 1, n, p) - logTarget, 0, k / n);
}

/**
 * The fewest trials n for which k events keep the upper bound under the ceiling.
 * Zero events and a 1% ceiling at 95% confidence need 299 trials.
 */
export function trialsNeeded(k: number, ceiling: number, confidence = 0.95): number {
  let hi = Math.max(k + 1, 1);
  while (upperBound(k, hi, confidence) >= ceiling) hi *= 2;
  let lo = Math.max(k, Math.floor(hi / 2));
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (upperBound(k, mid, confidence) >= ceiling) lo = mid;
    else hi = mid;
  }
  return hi;
}
