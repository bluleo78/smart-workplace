import { describe, expect, it } from 'vitest'

import { workflowTabSearch } from './workflowView'

describe('workflowTabSearch', () => {
  const base = new URLSearchParams('workflow=7&view=runs&run=3&runsView=graph')

  it('workflowTabSearch_runsLinkKeepsWorkflowAndClearsRunsView', () => {
    const next = workflowTabSearch(base, { view: 'runs', run: '9' })
    expect(next.get('workflow')).toBe('7')
    expect(next.get('view')).toBe('runs')
    expect(next.get('run')).toBe('9')
    expect(next.has('runsView')).toBe(false)
  })

  it('workflowTabSearch_runNullDropsRun', () => {
    const next = workflowTabSearch(base, { view: 'runs', run: null })
    expect(next.has('run')).toBe(false)
    expect(next.get('workflow')).toBe('7')
  })

  it('workflowTabSearch_leavingRunsClearsRunState', () => {
    const next = workflowTabSearch(base, { view: 'yaml' })
    expect(next.get('view')).toBe('yaml')
    expect(next.has('run')).toBe(false)
    expect(next.has('runsView')).toBe(false)
    expect(next.get('workflow')).toBe('7')
  })

  it('workflowTabSearch_switchingToRunsKeepsRunState', () => {
    const next = workflowTabSearch(new URLSearchParams('view=graph&run=3&runsView=graph'), { view: 'runs' })
    expect(next.get('run')).toBe('3')
    expect(next.get('runsView')).toBe('graph')
  })
})
