// 노트 페이지 헤더 — 브레드크럼 경로 렌더 + 조상 클릭 내비게이션, 헤더 ⋯ 삭제 플로우.
// 헤더 ⋯ 삭제(DELETE·이동)·AI 배지 유무는 src/pages/wiki/wikiPage.test.tsx 가 지킨다(WP-983). 여기엔 배선(@wiring)과 기하(@layout)만 남는다.
import type { Locator, Page } from '@playwright/test'

import type { WikiPageDetail, WikiPageSummary, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'
import { DESKTOP_WIDTHS, columnGaps, expectHeaderBottomAt56 } from '../../fixtures/layout'
import { measureBox } from '../../fixtures/wait'

const SPACE_ID = 1
const space: WikiSpace = {
  id: SPACE_ID,
  type: 'PERSONAL',
  name: '내 노트',
  ownerId: 1,
  role: 'OWNER',
  createdAt: '2026-06-01T00:00:00Z',
}
const TREE: WikiPageSummary[] = [
  { id: 1, parentId: null, title: '제품 문서', position: 0, aiLastUsedAt: null },
  { id: 2, parentId: 1, title: '기획', position: 0, aiLastUsedAt: null },
]
function detail(id: number, title: string): WikiPageDetail {
  return {
    id,
    spaceId: SPACE_ID,
    parentId: id === 2 ? 1 : null,
    title,
    body: '',
    version: 1,
    updatedBy: 1,
    updatedAt: '2026-06-01T00:00:00Z',
    aiLastUsedAt: null,
    aiLastAction: null,
  }
}

// 공통 모킹 — 스페이스/트리/백링크/멘션 + 페이지 GET·DELETE.
// tree·pageDetail 로 경로 깊이·제목·AI 이력을 바꿔 쓴다(기본: 제품 문서 › 기획).
async function setupRoutes(
  page: Page,
  {
    tree = TREE,
    pageDetail = (id: number) => detail(id, id === 2 ? '기획' : '제품 문서'),
  }: { tree?: WikiPageSummary[]; pageDetail?: (id: number) => WikiPageDetail } = {},
) {
  await page.route('**/api/v1/wiki/spaces', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([space]) }),
  )
  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree) }),
  )
  await page.route('**/api/v1/wiki/pages/*/backlinks', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/v1/wiki/pages/*/mentions', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/v1/wiki/pages/*', (r) => {
    // DELETE → 204. 그 외(GET 등) → 페이지 상세.
    if (r.request().method() === 'DELETE') return r.fulfill({ status: 204, body: '' })
    const id = Number(new URL(r.request().url()).pathname.split('/').pop())
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pageDetail(id)) })
  })
}

/** AI 생성 이력이 있는 페이지 상세 — 헤더에 "AI 생성 포함" 배지가 붙는 경우. */
function withAi(d: WikiPageDetail): WikiPageDetail {
  return { ...d, aiLastUsedAt: '2026-07-20T00:00:00Z', aiLastAction: 'draft' }
}

/** 긴 실데이터형 제목으로 depth 단계의 경로 트리를 만든다(id 1 = 루트, id depth = 현재 페이지). */
function deepTree(depth: number): WikiPageSummary[] {
  const titles = [
    '2026 하반기 제품 로드맵 및 분기별 실행 계획',
    '노트 실시간 동시 편집 설계 검토 회의록 모음',
    '협업 인프라 — Yjs 동기화 서버 운영 가이드',
    '장애 대응 플레이북과 분기별 회고 기록',
    '디자인 시스템 컴포넌트 접근성 점검 결과',
    '모바일·데스크톱 헤더 레이아웃 정리 작업',
    '브레드크럼 접기 규칙 디자이너 합의 메모',
  ]
  return Array.from({ length: depth }, (_, i) => ({
    id: i + 1,
    parentId: i === 0 ? null : i,
    title:
      i === depth - 1
        ? '10월 8일 디자이너 리뷰 — 동기화 상태 칩과 헤더 경로 개선안'
        : (titles[i] ?? `하위 문서 묶음 ${i + 1}단계 — 상세 설계와 결정 기록`),
    position: 0,
    aiLastUsedAt: null,
  }))
}

/** 해당 트리의 페이지 상세(부모 연결 포함) — AI 배지까지 붙은 가장 빡빡한 경우. */
function deepDetail(tree: WikiPageSummary[]) {
  return (id: number) => {
    const node = tree.find((t) => t.id === id) ?? tree[tree.length - 1]
    return withAi({ ...detail(node.id, node.title), parentId: node.parentId })
  }
}

/** 경로 행(nav 의 내부 flex 행) 넘침 — overflow-hidden 안전망이 있어도 scrollWidth 로 실제 내용 넘침을 잰다. */
function rowOverflow(nav: Locator) {
  return nav.evaluate((el) => {
    const row = el.firstElementChild as HTMLElement
    return Math.max(row.scrollWidth - row.clientWidth, el.scrollWidth - el.clientWidth)
  })
}

test(
  '노트 헤더 — 브레드크럼 경로 + 조상 클릭 내비게이션',
  { tag: ['@wiring', '@smoke'] },
  async ({ authenticatedPage: page }) => {
    await setupRoutes(page)

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/2`)
    const header = page.getByTestId('wiki-page-header')
    // 시작점은 노트 공간(§B-1, WP-979) — 조상 페이지·공간은 링크다.
    await expect(header.getByTestId('wiki-breadcrumb-space')).toHaveText('내 노트')
    await expect(header.getByTestId('wiki-breadcrumb-space')).toHaveAttribute('href', `/wiki/spaces/${SPACE_ID}`)
    await expect(header.getByRole('link', { name: '제품 문서' })).toBeVisible()
    await expect(header.getByTestId('wiki-breadcrumb-current')).toHaveText('기획')
    // WP-816: 본문 제목은 편집 칸이라 헤더에 노트 제목을 숨은 h1 로 둔다(스크린리더 제목 이동용).
    await expect(page.getByRole('heading', { level: 1, name: '기획' })).toBeAttached()
    // WP-814: 탭 제목은 노트 제목 · 노트.
    await expect(page).toHaveTitle('기획 · 노트 · Gen:iA Works')

    await header.getByRole('link', { name: '제품 문서' }).click()
    await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${SPACE_ID}/pages/1$`))
  },
)

