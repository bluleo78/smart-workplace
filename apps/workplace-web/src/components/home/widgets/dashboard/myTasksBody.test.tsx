// 홈 「내 작업」 대시보드 위젯 본문(MyTasksBody) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 그룹 헤더 → 필터 조회 주소, 담당 0건일 때의 긍정적 빈 상태·구독 변동 라인·헤더 부제, 한쪽 조회 5xx → 오류+재시도는
// 브라우저 없이 판정되므로 e2e/pages/home-widget-mytasks.spec.ts 에서 옮겼다. 홈 → 위젯 → 이슈 상세 배선은 그 E2E 의 @wiring 1건이 지킨다.
// 버킷 순서·중복 제거 규칙은 lib/myTasks.test.ts(buildMyTaskRows) 몫이다.
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { IssueSearchResponse } from '@/types/issue'

import { createIssue, createIssueSearchResponse } from '../../../../../e2e/factories/issue.factory'
import MyTasksBody from './MyTasksBody'

type Issue = ReturnType<typeof createIssue>

/** 담당·구독 두 조회를 준다 — 위젯은 둘 다 있어야 분류한다. */
function renderTasks(assigned: Issue[] | 'fail', watched: Issue[]) {
  return renderScreen(<MyTasksBody count={5} />, {
    path: '/',
    handlers: [
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
  // 헤더 부제(빈 상태 밖) — 구독 총량.
  expect(screen.getByTestId('dash-mytasks')).toHaveTextContent('구독 중 2건')
})

test('담당 0건 + 오늘 구독 변동 없음 → 빈 상태에 변동 라인이 없다', async () => {
  renderTasks([], [createIssue({ id: 30, number: 30, updatedAt: '2026-06-01T00:00:00Z' })])
  const empty = await screen.findByTestId('dash-mytasks-empty')
  expect(empty).not.toHaveTextContent('변동')
})

test('담당 조회만 5xx 여도 위젯 전체를 오류+재시도로 보인다(거짓 분류 금지, #205)', async () => {
  renderTasks('fail', [])
  const error = await screen.findByTestId('dash-mytasks-error')
  expect(error).toHaveTextContent('다시 시도')
  expect(screen.queryByTestId('dash-mytasks')).not.toBeInTheDocument()
})
