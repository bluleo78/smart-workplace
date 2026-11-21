// 홈 「내 작업」 대시보드 위젯 본문(MyTasksBody) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 그룹 헤더 → 필터 조회 주소, 담당 0건일 때의 긍정적 빈 상태·구독 변동 라인·헤더 부제, 한쪽 조회 5xx → 오류+재시도는
// 브라우저 없이 판정되므로 e2e/pages/home-widget-mytasks.spec.ts 에서 옮겼다. 홈 → 위젯 → 이슈 상세 배선은 그 E2E 의 @wiring 1건이 지킨다.
// 버킷 순서·중복 제거 규칙은 lib/myTasks.test.ts(buildMyTaskRows) 몫이다.
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { IssueSearchResponse } from '@/types/issue'
import type { MeDaySummary } from '@/types/meOverview'

import { createIssue, createIssueSearchResponse } from '../../../../../e2e/factories/issue.factory'
import MyTasksBody from './MyTasksBody'

type Issue = ReturnType<typeof createIssue>

/** 어제/오늘 요약(WP-1484) — 위젯 맨 위 한 줄. */
const TODAY: MeDaySummary = {
  yesterday: '2026-11-10',
  yesterdayCompleted: 5,
  yesterdayCompletedWithAi: 4,
  yesterdayCompletedOnTime: 5,
  yesterdayCreated: 2,
  today: '2026-11-11',
  overdue: 3,
  oldestOverdueDays: 6,
  dueToday: 2,
  waiting: 4,
}

/** 담당·구독 두 조회를 준다 — 위젯은 둘 다 있어야 분류한다. 어제/오늘 요약은 기본 성공, 'fail' 이면 500. */
function renderTasks(assigned: Issue[] | 'fail', watched: Issue[], today: MeDaySummary | 'fail' = TODAY) {
  return renderScreen(<MyTasksBody count={5} />, {
    path: '/',
    handlers: [
      http.get('/api/v1/me/overview/today', () => (today === 'fail' ? HttpResponse.json({}, { status: 500 }) : HttpResponse.json(today))),
      http.get('/api/v1/me/issues', () =>
        assigned === 'fail' ? HttpResponse.json({}, { status: 500 }) : HttpResponse.json(createIssueSearchResponse(assigned) as IssueSearchResponse),
      ),
      http.get('/api/v1/me/watched-issues', () => HttpResponse.json(createIssueSearchResponse(watched))),
    ],
  })
}

test('진행 중 그룹 헤더를 누르면 진행 중 필터가 걸린 할당 조회로 간다', async () => {
  const { user, location } = renderTasks(
    [
      createIssue({ id: 1, number: 1, title: '진행 작업', status: 'IN_PROGRESS' }),
      createIssue({ id: 2, number: 2, title: '미시작 작업', status: 'TODO' }),
    ],
    [],
  )
  await user.click(await screen.findByRole('link', { name: '진행 중 →' }))
  expect(location()).toBe('/me/tasks/assigned?status=IN_PROGRESS')
})

test('막힘 그룹 헤더를 누르면 blocked 필터 조회로 간다', async () => {
  const { user, location } = renderTasks([createIssue({ id: 5, number: 5, title: '막힌 작업', blocked: true })], [])
  await user.click(await screen.findByRole('link', { name: '막힘 →' }))
  expect(location()).toBe('/me/tasks/assigned?blocked=true')
})

test('담당 0건 + 오늘 구독 변동 → 긍정적 빈 상태, 오늘 변동 라인, 헤더에 구독 총량', async () => {
  renderTasks(
    [],
    [createIssue({ id: 20, number: 20, updatedAt: new Date().toISOString() }), createIssue({ id: 21, number: 21, updatedAt: '2026-06-01T00:00:00Z' })],
  )
  const empty = await screen.findByTestId('dash-mytasks-empty')
  expect(empty).toHaveTextContent('지금 손댈 일이 없어요')
  expect(empty).toHaveTextContent('구독 중 오늘 1건 변동')
  // 변동이 있으면 CTA 는 변동 링크 하나뿐 — 새 이슈 바로 가기는 없다.
  expect(within(empty).queryByRole('link', { name: /새 이슈/ })).toBeNull()
  // 헤더 부제(빈 상태 밖) — 구독 총량.
  expect(screen.getByTestId('dash-mytasks')).toHaveTextContent('구독 중 2건')
})

