// 노트 페이지 헤더 — 브레드크럼 경로 렌더 + 조상 클릭 내비게이션, 헤더 ⋯ 삭제 플로우.
import type { Locator, Page } from '@playwright/test'

import type { WikiPageDetail, WikiPageSummary, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { DESKTOP_WIDTHS, boxOf, expectHeaderBottomAt56, expectStartAligned } from '../../fixtures/layout'
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
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await setupRoutes(page)

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/2`)
    const header = page.getByTestId('wiki-page-header')
    await expect(header.getByRole('button', { name: '제품 문서' })).toBeVisible()
    await expect(header).toContainText('기획')

    await header.getByRole('button', { name: '제품 문서' }).click()
    await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${SPACE_ID}/pages/1$`))
  },
)

test('노트 헤더 — ⋯ 메뉴 → 페이지 삭제 확인 → DELETE 호출 + 스페이스 루트로 이동', async ({
  authenticatedPage: page,
}) => {
  const deletes = trackRequests(page, 'DELETE', /^\/api\/v1\/wiki\/pages\/[^/]+$/)
  await setupRoutes(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/2`)
  // 헤더 ⋯ 메뉴 → 페이지 삭제 → 확인 다이얼로그.
  await page.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
  await page.getByRole('menuitem', { name: '페이지 삭제' }).click()
  await expect(page.getByTestId('wiki-delete-dialog')).toBeVisible()

  await page
    .getByTestId('wiki-delete-dialog')
    .getByRole('button', { name: '삭제', exact: true })
    .click()

  await deletes.waitFor()
  await expect(page).toHaveURL(/\/wiki\/spaces\/1$/)
})

// #736: AI 생성 attribution 배지 — 헤더 좌측(브레드크럼 옆)에 AiSignalBadge 노출.
test('노트 헤더 — AI 생성 이력이 있는 페이지는 브레드크럼 옆에 attribution 배지가 뜬다 (#736)', async ({
  authenticatedPage: page,
}) => {
  await setupRoutes(page, { pageDetail: (id) => withAi(detail(id, '제품 문서')) })
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/1`)
  await expect(page.getByTestId('wiki-page-ai-attribution-badge')).toBeVisible()
  await expect(page.getByTestId('wiki-page-ai-attribution-badge')).toContainText('AI 생성 포함')
})

test('노트 헤더 — AI 이력이 없는 페이지는 attribution 배지가 뜨지 않는다 (#736)', async ({
  authenticatedPage: page,
}) => {
  await setupRoutes(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/1`)
  await expect(page.getByTestId('wiki-page-header')).toBeVisible()
  await expect(page.getByTestId('wiki-page-ai-attribution-badge')).toHaveCount(0)
})

// #830: 제목이 길어 브레드크럼이 truncate 폭 전체를 채워도, 뷰포트 중앙에 fixed 로 떠 있는
// 전역 AI 어시스턴트 런처(AIChip)와 겹치지 않아야 한다 — Page.Header 좌측 그룹 공통 클램프(useAiChipClamp — 칩 위치 실측) 회귀 검증.
test('노트 헤더 — 긴 제목의 브레드크럼이 전역 AI 어시스턴트 런처와 겹치지 않는다 (#830)', async ({
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

// 페이지 틀(Page) 통합: 경로 nav 첫 크럼과 본문 제목이 같은 16px 축(왼쪽 정렬 reading 폭, 넓은 화면에서도 가운데로 몰리지 않음).
for (const width of DESKTOP_WIDTHS) {
  test(`노트 헤더 — 경로 첫 크럼과 본문 제목이 같은 x, 본문 폭 ≤ 768 @${width}px`, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await setupRoutes(page)

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/2`)
    const header = page.getByTestId('wiki-page-header')
    await expectHeaderBottomAt56(header)
    // 첫 크럼(조상 버튼) ↔ 본문 제목 입력. page-body-content 자신은 여백 포함이라 내용 요소로 비교한다.
    await expectStartAligned(
      header.getByRole('navigation', { name: '페이지 경로' }).getByRole('button', { name: '제품 문서' }),
      page.getByPlaceholder('제목 없음'),
    )
    expect((await boxOf(page.getByTestId('page-body-content'))).width).toBeLessThanOrEqual(768)
  })
}

