// 처리 이력 모델 단위 테스트(WP-1825).
import { describe, expect, test } from 'vitest'

import type { AiRunListItem } from '@/api/aiStatus'
import { AI_RUN_KIND_LABELS, AI_RUN_KIND_OPTIONS, aiRunKindLabel } from '@/lib/aiRunKindLabels'

import { createAiRunItem } from '../../../../e2e/factories/aiStatus.factory'
import {
  actorText,
  clearNarrowing,
  countLabel,
  hasNarrowing,
  modelOptions,
  parseHistorySearch,
  rangeChipLabel,
  runDetailId,
  type RunsFilter,
  runStatusBadge,
  runStatusLabel,
  runTimeText,
  targetHref,
  targetText,
  toHistorySearch,
  tokensText,
  toRunsParams,
} from './aiStatusHistoryModel'
import { historyHref } from './aiStatusModel'

const BASE: RunsFilter = { period: '24h', from: null, to: null, kinds: [], status: null, actorType: null, model: null, q: '' }
const SERVER_KINDS = ["AI_CHAT","HOME_PRIORITY_CLASSIFY","HOME_CONTEXT_SUMMARY","HOME_SUGGESTIONS","HOME_MEMORY_CLEANUP","HOME_SHARED_MEMORY_CHECK","HOME_SHARED_MEMORY_EXTRACT","MAIL_ANALYZE_CONTENT","MAIL_CLASSIFY_BATCH","MAIL_ANALYZE_PERSONAL","MAIL_LEARN_CATEGORY","MAIL_REPLY_DRAFT","MAIL_COMPOSE_DRAFT","MAIL_DRAFT_COACHING","MAIL_ISSUE_DRAFT","MESSAGING_CLASSIFY","MESSAGING_CATCHUP","WIKI_SUMMARIZE","WIKI_COMPOSE","ISSUE_PROGRESS_SUMMARY","ISSUE_CLASSIFY","WORK_PROFILE","PROJECT_STATUS","PROJECT_REPORT","PERSONAL_REPORT","DRIVE_SUMMARIZE","DRIVE_SECURITY_CHECK","DRIVE_OVERVIEW"]

describe('주소 변환', () => {
  test('주소를 필터로 읽는다(중복·빈 kind 제거)', () => {
    const sp = new URLSearchParams('period=7d&kind=A&kind=A&kind=&status=FAILED&from=2026-11-20T05:00:00.000Z&to=2026-11-20T06:00:00.000Z')
    expect(parseHistorySearch(sp)).toEqual({ period: '7d', kinds: ['A'], status: 'FAILED', from: '2026-11-20T05:00:00.000Z', to: '2026-11-20T06:00:00.000Z', actorType: null, model: null, q: '' })
  })
  test('잘못된 값은 기본값, from 만 있어도 둔다, model·q 는 trim', () => {
    expect(parseHistorySearch(new URLSearchParams('period=2h&status=foo&actorType=x&from=garbage'))).toEqual(BASE)
    const f = parseHistorySearch(new URLSearchParams('from=2026-11-20T05:00:00.000Z&model=%20m%20&q=%20%20'))
    expect(f.from).toBe('2026-11-20T05:00:00.000Z')
    expect(f.to).toBeNull()
    expect(f.model).toBe('m')
    expect(f.q).toBe('')
    // from 없이 to 만 있으면 to 를 버린다(숨은 조건 방지)
    expect(parseHistorySearch(new URLSearchParams('to=2026-11-20T05:00:00.000Z')).to).toBeNull()
  })
  test('개요 historyHref 와 왕복해도 같다', () => {
    const href = historyHref({ period: '7d', kinds: ['MAIL'], status: 'FAILED' })
    const qs = href.split('?')[1]
    expect(toHistorySearch(parseHistorySearch(new URLSearchParams(qs))).toString()).toBe(qs)
  })
  test('기본값은 주소에 없고 키 순서가 고정이다', () => {
    expect(toHistorySearch(BASE).toString()).toBe('')
    const f: RunsFilter = { period: '1h', from: 'F', to: 'T', kinds: ['A', 'B'], status: 'FAILED', actorType: 'USER', model: 'm', q: 'x' }
    expect(toHistorySearch(f).toString()).toBe('period=1h&kind=A&kind=B&status=FAILED&actorType=USER&model=m&q=x&from=F&to=T')
  })
})

describe('조건 판정', () => {
  test('hasNarrowing·clearNarrowing', () => {
    expect(hasNarrowing(BASE)).toBe(false)
    expect(hasNarrowing({ ...BASE, period: '7d' })).toBe(false)
    expect(hasNarrowing({ ...BASE, q: 'x' })).toBe(true)
    expect(hasNarrowing({ ...BASE, kinds: ['A'] })).toBe(true)
    expect(clearNarrowing({ ...BASE, period: '7d', q: 'x', kinds: ['A'], from: 'F' })).toEqual({ ...BASE, period: '7d' })
  })
})

