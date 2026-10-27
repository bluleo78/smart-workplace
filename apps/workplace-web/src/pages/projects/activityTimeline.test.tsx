// 이슈 상세 「이력」 탭 활동 타임라인·부모 상태 표시 — 페이지 테스트(WP-980).
// 날짜 포맷(#320)·enum 한국어 매핑(#157)·상태 이전 문구(WP-809)·유형별 아이콘(#313)·접기/펼치기(#341)·부모 상태 이름(WP-869)은
// 모두 상세 응답 → 문구·개수로 브라우저 없이 판정되므로 e2e/pages/projects/activity-timeline.spec.ts 에서 옮겼다(그 spec 은 지웠다).
// 화면 컴포넌트 테스트(WP-1002) — 상세 화면 전체 대신 그 판정을 가진 컴포넌트만 띄운다: 이력은 활동 탭 묶음(IssueBodyTabs),
// 부모 상태는 속성 레일의 부모 칸(IssueParentSlot). 값은 상세 화면이 넘기는 것과 같은 상세 응답(createIssueDetail)의 필드다.
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { IssueDetailResponse, IssueHistoryEntry } from '@/types/issue'

import { createHistoryEntry, createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { makeEpicType } from '../../../e2e/factories/issueType.factory'
import { createMember } from '../../../e2e/factories/project.factory'
import { IssueBodyTabs } from './components/IssueBodyTabs'
import { IssueParentSlot } from './components/IssueParentSlot'

const KEY = 'WP'
const OWNER = createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' })

/** 상세의 부모 칸만 띄운다 — 상세 화면이 summary.parent 를 그대로 넘기는 것과 같다(일반 이슈 = 「상위 에픽」). */
function openDetail(detail: IssueDetailResponse) {
  return renderScreen(
    <IssueParentSlot projectKey={KEY} issueNumber={detail.summary.number} parent={detail.summary.parent ?? null} isSubtask={false} />,
    { path: `/projects/${KEY}/issues/1` },
  )
}

/** 이력 탭을 열고 활동 타임라인 목록을 돌려준다 — 활동 섹션은 「이력」 탭 안에 있다(#343). 코멘트 탭의 작성창이 멤버를 부른다. */
async function openHistory(history: IssueHistoryEntry[]) {
  const detail = createIssueDetail({ history })
  const view = renderScreen(
    <IssueBodyTabs projectKey={KEY} issueNumber={1} issueId={detail.summary.id} comments={detail.comments} history={detail.history} canReact />,
    { path: `/projects/${KEY}/issues/1`, handlers: [http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json([OWNER]))] },
  )
  await view.user.click(screen.getByRole('tab', { name: /이력/ }))
  const timeline = await screen.findByRole('list', { name: '활동 타임라인' })
  return { ...view, timeline }
}

