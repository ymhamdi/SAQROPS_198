// How the shipped model's alert thresholds were chosen, as the interface states it. Kept apart from predict.ts so the
// views can import it without pulling the model files into their bundle.

/** The rule of models exported before metrics.json carried one (ml/train.py: v1). */
export const DEFAULT_THRESHOLD_RULE = 'rappel ≥ 0,95 par pas de temps en validation'
