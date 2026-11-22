// Evaluates XGBoost tree ensembles saved with Booster.save_model('*.json'), with no dependency (no onnxruntime-web).
// Mirrors XGBoost's CPU predictor: inputs and split values are float32, a missing value (NaN: a failed detector)
// follows the node's default direction, leaf values are summed in float32 from the base margin, then the objective's
// transform is applied. Parity with Python is tested on ml/model/golden.csv (CLAUDE.md R8).

export type Objective = 'binary:logistic' | 'reg:squarederror'

interface Tree {
  left: Int32Array
  right: Int32Array
  feature: Int32Array
  /** split threshold for inner nodes, leaf value for leaves (XGBoost's JSON layout) */
  value: Float32Array
  defaultLeft: Uint8Array
}

export interface XgbModel {
  objective: Objective
  baseMargin: number
  nFeatures: number
  trees: Tree[]
}

interface RawTree {
  left_children: number[]
  right_children: number[]
  split_indices: number[]
  split_conditions: number[]
  default_left: (number | boolean)[]
}

interface RawModel {
  learner: {
    learner_model_param: { base_score: string; num_feature: string }
    objective: { name: string }
    gradient_booster: { name: string; model: { trees: RawTree[] } }
  }
}

/** base_score is "5E-1" in XGBoost 2.x and "[5E-1]" in 3.x. */
function parseBaseScore(s: string): number {
  const v = Number.parseFloat(s.replace(/[[\]]/g, ''))
  if (!Number.isFinite(v)) throw new Error(`xgb: unreadable base_score ${s}`)
  return v
}

export function parseXgb(json: unknown): XgbModel {
  const learner = (json as RawModel).learner
  if (!learner?.gradient_booster?.model?.trees) throw new Error('xgb: not an XGBoost JSON model')
  if (learner.gradient_booster.name !== 'gbtree') throw new Error(`xgb: booster ${learner.gradient_booster.name} not supported`)
  const objective = learner.objective.name as Objective
  if (objective !== 'binary:logistic' && objective !== 'reg:squarederror') throw new Error(`xgb: objective ${objective} not supported`)
  const base = parseBaseScore(learner.learner_model_param.base_score)
  // The base score is stored in output space; the trees add to the margin.
  const baseMargin = objective === 'binary:logistic' ? Math.log(base / (1 - base)) : base
  const trees = learner.gradient_booster.model.trees.map(
    (t): Tree => ({
      left: Int32Array.from(t.left_children),
      right: Int32Array.from(t.right_children),
      feature: Int32Array.from(t.split_indices),
      value: Float32Array.from(t.split_conditions),
      defaultLeft: Uint8Array.from(t.default_left, (d) => (d ? 1 : 0)),
    }),
  )
  const nFeatures = Number(learner.learner_model_param.num_feature)
  for (const t of trees) {
    for (let i = 0; i < t.left.length; i++) {
      if (t.left[i] === -1) continue
      if (!(t.left[i] >= 0 && t.left[i] < t.left.length && t.right[i] >= 0 && t.right[i] < t.left.length && t.feature[i] >= 0 && t.feature[i] < nFeatures)) throw new Error('xgb: malformed tree (child or feature index out of range)')
    }
  }
  return { objective, baseMargin: Math.fround(baseMargin), nFeatures, trees }
}

function leafValue(tree: Tree, x: Float32Array): number {
  let node = 0
  // A tree has no cycle: a walk longer than the tree, or a child outside it, means the file is damaged.
  for (let hops = 0; tree.left[node] !== -1; hops++) {
    if (hops > tree.left.length || !(node >= 0 && node < tree.left.length)) throw new Error('xgb: malformed tree (cycle or child index out of range)')
    const v = x[tree.feature[node]]
    const goLeft = Number.isNaN(v) ? tree.defaultLeft[node] === 1 : v < tree.value[node]
    node = goLeft ? tree.left[node] : tree.right[node]
  }
  return tree.value[node]
}

/** Prediction for one row (contract feature order; NaN = missing), in the objective's output space. */
export function predict(model: XgbModel, row: ArrayLike<number>): number {
  if (row.length !== model.nFeatures) throw new Error(`xgb: expected ${model.nFeatures} features, got ${row.length}`)
  const x = Float32Array.from(row)
  let margin = model.baseMargin
  for (const tree of model.trees) margin = Math.fround(margin + leafValue(tree, x))
  return model.objective === 'binary:logistic' ? Math.fround(1 / (1 + Math.exp(-margin))) : margin
}
