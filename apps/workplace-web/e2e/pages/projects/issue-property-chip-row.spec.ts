// 이슈 상세 속성 레일 칩 줄(수정 버전·영향 버전·구성요소, WP-1079) — 실제 브라우저 포커스 복원(@input).
// 첫 값을 붙이면 트리거가 줄 전체 「＋ 추가」에서 칩 뒤 「＋」로 바뀌고 저장 요청이 오가는데, 그 사이 트리거를 잠그거나 다시 만들면
// 팝오버를 닫을 때 돌아온 포커스가 <body> 로 빠져 키보드 사용자가 자리를 잃었다. 칩 줄 모양·권한별 고르기 유무는
// 컴포넌트 테스트(IssueVersionsField.test·IssueComponentsField.test)가 지킨다.
import { createIssue, createIssueDetail } from '../../factories/issue.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockAgentWorkDetail } from '../../fixtures/issue-detail-mock'
import type { VersionSummary } from '../../../src/types/version'

const json = (b: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })

test('첫 버전을 붙이고 팝오버를 닫아도 포커스가 「＋」 트리거에 남는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  const state: { fix: VersionSummary[] } = { fix: [] }
  await page.route((u) => u.pathname === '/api/v1/projects/WP/versions', (r) =>
    r.fulfill(json([{ id: 1, name: 'v1.0', description: null, startDate: null, releaseDate: null, status: 'UNRELEASED', releasedAt: null, progress: { done: 0, inProgress: 0, todo: 0 }, affectsCount: 0 }])))
  await page.route((u) => u.pathname === '/api/v1/projects/WP/components', (r) => r.fulfill(json([])))
  await mockAgentWorkDetail(page, undefined)
  // 상세 GET 은 저장된 값을 돌려주도록 덮어쓴다(나중 등록 route 우선). 저장은 잠깐 걸리게 해 저장 중 상태를 거친다.
  await page.route((u) => u.pathname === '/api/v1/projects/WP/issues/12', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill(json(createIssueDetail({ summary: createIssue({ number: 12, title: '로그인 버그 수정', status: 'IN_PROGRESS', fixVersions: state.fix, affectsVersions: [] }) })))
      : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/projects/WP/issues/12/versions', async (r) => {
    await new Promise((res) => setTimeout(res, 300))
    state.fix = [{ id: 1, name: 'v1.0', status: 'UNRELEASED' }]
    await r.fulfill(json({ fixVersions: state.fix, affectsVersions: [] }))
  })
  await page.goto('/projects/WP/issues/12')

  const trigger = page.getByTestId('fix-version-picker-trigger')
  await expect(trigger).toHaveText('추가')
  await trigger.click()
  await page.getByTestId('fix-version-picker').getByText('v1.0').click()
  await page.keyboard.press('Escape')

  await expect(page.getByTestId('issue-fix-versions')).toContainText('v1.0')
  await expect(trigger).not.toHaveText('추가')
  await expect(trigger).toBeFocused()
})
