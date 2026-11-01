import { describe, expect, it } from 'vitest'

import type { SecurityCheckView } from '../types/securityCheck'
import { chipText, securityChip } from './securityCheck'

const base: SecurityCheckView = { status: null, risk: null, headline: null, evidence: [], checkedAt: null, reason: null }
const ok = { pollingExhausted: false, requesting: false, aiAvailable: true }

describe('securityChip', () => {
  it('failsWithoutRetry_whenAiUnavailableOrReasonNoAi', () => {
    expect(securityChip(base, { ...ok, aiAvailable: false })).toEqual({ kind: 'failed', canRetry: false })
    expect(securityChip({ ...base, reason: 'NO_AI' }, ok)).toEqual({ kind: 'failed', canRetry: false })
  })
  it('isIdle_whenStatusNull', () => {
    expect(securityChip(base, ok)).toEqual({ kind: 'idle' })
  })
  it('isHidden_whenViewNotLoadedYet', () => {
    expect(securityChip(undefined, ok)).toEqual({ kind: 'hidden' })
  })
  it('isChecking_whenInProgressOrRequesting', () => {
    expect(securityChip({ ...base, status: 'PENDING' }, ok)).toEqual({ kind: 'checking' })
    expect(securityChip({ ...base, status: 'CHECKING' }, ok)).toEqual({ kind: 'checking' })
    expect(securityChip(base, { ...ok, requesting: true })).toEqual({ kind: 'checking' })
  })
  it('failsWithRetry_whenPollingExhausted', () => {
    expect(securityChip({ ...base, status: 'CHECKING' }, { ...ok, pollingExhausted: true })).toEqual({ kind: 'failed', canRetry: true })
  })
  it('showsResult_whenDone', () => {
    const view: SecurityCheckView = { ...base, status: 'DONE', risk: 'CAUTION', evidence: [{ kind: 'OTHER', detail: 'a' }, { kind: 'OTHER', detail: 'b' }, { kind: 'OTHER', detail: 'c' }] }
    const chip = securityChip(view, ok)
    expect(chip).toEqual({ kind: 'result', risk: 'CAUTION', label: '주의', evidenceCount: 3 })
    expect(chipText(chip)).toBe('주의 · 근거 3')
    expect(chipText(securityChip({ ...view, risk: 'LOW', evidence: [] }, ok))).toBe('낮음')
  })
  it('failsWithRetry_whenFailed', () => {
    expect(securityChip({ ...base, status: 'FAILED' }, ok)).toEqual({ kind: 'failed', canRetry: true })
  })
  it('failsWithRetry_whenErrored', () => {
    expect(securityChip(undefined, { ...ok, errored: true })).toEqual({ kind: 'failed', canRetry: true })
    expect(securityChip(undefined, { ...ok, errored: true, aiAvailable: false })).toEqual({ kind: 'failed', canRetry: false })
  })
  // 서버가 SKIPPED 라도(예: 인코딩 차이로 스크립트를 못 봄) 웹이 스크립트를 봤다면 점검을 요청할 수 있어야 한다.
  it('isIdle_whenSkipped', () => {
    expect(securityChip({ ...base, status: 'SKIPPED' }, ok)).toEqual({ kind: 'idle' })
  })
})