// WP-304: 1024px 부근에선 nav 클램프(#830)로 폭이 ~150px 로 좁아지는데, 모든 경로 항목이 같은 비율로
// 줄어 현재 페이지 제목까지 0 폭이 되던 회귀 — 현재 제목은 최소 폭을 지키고 조상부터 줄어야 한다.
for (const width of [1024, 1100, 1280]) {
  test(`노트 헤더 — ${width}px 에서 긴 경로라도 현재 페이지 제목이 보인다 (WP-304)`, async ({
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
      // 현재 제목은 최소 폭(min-w-14, 줄임표 포함 몇 글자)을 지킨다 — 0 폭이면 아무것도 안 보인다.
      expect(box.width).toBeGreaterThanOrEqual(56)
      // 경로가 nav 밖(우측 액션 그룹·AI 런처 쪽)으로 넘치지 않는다.
      expect(await rowOverflow(nav)).toBeLessThanOrEqual(1)
      // 줄임표 truncate 가 실제로 걸려 있어야 한다(잘린 제목이 …로 끝남).
      const style = await current.evaluate((el) => {
        const cs = getComputedStyle(el)
        return { textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace }
      })
      expect(style).toEqual({ textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
      // 앞 항목이 먼저 줄어든다 — 보이는 조상은 어느 것도 현재 제목보다 넓지 않다.
      for (const anc of await nav.getByTestId('wiki-breadcrumb-ancestor').all()) {
        if (!(await anc.isVisible())) continue
        expect((await measureBox(anc, 'ancestor')).width).toBeLessThanOrEqual(box.width)
      }
    }).toPass()

    // 좁은 폭(1024·1100)에선 조상을 "…" 메뉴로 접는다 — 숨긴 조상으로도 이동할 수 있어야 한다.
    if (width < 1280) {
      await expect(nav.getByTestId('wiki-breadcrumb-ancestor')).toHaveCount(2)
      await expect(nav.getByRole('button', { name: tree[1].title })).toBeHidden()
      await nav.getByTestId('wiki-breadcrumb-ellipsis').click()
      await page.getByRole('menuitem', { name: tree[0].title }).click()
      await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${SPACE_ID}/pages/1$`))
    } else {
      // 1280 은 중간 단계 — 바로 위 부모는 보이고 그 위 조상만 "…" 메뉴로.
      await expect(nav.getByRole('button', { name: tree[1].title })).toBeVisible()
      await expect(nav.getByRole('button', { name: tree[0].title })).toBeHidden()
      await expect(nav.getByTestId('wiki-breadcrumb-ellipsis')).toBeVisible()
    }
  })
}

// WP-304 리뷰: 넓은 단계(≥26rem)에서 조상을 전부 펼치면 깊은 경로가 클램프를 넘어 AI 런처와 겹쳤다 —
// 가까운 조상 3개까지만 펼치고 나머지는 "…" 메뉴(경로 순서)로 접는다.
test('노트 헤더 — 1600px·8단 깊은 경로도 nav 를 넘치지 않고 런처와 겹치지 않는다 (WP-304)', async ({
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

  // 가까운 조상 3개(5·6·7단)만 보이고, 1~4단은 접힌다.
  for (const t of tree.slice(4, 7)) await expect(nav.getByRole('button', { name: t.title })).toBeVisible()
  for (const t of tree.slice(0, 4)) await expect(nav.getByRole('button', { name: t.title })).toBeHidden()
  // "…" 메뉴는 조상 전체를 경로 순서대로 나열한다.
  await nav.getByTestId('wiki-breadcrumb-ellipsis').click()
  await expect(page.getByRole('menuitem')).toHaveText(tree.slice(0, 7).map((t) => t.title))
})