// #830: 제목이 길어 브레드크럼이 truncate 폭 전체를 채워도, 뷰포트 중앙에 fixed 로 떠 있는
// 전역 AI 어시스턴트 런처(AIChip)와 겹치지 않아야 한다 — Page.Header 좌측 그룹 공통 클램프(useAiChipClamp — 칩 위치 실측) 회귀 검증.
test('노트 헤더 — 긴 제목의 브레드크럼이 전역 AI 어시스턴트 런처와 겹치지 않는다 (#830)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const longTitle = '가나다라마바사아자차카타파하'.repeat(15) // 210자
  await setupRoutes(page, { pageDetail: (id) => detail(id, longTitle) })
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/1`)
  const nav = page.getByTestId('wiki-page-header').getByRole('navigation', { name: '페이지 경로' })
  const launcher = page.getByTestId('chat-launcher')
  await expect(nav).toBeVisible()
  await expect(launcher).toBeVisible()

  // 헤더·런처가 보인 직후엔 레이아웃(truncate 폭)이 자리 잡기 전일 수 있어 측정+단언을 재시도한다 (WP-225)
  await expect(async () => {
    const navBox = await measureBox(nav, 'nav')
    const launcherBox = await measureBox(launcher, 'launcher')
    // 브레드크럼 nav 의 우측 끝이 AI 런처의 좌측 끝을 넘지 않아야 한다(= 겹치지 않음).
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(launcherBox.x)
  }).toPass()
})

// 페이지 틀(Page) 통합: 헤더 하단선은 사이드바와 한 선, 본문은 읽기 폭(≤768)을 본문 스크롤 영역 가운데에 둔다(WP-793 — 노트만
// 가운데 정렬 예외. 넓은 화면에서 오른쪽만 크게 비지 않게). 「전체 폭」 페이지의 시작선 정렬은 wiki-full-width.spec 이 본다.
for (const width of DESKTOP_WIDTHS) {
  test(`노트 헤더 — 본문 폭 ≤ 768 이고 본문 영역 가운데 @${width}px`, { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await setupRoutes(page)

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/2`)
    await expectHeaderBottomAt56(page.getByTestId('wiki-page-header'))
    const { width: colWidth, left, right } = await columnGaps(page.getByTestId('page-body-content'), page.getByTestId('wiki-editor-scroll'))
    expect(colWidth).toBeLessThanOrEqual(768)
    // 좌우 여백 차이 — 세로 스크롤바 폭(≤ 16px) 이내.
    expect(Math.abs(left - right), `좌 ${left} · 우 ${right}`).toBeLessThanOrEqual(16)
  })
}

