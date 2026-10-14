export interface WeightedScoreComponent {
  name: string;
  score: number;
  /** Fraction, not a percentage: 0.2 means 20%. */
  weight: number;
}

/** Arithmetic on supplied 0..100 component scores; no signal calibration or missing-value imputation. */
export function calculateWeightedScore(input: readonly WeightedScoreComponent[]) {
  if (!input.length || input.length > 64) throw new Error("Supply 1 to 64 score components.");
  const names = new Set<string>();
  for (const component of input) {
    const name = component.name.trim().toLowerCase();
    if (!name || component.name.length > 80 || names.has(name)
      || !Number.isFinite(component.score) || component.score < 0 || component.score > 100
      || !Number.isFinite(component.weight) || component.weight < 0 || component.weight > 1) {
      throw new Error("Supply unique component names, finite scores in 0..100 and fractional weights in 0..1.");
    }
    names.add(name);
  }
  const weightTotal = input.reduce((sum, component) => sum + component.weight, 0);
  if (Math.abs(weightTotal - 1) > Number.EPSILON * input.length * 8) {
    throw new Error("Supplied weights must sum to one; missing weights are not normalized or filled.");
  }
  const components = input.map(component => ({ ...component, contribution: component.score * component.weight }));
  if (components.some(component => component.score > 0 && component.weight > 0 && component.contribution === 0)) {
    throw new Error("Nonzero weighted contribution is below the supported numeric range.");
  }
  const score = components.reduce((sum, component) => sum + component.contribution, 0);
  const maximum = Math.max(...components.map(component => component.contribution));
  const tolerance = Number.EPSILON * maximum * 8;
  return { score, roundedScore: Math.round(score), weightTotal, components,
    largestContributors: components.filter(component => Math.abs(component.contribution - maximum) <= tolerance).map(component => component.name) };
}