describe('요청 파라미터', () => {
  test('기간은 baseMs 에서 거슬러 from 이 된다', () => {
    expect(toRunsParams({ ...BASE, period: '1h' }, Date.parse('2026-11-23T12:00:00Z'))).toEqual({ from: '2026-11-23T11:00:00.000Z' })
  })
  test('from·to 가 있으면 기간을 무시한다', () => {
    expect(toRunsParams({ ...BASE, from: 'F', to: 'T', kinds: ['A'], status: 'FAILED', q: 'x' }, 0)).toEqual({ kind: ['A'], status: 'FAILED', q: 'x', from: 'F', to: 'T' })
  })
})

describe('구간 칩', () => {
  test('같은 날·다른 날·to 없음', () => {
    const f = new Date(2026, 10, 20, 14, 0).toISOString()
    const t = new Date(2026, 10, 20, 15, 30).toISOString()
    const t2 = new Date(2026, 10, 21, 1, 5).toISOString()
    expect(rangeChipLabel(f, t)).toBe('구간 11/20 14:00–15:30')
    expect(rangeChipLabel(f, t2)).toBe('구간 11/20 14:00–11/21 01:05')
    expect(rangeChipLabel(f, null)).toBe('구간 11/20 14:00 이후')
  })
})

describe('표시 함수', () => {
  test('상태', () => {
    expect(runStatusLabel('FAILED')).toBe('실패')
    expect(runStatusLabel('X')).toBe('X')
    expect(runStatusBadge('SUCCEEDED')).toBe('success')
    expect(runStatusBadge('FAILED')).toBe('error')
    expect(runStatusBadge('RUNNING')).toBe('info')
    expect(runStatusBadge('PENDING')).toBe('pending')
    expect(runStatusBadge('SKIPPED')).toBe('inactive')
    expect(runStatusBadge('X')).toBe('unknown')
  })
  test('실행 주체', () => {
    expect(actorText(null)).toBe('자동')
    expect(actorText({ type: 'AUTO', id: null, name: null })).toBe('자동')
    expect(actorText({ type: 'USER', id: 5, name: null })).toBe('알 수 없음')
    expect(actorText({ type: 'AGENT', id: 5, name: '봇' })).toBe('봇')
  })
  test('대상', () => {
    expect(targetHref({ type: 'ISSUE', id: 'WP-1812', label: 'x' })).toBe('/projects/WP/issues/1812')
    expect(targetHref({ type: 'MAIL_MESSAGE', id: '12', label: 'x' })).toBeNull()
    expect(targetHref({ type: 'ISSUE', id: 'abc', label: 'x' })).toBeNull()
    expect(targetHref(null)).toBeNull()
    expect(targetText({ type: 'ISSUE', id: 'WP-1', label: '제목' })).toBe('제목')
    expect(targetText({ type: 'ISSUE', id: 'WP-1', label: null })).toBe('WP-1')
    expect(targetText(null)).toBe('—')
  })
  test('토큰·시각·건수', () => {
    expect(tokensText(null, null)).toBe('—')
    expect(tokensText(3210, 0)).toBe('3,210 / 0')
    expect(tokensText(null, 5)).toBe('0 / 5')
    expect(runTimeText(null)).toBe('—')
    expect(runTimeText(new Date(2026, 10, 3, 4, 5, 6).toISOString())).toBe('2026-11-03 04:05:06')
    expect(countLabel(41, false)).toBe('41건')
    expect(countLabel(50, true)).toBe('50건 이상')
  })
  test('상세 id', () => {
    expect(runDetailId('W-12')).toBeNull()
    expect(runDetailId('R-abc')).toBe('abc')
    expect(createAiRunItem().id.startsWith('R-')).toBe(true)
  })
  test('모델 선택지', () => {
    const items: AiRunListItem[] = [createAiRunItem({ model: 'b' }), createAiRunItem({ model: 'a' }), createAiRunItem({ model: 'b' }), createAiRunItem({ model: null })]
    expect(modelOptions(items, 'c').map((o) => o.value)).toEqual(['a', 'b', 'c'])
    expect(modelOptions(items, 'a').map((o) => o.value)).toEqual(['a', 'b'])
  })
})

describe('종류 이름', () => {
  test('이름·모르는 코드', () => {
    expect(aiRunKindLabel('MAIL_CLASSIFY_BATCH')).toBe('메일 분류')
    expect(aiRunKindLabel('NEW_KIND')).toBe('NEW_KIND')
  })
  test('서버 28개 코드와 위임 작업을 모두 가진다', () => {
    for (const code of [...SERVER_KINDS, 'DELEGATED_WORK']) expect(AI_RUN_KIND_LABELS[code]).toBeTruthy()
    expect(SERVER_KINDS).toHaveLength(28)
    expect(AI_RUN_KIND_OPTIONS.map((o) => o.value)).toEqual(Object.keys(AI_RUN_KIND_LABELS))
  })
})
