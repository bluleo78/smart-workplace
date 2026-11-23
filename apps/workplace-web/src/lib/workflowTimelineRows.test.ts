// 워크플로우 이동 기록(WP-1989) — 서버 path(지금 단계 제외, actor = 방문을 마치게 한 사람)를 이력 줄로 바꾸는 순수 함수.
import { describe, expect, test } from 'vitest'

import { type WorkflowPathStep, workflowStepsToTimelineRows } from './workflow'

const who = (id: number, name: string) => ({ id, username: name, name, kind: 'AGENT' as const })
const step = (key: string, name: string, actor: ReturnType<typeof who> | null, enteredAt: string, leftAt: string | null): WorkflowPathStep => ({
  key, name, outcome: null, actor, enteredAt, leftAt,
})
const cur = (key: string, name: string, enteredAt: string) => ({ key, name, enteredAt })

describe('workflowStepsToTimelineRows', () => {
  test('이동 줄은 앞 단계의 행위자·leftAt, 다음은 path 의 다음 또는 지금 단계', () => {
    const path = [step('a', '분류', who(2, '팀장AI'), '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'), step('b', '구현', who(3, '개발AI'), '2026-01-01T01:00:00Z', '2026-01-01T02:00:00Z')]
    const rows = workflowStepsToTimelineRows(path, cur('c', '리뷰', '2026-01-01T02:00:00Z'))
    expect(rows.map((r) => r.text)).toEqual([
      '워크플로우를 시작했습니다 — 분류',
      '팀장AI 단계를 분류 → 구현 (으)로 옮겼습니다',
      '개발AI 단계를 구현 → 리뷰 (으)로 옮겼습니다',
    ])
    expect(rows[0].actorName).toBe('')
    expect(rows[1].createdAt).toBe('2026-01-01T01:00:00Z')
  })

  test('취소된 실행은 마지막 줄이 실행을 취소했습니다', () => {
    const path = [step('b', '구현', who(3, '개발AI'), '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')]
    expect(workflowStepsToTimelineRows(path, null, 'CANCELED')[1].text).toBe('개발AI 실행을 취소했습니다')
    const noActor = [step('b', '구현', null, '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')]
    expect(workflowStepsToTimelineRows(noActor, null, 'CANCELED')[1].text).toBe('실행을 취소했습니다')
    expect(workflowStepsToTimelineRows(path, null, 'COMPLETED')[1].text).toBe('개발AI 구현 단계를 마쳤습니다')
  })

  test('cancelledRun_withCurrentNode_addsCancelRowAtEndedAt — 서버 모양(취소돼도 current 있음)', () => {
    const path = [step('a', '분류', who(2, '팀장AI'), '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')]
    const rows = workflowStepsToTimelineRows(path, cur('b', '구현', '2026-01-01T01:00:00Z'), 'CANCELED', '2026-01-01T03:00:00Z')
    expect(rows[1].text).toBe('팀장AI 단계를 분류 → 구현 (으)로 옮겼습니다')
    const last = rows[rows.length - 1]
    expect(last.text).toBe('실행을 취소했습니다')
    expect(last.createdAt).toBe('2026-01-01T03:00:00Z')
    // endedAt 이 없으면 취소 줄을 빼 지금처럼 둔다.
    expect(workflowStepsToTimelineRows(path, cur('b', '구현', '2026-01-01T01:00:00Z'), 'CANCELED')).toHaveLength(2)
  })

  test('앞뒤 단계가 같으면 다시 시작했습니다', () => {
    const path = [step('b', '구현', who(3, '개발AI'), '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')]
    const rows = workflowStepsToTimelineRows(path, cur('b', '구현', '2026-01-01T01:00:00Z'))
    expect(rows[1].text).toBe('개발AI 구현 단계를 다시 시작했습니다')
  })

  test('실행이 끝나(currentNode 없음) 다음이 없으면 마쳤습니다', () => {
    const path = [step('a', '분류', null, '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')]
    expect(workflowStepsToTimelineRows(path, null)[1].text).toBe('분류 단계를 마쳤습니다')
  })

  test('path 가 비면 지금 단계로 시작 줄만, 둘 다 없으면 빈 목록', () => {
    expect(workflowStepsToTimelineRows([], cur('a', '분류', '2026-01-01T00:00:00Z')).map((r) => r.text)).toEqual(['워크플로우를 시작했습니다 — 분류'])
    expect(workflowStepsToTimelineRows([], null)).toEqual([])
  })
})