// WP-304: 1024px 부근에선 nav 클램프(#830)로 폭이 좁아지는데, 모든 경로 항목이 같은 비율로 줄어 현재 페이지 제목까지
// 0 폭이 되던 회귀 — 현재 제목은 보이고, 폭이 모자라면 공용 브레드크럼이 시작점(공간)·현재만 남기고 가운데를 「…」로 접는다(WP-979).
for (const width of [1024, 1100, 1280]) {
  test(`노트 헤더 — ${width}px 에서 긴 경로라도 현재 페이지 제목이 보인다 (WP-304)`, { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    const tree = deepTree(3)
    await setupRoutes(page, { tree, pageDetail: deepDetail(tree) })

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/3`)
    const nav = page.getByTestId('wiki-page-header').getByRole('navigation', { name: '페이지 경로' })
    const current = nav.getByTestId('wiki-breadcrumb-current')
    await expect(current).toBeVisible()

    await expect(async () => {
      const box = await measureBox(current, 'current-crumb')
      // 현재 제목은 몇 글자라도 보인다 — 0 폭이면 아무것도 안 보인다.
      expect(box.width).toBeGreaterThan(0)
      // 조상이 먼저 줄어든다 — 보이는 조상(공간 포함)은 어느 것도 현재 제목보다 넓지 않다.
      for (const anc of [nav.getByTestId('wiki-breadcrumb-space'), ...(await nav.getByTestId('wiki-breadcrumb-ancestor').all())]) {
        if (!(await anc.isVisible())) continue
        expect((await measureBox(anc, 'ancestor')).width).toBeLessThanOrEqual(box.width)
      }
      // 경로가 nav 밖(우측 액션 그룹·AI 런처 쪽)으로 넘치지 않는다.
      expect(await rowOverflow(nav)).toBeLessThanOrEqual(1)
      // 줄임표 truncate 가 실제로 걸려 있어야 한다(잘린 제목이 …로 끝남).
      const style = await current.evaluate((el) => {
        const cs = getComputedStyle(el)
        return { textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace }
      })
      expect(style).toEqual({ textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
    }).toPass()

    // 접혔으면 숨긴 조상으로도 「…」 메뉴(경로 순서)로 이동할 수 있어야 한다.
    const more = nav.getByTestId('breadcrumb-more')
    if (await more.isVisible()) {
      await expect(nav.getByTestId('wiki-breadcrumb-ancestor')).toHaveCount(0)
      await more.click()
      // 아주 좁으면 시작점(공간)까지 접혀 메뉴 맨 앞에 온다 — 조상 페이지는 그 뒤 경로 순서.
      const texts = await page.getByRole('menuitem').allTextContents()
      expect(texts.slice(-2)).toEqual(tree.slice(0, 2).map((t) => t.title))
      await page.getByRole('menuitem', { name: tree[0].title }).click()
      await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${SPACE_ID}/pages/1$`))
    } else {
      await expect(nav.getByTestId('wiki-breadcrumb-ancestor')).toHaveCount(2)
    }
  })
}

