// 홈 「최근 활동」 위젯 — 활동 종류 문구 테스트(WP-1593).
// 위젯이 이슈 이력 표(HISTORY_EVENT_LABEL)와 따로 표를 관리해 시작일·마일스톤 변경이 영문 원본(START_DATE_CHANGED)으로 보였다.
// previewData 로 그려 조회 없이 eventType → 한국어 문구만 본다(배지·라벨 문구는 vitest 영역 — apps/workplace-web/CLAUDE.md).
import { screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'

import { HISTORY_EVENT_LABEL, historyEventPhrase } from '@/pages/projects/components/issueHistoryLabels'
import { renderScreen } from '@/test/renderScreen'
import type { ActivityEntry, ActivityPage } from '@/types/home'

import ActivityWidget from './ActivityWidget'

/** eventType 마다 활동 한 줄을 만든다 — 행 순서가 eventTypes 순서와 같다. */
function pageOf(eventTypes: string[]): ActivityPage {
  const items: ActivityEntry[] = eventTypes.map((eventType, i) => ({
    id: i + 1,
    issueId: i + 1,
    projectKey: 'WP',
    issueNumber: i + 1,
    issueTitle: `이슈 ${i + 1}`,
    actorId: 1,
    actorName: '홍길동',
    actorKind: 'HUMAN',
    eventType,
    createdAt: '2026-11-14T00:00:00Z',
  }))
  return { items, nextCursor: null }
}

/** 활동 목록의 각 행 텍스트. */
function rowTexts(): string[] {
  const list = screen.getByTestId('activity-items')
  return within(list).getAllByRole('listitem').map((li) => li.textContent ?? '')
}

test('시작일·마일스톤 변경, 필드 변경, 모르는 종류를 프로젝트 개요와 같은 한국어 문구로 보인다', () => {
  const raws = ['START_DATE_CHANGED', 'MILESTONE_CHANGED', 'CUSTOM_FIELD_CHANGED', 'FOO_CHANGED']
  renderScreen(<ActivityWidget previewData={pageOf(raws)} />)
  const rows = rowTexts()
  expect(rows[0]).toContain('시작일 변경')
  expect(rows[1]).toContain('마일스톤 변경')
  // 한 줄 문구에서는 활동 기록의 「필드」 대신 「필드 변경」(개요와 같은 바꿔 쓰기).
  expect(rows[2]).toContain('필드 변경')
  // 모르는 종류는 원본 대신 「수정」.
  expect(rows[3]).toContain('수정')
  // 영문 원본이 새지 않는다.
  raws.forEach((raw, i) => expect(rows[i]).not.toContain(raw))
})

test('이슈 이력 표의 모든 종류가 원본 문자열이 아닌 공용 문구(historyEventPhrase)로 보인다', () => {
  // 이력 표에 새 종류가 생기면 위젯도 따라오는지 함께 본다(표와 백엔드 enum 대조는 issueHistoryLabels.backend.test.ts).
  const types = Object.keys(HISTORY_EVENT_LABEL)
  renderScreen(<ActivityWidget previewData={pageOf(types)} />)
  const rows = rowTexts()
  types.forEach((t, i) => {
    expect(rows[i], t).toContain(historyEventPhrase(t))
    expect(rows[i], t).not.toContain(t)
  })
})
