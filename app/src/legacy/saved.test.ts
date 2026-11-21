import { describe, expect, test } from 'vitest'
import { SAVED_PLANS_KEY, loadSavedPlans, planLink, storeSavedPlans, withPlanSaved, type SavedPlan } from './saved'

const memory = () => {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
}
const plan = (name: string, hash: string): Omit<SavedPlan, 'id'> => ({
  name,
  hash,
  savedAt: '2026-11-15T10:00:00.000Z',
  summary: { stops: 2, start: '07:30 Mars local (10:25 UTC)', totalS: 3600, verdict: 'GO' },
})

describe('saved plans', () => {
  test('save, store and load round-trip, newest first', () => {
    const store = memory()
    let list = withPlanSaved([], plan('A', '#stops=t:a'), '1')
    list = withPlanSaved(list, plan('B', '#stops=t:b'), '2')
    expect(storeSavedPlans(list, store)).toBe(true)
    expect(loadSavedPlans(store).map((p) => p.name)).toEqual(['B', 'A'])
  })

  test('saving the same plan again replaces the older copy', () => {
    let list = withPlanSaved([], plan('A', '#stops=t:a'), '1')
    list = withPlanSaved(list, plan('B', '#stops=t:b'), '2')
    list = withPlanSaved(list, plan('A again', '#stops=t:a'), '3')
    expect(list.map((p) => [p.id, p.name])).toEqual([
      ['3', 'A again'],
      ['2', 'B'],
    ])
  })

  test('empty, corrupt or blocked storage gives an empty list; a refused write reports false', () => {
    expect(loadSavedPlans(memory())).toEqual([])
    const bad = memory()
    bad.data.set(SAVED_PLANS_KEY, '{not json')
    expect(loadSavedPlans(bad)).toEqual([])
    bad.data.set(SAVED_PLANS_KEY, JSON.stringify([{ name: 'ok', hash: '#x' }, { junk: true }, null]))
    expect(loadSavedPlans(bad)).toHaveLength(1)
    expect(loadSavedPlans(null)).toEqual([])
    expect(storeSavedPlans([], null)).toBe(false)
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
    expect(storeSavedPlans([], full)).toBe(false)
  })

  test('the link is the page address with the plan hash', () => {
    expect(planLink('#stops=t:a', { origin: 'https://example.app', pathname: '/' })).toBe('https://example.app/#stops=t:a')
  })
})
