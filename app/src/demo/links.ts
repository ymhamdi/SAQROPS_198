// Where the self-playing demo of each crew view lives (relative to the current page, so it works under any base path).

export type DemoView = 'tablet' | 'hud' | 'twin'

export const demoHref = (view: DemoView) => `?view=${view}&demo=1`