describe('활동 타임라인 — 표시 문구', () => {
  // #320: toLocaleString('ko-KR') 잔재로 초까지 나오던 회귀 — UTC 시각을 KST 분 단위로 보인다.
  test('날짜는 초 없이 분 단위(YYYY-MM-DD HH:mm)로 보인다', async () => {
    const { timeline } = await openHistory([createHistoryEntry({ id: 20, actorName: '사람 사용자', createdAt: '2026-06-07T00:22:52Z' })])
    const item = within(timeline).getAllByRole('listitem')[0]
    expect(item).toHaveTextContent('2026-06-07 09:22')
    expect(item.textContent).not.toMatch(/\d{1,2}:\d{2}:\d{2}/)
  })

  // #157: 백엔드 영문 enum 이 그대로 노출되지 않고, 두 이벤트 분기·부모 설정(WP-862)이 매핑 함수를 거쳐 그려지는지.
  test('상태·우선순위·부모 변경 이력이 한국어 표시명으로 보인다', async () => {
    const { timeline } = await openHistory([
      createHistoryEntry({ id: 1, eventType: 'STATUS_CHANGED', fromValue: 'TODO', toValue: 'IN_PROGRESS' }),
      createHistoryEntry({ id: 4, eventType: 'PRIORITY_CHANGED', fromValue: 'LOW', toValue: 'HIGH' }),
      createHistoryEntry({
        id: 5,
        eventType: 'PARENT_CHANGED',
        fromValue: null,
        toValue: JSON.stringify({ from: null, to: { number: 68, title: 'r76 에픽' } }),
      }),
    ])
    expect(timeline).toHaveTextContent('할 일 → 진행 중')
    expect(timeline).toHaveTextContent('낮음 → 높음')
    expect(timeline).toHaveTextContent(`부모를 「r76 에픽」(${KEY}-68)으로 설정`)
    expect(timeline.textContent).not.toMatch(/TODO|IN_PROGRESS/)
  })

  // WP-808: 예전 행은 범주 코드(TODO), 새 행은 상태 이름 — 섞여 와도 각자 읽힌다.
  test('예전 이력 코드는 범주 라벨, 새 이력은 상태 이름으로 보인다', async () => {
    const { timeline } = await openHistory([createHistoryEntry({ id: 1, eventType: 'STATUS_CHANGED', fromValue: 'TODO', toValue: '검토 중' })])
    expect(timeline).toHaveTextContent('할 일 → 검토 중')
    expect(timeline.textContent).not.toContain('TODO')
  })

  // WP-809: 상태 삭제로 옮겨진 이슈는 사용자 변경과 구분되는 「상태 이전」 문구와 아이콘.
  test('STATUS_MIGRATED 이력은 상태 삭제로 문구와 아이콘을 보인다', async () => {
    const { timeline } = await openHistory([
      createHistoryEntry({ id: 1, eventType: 'STATUS_MIGRATED', actorName: '김리드', fromValue: '코드 리뷰 중', toValue: '진행 중' }),
    ])
    expect(timeline).toHaveTextContent("상태 이전: 상태 삭제로 '코드 리뷰 중' → '진행 중'")
    expect(timeline.querySelector('li svg[aria-hidden="true"]')).not.toBeNull()
  })

  // #313: 이벤트 유형별 아이콘이 각 항목에 빠짐없이 붙는다.
  test('이벤트 유형별 아이콘이 각 항목에 그려진다', async () => {
    const { timeline } = await openHistory([
      createHistoryEntry({ id: 10, eventType: 'STATUS_CHANGED' }),
      createHistoryEntry({ id: 11, eventType: 'ASSIGNEES_CHANGED', fromValue: null, toValue: JSON.stringify({ added: [{ id: 1, name: '홍길동' }], removed: [] }) }),
      createHistoryEntry({ id: 12, eventType: 'LABELS_CHANGED', fromValue: null, toValue: JSON.stringify({ added: [{ name: 'bug' }], removed: [] }) }),
    ])
    const items = within(timeline).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    for (const item of items) expect(item.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('활동 타임라인 — 접기/펼치기 (#341)', () => {
  const entries = (n: number) => Array.from({ length: n }, (_, i) => createHistoryEntry({ id: i + 1, eventType: 'STATUS_CHANGED' }))

  test('MAX(5) 이하면 더 보기 없이 전부 보인다', async () => {
    const { timeline } = await openHistory(entries(5))
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /더 보기/ })).not.toBeInTheDocument()
  })

  test('MAX 를 넘으면 최근 5건 + 「이전 N건 더 보기」, 펼치면 전부 + 접기, 접으면 다시 5건', async () => {
    const { timeline, user } = await openHistory(entries(8))
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(5)
    await user.click(screen.getByRole('button', { name: '이전 3건 활동 더 보기' }))
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(8)
    expect(screen.queryByRole('button', { name: '이전 3건 활동 더 보기' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '활동 이력 접기' }))
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByRole('button', { name: '이전 3건 활동 더 보기' })).toBeInTheDocument()
  })
})

// WP-869: 부모 표시가 범주만 알아 사용자 정의 상태(「검토 중」)를 보이지 못했다.
describe('이슈 상세 — 부모 상태 (WP-869)', () => {
  test('부모 표시에 상태 이름과 상태 색 아이콘이 보인다', async () => {
    openDetail(
      createIssueDetail({
        summary: createIssue({
          id: 1,
          number: 1,
          parent: { number: 5, title: '결제 개편 에픽', type: makeEpicType(), status: 'IN_PROGRESS', statusId: 12, statusName: '검토 중', statusColor: 'PURPLE' },
        }),
      }),
    )
    const slot = screen.getByTestId('issue-parent-slot')
    expect(within(slot).getByTestId('parent-badge-5')).toHaveTextContent('결제 개편 에픽')
    const status = within(slot).getByTestId('issue-parent-status')
    expect(status).toHaveTextContent(/^검토 중$/)
    expect(status.querySelector('svg')).toHaveClass('text-purple-700')
  })

  test('구 서버 응답(상태 이름 없음)이면 범주 라벨을 보인다', async () => {
    openDetail(
      createIssueDetail({ summary: createIssue({ id: 1, number: 1, parent: { number: 5, title: '결제 개편 에픽', type: makeEpicType(), status: 'DONE' } }) }),
    )
    expect(within(screen.getByTestId('issue-parent-slot')).getByTestId('issue-parent-status')).toHaveTextContent(/^완료$/)
  })
})
