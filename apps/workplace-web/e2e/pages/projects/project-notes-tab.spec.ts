// 프로젝트 「노트」 탭(WP-1481) — 탭 → 노트 트리 → 페이지 본문이 이어서 보이는 배선.
// 탭 보이기·첫 페이지 이동·모바일 목록/상세·백링크 주소 같은 판정은 src/pages/projects/projectNotesTab*.test.tsx 가 지킨다.
import { createProject } from '../../factories/project.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockWikiPageEditor } from '../../fixtures/wiki-mock'

const KEY = 'WP'
const SPACE_ID = 9
const PAGE_ID = 21

test('프로젝트 노트 탭: 탭을 누르면 트리와 첫 페이지 본문이 탭 안에 보인다', { tag: ['@wiring'] }, async ({ authenticatedPage: page }) => {
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill({ json: createProject({ key: KEY, name: '워크플레이스' }) }))
  await page.route(`**/api/v1/wiki/project-spaces/${KEY}`, (r) => r.fulfill({ json: { id: SPACE_ID, name: '워크플레이스', projectKey: KEY } }))
  // 페이지 상세·본문(동기화 서버)·트리를 시드한다 — 트리는 아래에서 두 페이지짜리로 덮는다.
  await mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title: '첫번째', body: '프로젝트 노트 본문입니다' })
  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.fulfill({
      json: [
        { id: PAGE_ID, parentId: null, title: '첫번째', position: 0, aiLastUsedAt: null },
        { id: 22, parentId: null, title: '두번째', position: 1, aiLastUsedAt: null },
      ],
    }),
  )

  await page.goto(`/projects/${KEY}`)
  await page.getByRole('navigation', { name: '프로젝트 탭' }).getByRole('link', { name: '노트' }).click()

  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/notes/${PAGE_ID}$`))
  await expect(page.getByTestId('wiki-tree-row-22')).toBeVisible()
  await expect(page.locator('.ProseMirror')).toContainText('프로젝트 노트 본문입니다')
})
