/** Scaled statistics avoid squaring raw magnitudes before taking their square root. */
export function finiteStatistic(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Statistic exceeds the supported finite numeric range.");
  return value;
}

function normalized(values: number[]): { scale: number; values: number[] } {
  let scale = 0;
  for (const value of values) {
    finiteStatistic(value);
    scale = Math.max(scale, Math.abs(value));
  }
  return { scale, values: scale ? values.map(value => value / scale) : values.map(() => 0) };
}

function compensatedSum(values: number[]): number {
  let sum = 0, correction = 0;
  for (const value of values) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
  }
  return sum + correction;
}

function centered(values: number[]): { scale: number; values: number[] } {
  // Translation preserves central moments and retains representable differences near a large common offset.
  const differences = values.map(value => value - values[0]!);
  const result = normalized(differences.every(Number.isFinite) ? differences : values);
  const average = compensatedSum(result.values) / values.length;
  return { scale: result.scale, values: result.values.map(value => value - average) };
}

export function mean(values: number[]): number {
  if (!values.length) throw new Error("Mean requires observations.");
  const result = normalized(values);
  // Tiny contributions need their original units when the large terms cancel.
  const small: number[] = [];
  for (let index = 0; index < values.length; index++) {
    if (values[index] !== 0 && Math.abs(result.values[index]!) < 2 ** -1022) {
      small.push(values[index]!); result.values[index] = 0;
    }
  }
  const sum = compensatedSum(result.values);
  const average = Math.abs(sum) <= 1 ? result.scale * sum / values.length : result.scale * (sum / values.length);
  return finiteStatistic(average + compensatedSum(small) / values.length);
}

export function sampleDeviation(values: number[]): number {
  if (values.length < 2) { normalized(values); return 0; }
  const result = centered(values);
  const norm = Math.sqrt(result.values.reduce((sum, value) => sum + value * value, 0) / (values.length - 1));
  const deviation = finiteStatistic(result.scale * norm);
  if (norm > 0 && deviation === 0) throw new Error("Deviation is below the supported numeric range.");
  return deviation;
}

export function rootMeanSquare(values: number[]): number {
  if (!values.length) throw new Error("RMS requires observations.");
  const result = normalized(values);
  const norm = Math.sqrt(result.values.reduce((sum, value) => sum + value * value, 0) / values.length);
  const rms = finiteStatistic(result.scale * norm);
  if (norm > 0 && rms === 0) throw new Error("RMS is below the supported numeric range.");
  return rms;
}

/** Sample-standardized scores can be finite even if their physical deviation is unrepresentable. */
export function standardScores(values: number[]): number[] {
  if (values.length < 2) throw new Error("Standard scores require at least two observations.");
  const result = centered(values);
  const norm = Math.sqrt(result.values.reduce((sum, value) => sum + value * value, 0) / (values.length - 1));
  return result.values.map(value => norm ? value / norm : 0);
}

/** Population skewness and excess kurtosis; dimensional powers cancel before evaluation. */
export function distributionShape(values: number[]): { skewness: number; kurtosis: number } {
  if (!values.length) throw new Error("Distribution shape requires observations.");
  const result = centered(values);
  const norm = Math.sqrt(result.values.reduce((sum, value) => sum + value * value, 0) / values.length);
  if (norm === 0) return { skewness: 0, kurtosis: 0 };
  const scores = result.values.map(value => value / norm);
  return { skewness: finiteStatistic(scores.reduce((sum, value) => sum + value ** 3, 0) / values.length),
    kurtosis: finiteStatistic(scores.reduce((sum, value) => sum + value ** 4, 0) / values.length - 3) };
}