test('담당 0건 + 오늘 구독 변동 없음 → 빈 상태에 변동 라인이 없다', async () => {
  renderTasks([], [createIssue({ id: 30, number: 30, updatedAt: '2026-06-01T00:00:00Z' })])
  const empty = await screen.findByTestId('dash-mytasks-empty')
  expect(empty).not.toHaveTextContent('변동')
  // 변동이 없어도 빈 상태는 늘 다음 행동(새 이슈)을 보인다.
  expect(within(empty).getAllByRole('link')).toHaveLength(1)
  expect(within(empty).getByRole('link', { name: /새 이슈/ })).toHaveAttribute('href', '/projects')
})

test('담당 조회만 5xx 여도 위젯 전체를 오류+재시도로 보인다(거짓 분류 금지, #205)', async () => {
  renderTasks('fail', [])
  const error = await screen.findByTestId('dash-mytasks-error')
  expect(error).toHaveTextContent('다시 시도')
  expect(screen.queryByTestId('dash-mytasks')).not.toBeInTheDocument()
})

test('맨 위 한 줄에 어제 완료·마감 지남·답변 필요, 누르면 내 작업 개요 탭으로 간다(WP-1484)', async () => {
  const { user, location } = renderTasks([createIssue({ id: 1, number: 1, title: '진행 작업', status: 'IN_PROGRESS' })], [])
  const line = await screen.findByTestId('dash-mytasks-today')
  expect(line).toHaveTextContent('어제 완료 5 · 마감 지남 3 · 답변 필요 4')
  // 아래 줄의 「n건이 나를 기다림」과 겹치지 않게 이 줄엔 「나를 기다림」을 쓰지 않는다.
  expect(line).not.toHaveTextContent('나를 기다림')
  await user.click(line)
  expect(location()).toBe('/me/tasks/overview')
})

test('어제/오늘 요약만 실패하면 그 한 줄만 숨기고 목록은 그대로 보인다', async () => {
  renderTasks([createIssue({ id: 1, number: 1, title: '진행 작업', status: 'IN_PROGRESS' })], [], 'fail')
  expect(await screen.findByRole('link', { name: '진행 중 →' })).toBeInTheDocument()
  expect(screen.queryByTestId('dash-mytasks-today')).not.toBeInTheDocument()
  expect(screen.queryByTestId('dash-mytasks-error')).not.toBeInTheDocument()
})

test('행 링크는 이름은 제목만, 설명에 이슈 키와 마감을 담는다(WP-1899)', async () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  renderTasks([createIssue({ id: 7, number: 7, title: '마감 작업', dueDate: yesterday })], [])
  const link = await screen.findByRole('link', { name: '이슈 열기: 마감 작업' })
  expect(link).toHaveAccessibleDescription(/^WP-7 .*지남/)
})

test('meta 가 없는 행은 이슈 키만 설명한다(WP-1899)', async () => {
  renderTasks([createIssue({ id: 8, number: 8, title: '진행 작업', status: 'IN_PROGRESS', dueDate: null })], [])
  const link = await screen.findByRole('link', { name: '이슈 열기: 진행 작업' })
  expect(link).toHaveAccessibleDescription('WP-8')
})

test('구독 행 링크는 설명에 이슈 키와 변동 상대 시각을 담는다(WP-1899)', async () => {
  // 담당 0건이면 빈 상태라 구독 행이 안 그려진다 — 담당 1건을 함께 둔다.
  const threeHoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString()
  renderTasks(
    [createIssue({ id: 1, number: 1, title: '담당 작업', status: 'IN_PROGRESS' })],
    [createIssue({ id: 9, number: 9, title: '구독 작업', updatedAt: threeHoursAgo })],
  )
  const link = await screen.findByRole('link', { name: '이슈 열기: 구독 작업' })
  expect(link).toHaveAccessibleDescription(/^WP-9 .+/)
  expect(link.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2)
})
