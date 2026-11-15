// 프로젝트 개요(WP-1478) — 좁은 폭에서 긴 이슈 제목이 위젯을 화면 밖으로 밀지 않는지(jsdom 이 잴 수 없는 기하).
// 위젯 내용·타일 전환·링크는 src/pages/projects/projectOverview.test.tsx 가 지킨다.
import { createProject } from '../../factories/project.factory'
import {
  createActivityGroup,
  createAttentionItem,
  createCycleProgress,
  createProjectOverview,
  overviewHuman,
} from '../../factories/projectOverview.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockHelpBundle } from '../../fixtures/help-bundle-mock'

const KEY = 'WP'
const LONG = '아주 긴 이슈 제목이 한 줄을 넘어 위젯 폭보다 길어지는 경우에도 위젯은 화면 안에 남아야 한다'

test.describe('프로젝트 개요 — 좁은 폭', { tag: '@layout' }, () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('390px 에서 긴 제목이 있어도 위젯이 화면 폭을 넘지 않는다', async ({ authenticatedPage: page }) => {
    const overview = createProjectOverview()
    overview.attention.overdue.items = [createAttentionItem(24, LONG, 30, [overviewHuman(1, '양동희')])]
    overview.activity = [createActivityGroup({ actor: overviewHuman(1, '양동희'), count: 1, issue: { issueKey: 'WP-24', number: 24, title: LONG } })]
    await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill({ json: createProject({ key: KEY }) }))
    await page.route(`**/api/v1/projects/${KEY}/overview`, (r) => r.fulfill({ json: overview }))
    await page.goto(`/projects/${KEY}/overview`)

    const widgets = page.getByTestId('project-overview-widgets')
    await expect(widgets.getByText(LONG).first()).toBeVisible()

    // 위젯 영역의 오른쪽 끝이 화면 안 — 고치기 전에는 살펴볼 이슈·작업량·최근 활동이 620px 로 넓어졌다.
    const overflow = await widgets.evaluate((root) => {
      const limit = root.getBoundingClientRect().right
      return [...root.querySelectorAll('section, ul')]
        .map((el) => Math.round(el.getBoundingClientRect().right - limit))
        .filter((d) => d > 1)
    })
    expect(overflow).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })

  // WP-1626 — 종료선이 그래프 오른쪽 끝(사이클 종료일 = 그래프 끝)일 때 「종료 11/23」이 「종료 / 11/23」으로 세로로 쌓였다.
  // 선이 끝·가운데·시작 가까이 어디에 서도 글은 한 줄이고 그래프 안이어야 한다(가로는 시작 ~ max(종료일, 예상일)).
  const endCases = [
    { name: '오른쪽 끝(사이클 종료일 = 그래프 끝)', progress: createCycleProgress(), text: '종료 11/23' },
    { name: '가운데(예상일이 종료일보다 늦은 버전)', progress: createCycleProgress({ kind: 'VERSION', projectedDate: '2026-12-06' }), text: '출시 11/23' },
    {
      name: '왼쪽 끝(종료일 다음 날 시작한 것처럼 예상일이 아주 늦음)',
      progress: createCycleProgress({ target: { id: 3, name: 'v1', start: '2026-11-10', end: '2026-11-11' }, projectedDate: '2027-02-17' }),
      text: '종료 11/11',
    },
  ]
  for (const c of endCases) {
    test(`진행 중 그래프의 종료선 글이 한 줄로 그래프 안에 보인다 — ${c.name}`, async ({ authenticatedPage: page }) => {
      const overview = createProjectOverview()
      overview.progress = c.progress
      await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill({ json: createProject({ key: KEY }) }))
      await page.route(`**/api/v1/projects/${KEY}/overview`, (r) => r.fulfill({ json: overview }))
      await page.goto(`/projects/${KEY}/overview`)

      const label = page.getByTestId('progress-end-label')
      await expect(label).toHaveText(c.text)
      const box = await label.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const chart = el.closest('[data-testid="progress-chart"]')!.getBoundingClientRect()
        return { height: r.height, over: r.right - chart.right, under: chart.left - r.left }
      })
      // text-xs 한 줄은 16px — 두 줄이면 32px 다.
      expect(box.height).toBeLessThan(24)
      expect(box.over).toBeLessThanOrEqual(0)
      expect(box.under).toBeLessThanOrEqual(0)
    })
  }
})

// WP-1610 — 도움말 패널을 연 1280px 데스크탑처럼 우측 열(12열 중 4열) 카드가 좁아질 때 「열린 이슈」·「작업량」 줄의 건수가 카드 밖으로 밀리지 않는다.
// 라벨 칸이 고정 폭(shrink-0)이라 막대가 0이 된 뒤에도 건수가 넘쳤다 — 이제 라벨이 줄며 말줄임된다.
test.describe('프로젝트 개요 — 도움말 패널을 연 데스크탑', { tag: '@layout' }, () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('세 자리 건수와 긴 담당자 이름이 있어도 건수가 카드 안에 보인다', async ({ authenticatedPage: page }) => {
    const overview = createProjectOverview()
    overview.openIssues = { total: 806, todo: 403, inProgress: 403, unassigned: 400 }
    overview.workload.unassigned = 400
    overview.workload.top = overview.workload.top.map((u) => ({ ...u, name: `${u.name} 아주 긴 이름의 담당자`, count: 403 }))
    await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill({ json: createProject({ key: KEY }) }))
    await page.route(`**/api/v1/projects/${KEY}/overview`, (r) => r.fulfill({ json: overview }))
    await mockHelpBundle(page)
    await page.goto(`/projects/${KEY}/overview`)
    await page.getByTestId('help-toggle').click()
    await expect(page.getByTestId('help-panel')).toBeVisible()

    for (const cardId of ['project-overview-open', 'project-overview-workload']) {
      const card = page.getByTestId(cardId)
      await expect(card.locator('[data-testid$="-value"]').first()).toBeVisible()
      // 줄마다 건수 칸의 오른쪽 끝이 카드 오른쪽 끝(안쪽 여백 포함) 안이다.
      const outside = await card.evaluate((root) => {
        const limit = root.getBoundingClientRect().right
        return [...root.querySelectorAll('[data-testid$="-value"]')]
          .map((el) => ({ id: el.getAttribute('data-testid'), over: Math.round(el.getBoundingClientRect().right - limit) }))
          .filter((v) => v.over > 0)
      })
      expect(outside, cardId).toEqual([])
    }
  })
})
