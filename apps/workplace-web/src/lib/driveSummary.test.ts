// #735 드라이브 요약 카드 — 폴링 상한·표시 상태 판정. E2E 로 40회(≈2분) 폴링을 실제로 돌리던 검증을 옮겼다(WP-410).
import { describe, expect, it } from 'vitest'

import {
  IN_PROGRESS_POLLS,
  isSummaryPollingExhausted,
  SUMMARY_STALLED_TEXT,
  SUMMARY_UNAVAILABLE_FALLBACK,
  summaryCardView,
  summaryRefetchInterval,
} from './driveSummary'

const base = { summary: null, status: null, reason: null, pollingExhausted: false, isLoading: false }

describe('summaryRefetchInterval', () => {
  it('진행 중은 상한(40회) 직전까지 3초 간격으로 폴링하고 상한에서 멈춘다', () => {
    expect(IN_PROGRESS_POLLS).toBe(40)
    expect(summaryRefetchInterval('PENDING', 0)).toBe(3000)
    expect(summaryRefetchInterval('PENDING', 39)).toBe(3000)
    expect(summaryRefetchInterval('PENDING', 40)).toBe(false)
    expect(summaryRefetchInterval('EXTRACTING', 41)).toBe(false)
  })

  it('폴링 정지 시점과 지연 안내 전환 시점이 정확히 같다 — 어긋나면 영구 스켈레톤(#735)', () => {
    for (let n = 0; n <= 50; n++) {
      expect(summaryRefetchInterval('PENDING', n) === false).toBe(isSummaryPollingExhausted(n))
    }
  })

  it('상태 행이 아직 없으면(null) 5회까지만 재확인한다', () => {
    expect(summaryRefetchInterval(null, 4)).toBe(3000)
    expect(summaryRefetchInterval(null, 5)).toBe(false)
    expect(summaryRefetchInterval(undefined, 0)).toBe(3000)
  })

  it('터미널 상태(DONE/FAILED/SKIPPED)는 바로 멈춘다', () => {
    for (const s of ['DONE', 'FAILED', 'SKIPPED']) expect(summaryRefetchInterval(s, 0)).toBe(false)
  })
})

describe('summaryCardView', () => {
  it('요약 본문이 있으면 상태와 무관하게 본문을 그린다', () => {
    expect(summaryCardView({ ...base, summary: '요약 본문', status: 'DONE' })).toEqual({ kind: 'summary', summary: '요약 본문' })
    expect(summaryCardView({ ...base, summary: '요약 본문', status: 'SKIPPED', reason: '사유' })).toEqual({
      kind: 'summary',
      summary: '요약 본문',
    })
  })

  it('진행 중 + 폴링 상한 이전 → 스켈레톤, 상한 초과 → 지연 안내', () => {
    for (const s of ['PENDING', 'EXTRACTING', 'TEXT_READY', 'SUMMARIZING']) {
      expect(summaryCardView({ ...base, status: s })).toEqual({ kind: 'loading' })
      expect(summaryCardView({ ...base, status: s, pollingExhausted: true })).toEqual({
        kind: 'reason',
        text: SUMMARY_STALLED_TEXT,
      })
    }
  })

  it('요약 불가(SKIPPED/FAILED)는 서버 사유를, 없으면 폴백 문구를 보인다', () => {
    expect(summaryCardView({ ...base, status: 'SKIPPED', reason: '이 형식은 텍스트 추출을 지원하지 않습니다.' })).toEqual({
      kind: 'reason',
      text: '이 형식은 텍스트 추출을 지원하지 않습니다.',
    })
    expect(summaryCardView({ ...base, status: 'FAILED' })).toEqual({ kind: 'reason', text: SUMMARY_UNAVAILABLE_FALLBACK })
    expect(SUMMARY_UNAVAILABLE_FALLBACK).toBe('요약을 사용할 수 없습니다.')
    // 요약 불가는 폴링 상한과 무관하게 서버 사유가 이긴다(지연 안내는 진행 중일 때만).
    expect(summaryCardView({ ...base, status: 'SKIPPED', reason: '사유', pollingExhausted: true })).toEqual({
      kind: 'reason',
      text: '사유',
    })
  })

  it('상태 행이 없으면 로딩 중엔 그리지 않고, 끝났으면 한 줄 안내', () => {
    expect(summaryCardView({ ...base, isLoading: true })).toEqual({ kind: 'none' })
    expect(summaryCardView(base)).toEqual({ kind: 'empty' })
    expect(summaryCardView({ ...base, status: 'DONE' })).toEqual({ kind: 'empty' })
  })
})