// WP-979 리뷰: AI 배지가 경로 밖 형제였을 때 nav 가 내용 폭이라, 한 번 접힌 뒤 창을 넓혀도 다시 펼치지 않았다 —
// 배지를 경로 뒤(trailing)에 두고 접기 판정이 그 폭까지 센다.
test('노트 헤더 — 좁혀서 접힌 경로는 창을 넓히면 다시 펼친다(AI 배지 있음)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 })
  // 중간 길이 경로 — 1024 에선 넘쳐 접히고, 2400 에선(헤더 왼쪽은 AI 런처 앞까지라 절반 남짓) 다 펼쳐 들어간다.
  const tree: WikiPageSummary[] = [
    { id: 1, parentId: null, title: '제품 기획 문서 모음', position: 0, aiLastUsedAt: null },
    { id: 2, parentId: 1, title: '하반기 로드맵', position: 0, aiLastUsedAt: null },
    { id: 3, parentId: 2, title: '헤더 경로 정리안', position: 0, aiLastUsedAt: null },
  ]
  await setupRoutes(page, { tree, pageDetail: deepDetail(tree) })
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/3`)
  const nav = page.getByTestId('wiki-page-header').getByRole('navigation', { name: '페이지 경로' })
  await expect(nav.getByTestId('wiki-page-ai-attribution-badge')).toBeVisible()
  await expect(nav.getByTestId('breadcrumb-more')).toBeVisible()

  await page.setViewportSize({ width: 2400, height: 800 })
  await expect(nav.getByTestId('breadcrumb-more')).toHaveCount(0)
  await expect(nav.getByTestId('wiki-breadcrumb-ancestor')).toHaveCount(2)
  await expect(nav.getByTestId('wiki-page-ai-attribution-badge')).toBeVisible()
})

// WP-304 리뷰: 깊은 경로를 전부 펼치면 클램프를 넘어 AI 런처와 겹쳤다 — 4단계를 넘으면 시작점(공간)·현재만 남기고
// 가운데를 「…」 메뉴(경로 순서)로 접는다(§B-1 「접기」, WP-979).
test('노트 헤더 — 1600px·8단 깊은 경로도 nav 를 넘치지 않고 런처와 겹치지 않는다 (WP-304)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const tree = deepTree(8)
  await setupRoutes(page, { tree, pageDetail: deepDetail(tree) })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/8`)
  const nav = page.getByTestId('wiki-page-header').getByRole('navigation', { name: '페이지 경로' })
  const launcher = page.getByTestId('chat-launcher')
  await expect(nav.getByTestId('wiki-breadcrumb-current')).toBeVisible()
  await expect(launcher).toBeVisible()

  await expect(async () => {
    expect(await rowOverflow(nav)).toBeLessThanOrEqual(1)
    const navBox = await measureBox(nav, 'nav')
    const launcherBox = await measureBox(launcher, 'launcher')
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(launcherBox.x)
    expect((await measureBox(nav.getByTestId('wiki-breadcrumb-current'), 'current')).width).toBeGreaterThanOrEqual(56)
  }).toPass()

  // 공간·현재만 보이고 조상 페이지 7개는 모두 접힌다.
  await expect(nav.getByTestId('wiki-breadcrumb-space')).toBeVisible()
  await expect(nav.getByTestId('wiki-breadcrumb-ancestor')).toHaveCount(0)
  // 「…」 메뉴는 접힌 조상을 경로 순서대로 나열한다.
  await nav.getByTestId('breadcrumb-more').click()
  await expect(page.getByRole('menuitem')).toHaveText(tree.slice(0, 7).map((t) => t.title))
})
