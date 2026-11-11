// 프로젝트 화면 탭 줄(WP-1477) — 좁은 폭에서 탭 줄이 줄바꿈 없이 한 줄로 가로 스크롤되는지(jsdom 이 잴 수 없는 기하).
// 탭 목록·선택·이동·마지막 탭 기억은 src/pages/projects/projectTabs.page.test.tsx 가 지킨다.
import { createProject } from '../../factories/project.factory'
import { expect, test } from '../../fixtures/auth.fixture'

const KEY = 'WP'

test.describe('프로젝트 탭 줄 — 좁은 폭', { tag: '@layout' }, () => {
  test.use({ viewport: { width: 320, height: 720 } })

  test('320px 에서 탭 다섯이 한 줄에 있고, 탭 줄 안에서만 가로로 스크롤된다', async ({ authenticatedPage: page }) => {
    await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill({ json: createProject({ key: KEY, name: '아주 긴 프로젝트 이름으로 머리줄을 채운다' }) }))
    await page.goto(`/projects/${KEY}/cycles`)
    // 탭 줄은 nav「프로젝트 탭」 안 페이지 이동 링크 — 지금 탭은 aria-current="page".
    const nav = page.getByRole('navigation', { name: '프로젝트 탭' })
    await expect(nav.getByRole('link', { name: '사이클' })).toHaveAttribute('aria-current', 'page')

    // 줄바꿈 없음 — 모든 탭의 위쪽이 같다.
    const tops = await nav.getByRole('link').evaluateAll((tabs) => tabs.map((t) => Math.round(t.getBoundingClientRect().top)))
    expect(tops).toHaveLength(5)
    expect(new Set(tops).size).toBe(1)

    // 문서는 가로로 넘치지 않고, 탭 줄(nav)만 스크롤 컨테이너다 — 스크롤바는 숨긴다.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    const style = await nav.evaluate((el) => ({ overflowX: getComputedStyle(el).overflowX, scrollbar: getComputedStyle(el).scrollbarWidth }))
    expect(style).toEqual({ overflowX: 'auto', scrollbar: 'none' })

    // 마지막 탭(버전)까지 스크롤해 누를 수 있다.
    await nav.getByRole('link', { name: '버전' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/versions$`))
  })
})
