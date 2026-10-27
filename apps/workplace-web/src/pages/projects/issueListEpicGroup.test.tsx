// 이슈 목록 「에픽」 그룹·그룹 헤더 접기·에픽 칩 숨김(WP-194) — 화면 테스트(WP-980, WP-1002 에서 목록 화면(ProjectDetailPage)만 띄우게 바꿈).
// 그룹 셀렉트 → URL group=epic → 섹션 렌더, 헤더 접기/펼치기(aria-expanded), 에픽 필터·그룹 안 칩 숨김은 브라우저 없이 판정되므로
// e2e/pages/projects/issue-list-epic-group.spec.ts 에서 옮겼다. 그 spec 에는 무한 스크롤 sentinel(뷰포트 교차)·칩 폭(@layout)이 남는다.
// 버킷 순서·「에픽 없음」 배치는 issueGrouping.test.ts 가 맡는다.
import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'

import { issueListHandlers } from '@/test/kits/projects/issueDetailStubs'
import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeEpicType, makeSubtaskType } from '../../../e2e/factories/issueType.factory'

const KEY = 'WP'
const epic = (number: number, title: string) => ({ number, title, type: makeEpicType() })
// 에픽이 아닌 부모(STORY) — 「에픽 없음」 으로 가야 한다.
const storyParent = { number: 7, title: '스토리', type: { id: 2, name: 'STORY', colorToken: 'BLUE' as const, icon: 'Flag' as const } }
const ISSUES = [
  createIssue({ id: 1, number: 1, title: '결제 A', parent: epic(30, '결제 안정화') }),
  createIssue({ id: 2, number: 2, title: '결제 B', parent: epic(30, '결제 안정화') }),
  createIssue({ id: 3, number: 3, title: '모바일 A', parent: epic(12, '모바일 UX') }),
  createIssue({ id: 4, number: 4, title: '부모 없음' }),
  createIssue({ id: 5, number: 5, title: '스토리 자식', type: makeSubtaskType(), parent: storyParent }),
]

const open = (query: string) =>
  renderProjectScreen(`/projects/${KEY}?${query}`, { handlers: issueListHandlers({ issues: () => createIssueSearchResponse(ISSUES) }) })

test('그룹 셀렉트에서 에픽 선택 → URL group=epic + 에픽 섹션 헤더 렌더', async () => {
  const { user, location } = open('group=none')
  await user.click(await screen.findByTestId('group-by-trigger'))
  await user.click(await screen.findByTestId('group-by-epic'))
  await waitFor(() => expect(location()).toMatch(/group=epic/))
  expect(within(await screen.findByTestId('list-group-epic-30')).getByTestId('issue-row-1')).toBeInTheDocument()
  expect(screen.getByTestId('list-group-toggle-epic-30')).toHaveTextContent('결제 안정화')
})

test('그룹 헤더 클릭으로 그 그룹만 접고 펼친다', async () => {
  const { user } = open('group=epic')
  const toggle = await screen.findByTestId('list-group-toggle-epic-30')
  expect(screen.getByTestId('issue-row-1')).toBeInTheDocument()
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await user.click(toggle)
  await waitFor(() => expect(screen.queryByTestId('issue-row-1')).not.toBeInTheDocument())
  expect(screen.queryByTestId('issue-row-2')).not.toBeInTheDocument()
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  // 다른 그룹은 그대로.
  expect(screen.getByTestId('issue-row-3')).toBeInTheDocument()
  await user.click(toggle)
  expect(await screen.findByTestId('issue-row-1')).toBeInTheDocument()
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
})

test('특정 에픽 필터 / 에픽 그룹 안에선 에픽 칩을 숨기고, 비에픽(STORY) 부모 칩은 유지한다', async () => {
  // 양성 대조 — 그룹 없음에선 에픽 행에 칩이 보인다.
  let view = open('group=none')
  expect(await screen.findByTestId('issue-row-1-parent')).toBeInTheDocument()
  expect(screen.getByTestId('issue-row-5-parent')).toBeInTheDocument()
  view.unmount()

  view = open('group=epic')
  expect(await screen.findByTestId('issue-row-1')).toBeInTheDocument()
  expect(screen.queryByTestId('issue-row-1-parent')).not.toBeInTheDocument()
  // STORY 부모는 에픽이 아니므로 「에픽 없음」 그룹에서도 칩 유지.
  expect(screen.getByTestId('issue-row-5-parent')).toBeInTheDocument()
  view.unmount()

  open('group=none&parent=30')
  expect(await screen.findByTestId('issue-row-1')).toBeInTheDocument()
  expect(screen.queryByTestId('issue-row-1-parent')).not.toBeInTheDocument()
})
