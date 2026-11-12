// 노트 머리 「AI 작성」 표지(WP-1483) — 리포트(aiLastAction='report')만: 고치지 않았으면 「AI 작성」, 사람이 고쳤으면 「AI 작성 · {이름} 수정 {시각}」.
import { describe, expect, test } from 'vitest'

import { aiAttributionLabel, shortAiAttributionLabel } from './wikiAiAttribution'

// 기준: 2026-11-16 15:00 KST.
const NOW = new Date('2026-11-16T06:00:00Z')

const page = (over: Partial<Parameters<typeof aiAttributionLabel>[0]> = {}) => ({
  aiLastAction: 'report',
  aiLastUsedAt: '2026-11-16T00:00:00Z',
  updatedAt: '2026-11-16T00:00:00Z',
  updatedByName: '양동희',
  ...over,
})

describe('aiAttributionLabel', () => {
  test('reportUnedited_aiWritten — 수정 시각이 AI 작성 시각보다 이르면 「AI 작성」', () => {
    expect(aiAttributionLabel(page({ updatedAt: '2026-11-15T23:59:00Z' }), NOW)).toBe('AI 작성')
  })

  test('reportEditedByHuman_showsNameAndTime — 사람이 고쳤으면 이름과 수정 시각(오늘이면 「오늘 10:12」)', () => {
    expect(aiAttributionLabel(page({ updatedAt: '2026-11-16T01:12:00Z' }), NOW)).toBe('AI 작성 · 양동희 수정 오늘 10:12')
    expect(aiAttributionLabel(page({ updatedAt: '2026-11-17T01:12:00Z' }), new Date('2026-11-18T06:00:00Z'))).toBe(
      'AI 작성 · 양동희 수정 11월 17일 10:12',
    )
  })

  test('openWithoutEdit_keepsAiWrittenLabel — 열기만 해 수정 시각이 AI 작성 시각과 같으면 「AI 작성」 그대로', () => {
    // 서버 직렬화가 소수 자릿수를 달리 내도 같은 순간이면 같다.
    expect(aiAttributionLabel(page({ updatedAt: '2026-11-16T09:00:00.000+09:00' }), NOW)).toBe('AI 작성')
  })

  test('nonReportAction_returnsNull — 리포트가 아닌 AI 사용·AI 이력 없음은 null(지금 「AI 생성」 그대로)', () => {
    expect(aiAttributionLabel(page({ aiLastAction: 'draft' }), NOW)).toBeNull()
    expect(aiAttributionLabel(page({ aiLastAction: null, aiLastUsedAt: null }), NOW)).toBeNull()
  })

  test('missingName_showsEditedTimeOnly — 수정자 이름이 없으면 「AI 작성 · 수정 {시각}」', () => {
    expect(aiAttributionLabel(page({ updatedAt: '2026-11-16T01:12:00Z', updatedByName: null }), NOW)).toBe('AI 작성 · 수정 오늘 10:12')
    expect(aiAttributionLabel(page({ updatedAt: '2026-11-16T01:12:00Z', updatedByName: undefined }), NOW)).toBe('AI 작성 · 수정 오늘 10:12')
  })
})

describe('shortAiAttributionLabel(모바일 짧은 표지)', () => {
  test('고치지 않은 리포트는 「AI 작성」, 고친 리포트는 이름·시각 없이 「AI 작성 · 수정됨」', () => {
    expect(shortAiAttributionLabel('AI 작성')).toBe('AI 작성')
    expect(shortAiAttributionLabel('AI 작성 · 양동희 수정 오늘 10:12')).toBe('AI 작성 · 수정됨')
  })
})
