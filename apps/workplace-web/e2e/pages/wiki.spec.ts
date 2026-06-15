// 위키 E2E — /wiki 진입 리다이렉트 · 새 페이지 생성 · 제목/본문 입력 · 자동저장(저장됨)
// · 사이드바 트리 반영 (백엔드 없이 page.route 모킹).
//
// 이 하네스는 실제 백엔드를 띄우지 않고 page.route 로 API 를 모킹한다(playwright.config 의
// webServer 는 Vite dev 만 자동 기동). 따라서 '저장됨' 은 PUT /wiki/pages/:id 모킹이 성공
// 응답을 돌려줄 때 표시되며, 에디터의 debounce 자동저장 배선 + 낙관적 동시성(version) + UI
// 피드백이 end-to-end 로 동작함을 증명한다.
import type { WikiPageDetail, WikiPageSummary, WikiSpace } from '../../src/types/wiki'
import { expect, test } from '../fixtures/auth.fixture'

const SPACE_ID = 1
const NEW_PAGE_ID = 100
const NEW_TITLE = 'E2E 위키 페이지'

// 개인 위키 스페이스 1개 — WikiIndexRedirect/WikiSidebar 가 마운트 시 페치한다.
function personalSpace(): WikiSpace {
  return {
    id: SPACE_ID,
    type: 'PERSONAL',
    name: '내 위키',
    ownerId: 1,
    role: 'OWNER',
    createdAt: '2026-06-01T00:00:00Z',
  }
}

// 새로 만든 페이지의 상세(GET /wiki/pages/:id) — 저장 시 title/version 갱신.
function pageDetail(title: string, version: number): WikiPageDetail {
  return {
    id: NEW_PAGE_ID,
    spaceId: SPACE_ID,
    parentId: null,
    title,
    body: '',
    version,
    updatedBy: 1,
    updatedAt: '2026-06-01T00:00:00Z',
  }
}

// 빈 상태 — 페이지 미선택 시 DS §2.5 4요소(아이콘+제목+설명+CTA) 표시 + CTA로 페이지 생성 (refs #245)
test('위키 — 빈 상태: 4요소 표시 + CTA로 새 페이지 생성 후 이동', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  const EMPTY_PAGE_ID = 50

  // 스페이스 목록
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([personalSpace()]),
          })
        : route.fallback(),
  )

  // 트리 — 초기 빈 목록, POST 후 새 페이지 1건 반환
  const treeState = { created: false }
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            treeState.created
              ? [{ id: EMPTY_PAGE_ID, parentId: null, title: '제목 없음', position: 0 } as WikiPageSummary]
              : [],
          ),
        })
      }
      if (method === 'POST') {
        treeState.created = true
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: EMPTY_PAGE_ID,
            spaceId: SPACE_ID,
            parentId: null,
            title: '제목 없음',
            body: '',
            version: 1,
            updatedBy: 1,
            updatedAt: '2026-06-16T00:00:00Z',
          } as WikiPageDetail),
        })
      }
      return route.fallback()
    },
  )

  // 페이지 상세 — CTA 클릭 후 이동 시 에디터 마운트용
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${EMPTY_PAGE_ID}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: EMPTY_PAGE_ID,
              spaceId: SPACE_ID,
              parentId: null,
              title: '제목 없음',
              body: '',
              version: 1,
              updatedBy: 1,
              updatedAt: '2026-06-16T00:00:00Z',
            } as WikiPageDetail),
          })
        : route.fallback(),
  )

  // 1) 스페이스 진입(페이지 미선택) → 빈 상태 4요소 확인
  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  const emptyState = page.getByTestId('wiki-empty-state')
  await expect(emptyState).toBeVisible()
  // 아이콘(svg), 제목, 설명, CTA 버튼 4요소 모두 존재
  await expect(emptyState.locator('svg')).toBeVisible()
  await expect(emptyState.getByText('표시할 페이지가 없습니다')).toBeVisible()
  await expect(emptyState.getByText('페이지를 선택하거나 새 페이지를 만드세요')).toBeVisible()
  const ctaButton = emptyState.getByRole('button', { name: '새 페이지 만들기' })
  await expect(ctaButton).toBeVisible()

  // 2) CTA 클릭 → POST /wiki/spaces/:id/pages 호출 → 새 페이지 URL로 이동
  await ctaButton.click()
  await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${SPACE_ID}/pages/${EMPTY_PAGE_ID}`), { timeout: 5000 })
})

test('위키 — 진입 리다이렉트·새 페이지 생성·제목/본문 입력·자동저장·트리 반영', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  // 가변 상태: 페이지 생성 여부 + 현재(마지막 저장된) 제목 + version.
  // 트리(GET pages)는 이 상태에서 동적으로 응답을 만들어 생성/저장을 반영한다.
  const state = { created: false, title: '제목 없음', version: 1 }
  let putTitle: string | null = null // PUT body.title 캡처 — 자동저장 라운드트립 검증용

  // 스페이스 목록
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([personalSpace()]),
          })
        : route.fallback(),
  )

  // /wiki/spaces/:id/pages — GET(트리, 동적) + POST(생성) 둘 다 같은 경로.
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        // 생성 전엔 빈 트리, 생성 후엔 현재 제목을 반영한 요약 1건.
        const pages: WikiPageSummary[] = state.created
          ? [{ id: NEW_PAGE_ID, parentId: null, title: state.title, position: 0 }]
          : []
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(pages),
        })
      }
      if (method === 'POST') {
        state.created = true
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(pageDetail('제목 없음', 1)),
        })
      }
      return route.fallback()
    },
  )

  // 페이지 상세 — 생성 직후 진입 시 GET.
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${NEW_PAGE_ID}`,
    (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(pageDetail(state.title, state.version)),
        })
      }
      if (method === 'PUT') {
        // 자동저장 — body.title 캡처 후 상태 갱신, version+1 로 응답(409 없음).
        const body = route.request().postDataJSON() as { title: string; body: string; version: number }
        putTitle = body.title
        state.title = body.title
        state.version += 1
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(pageDetail(state.title, state.version)),
        })
      }
      return route.fallback()
    },
  )

  // 1) /wiki 진입 → 첫 스페이스로 리다이렉트.
  await page.goto('/wiki')
  await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${SPACE_ID}$`))

  // 2) 새 페이지 버튼 → 생성 후 해당 페이지로 이동(/pages/<number>).
  // exact:true — 빈 상태의 "새 페이지 만들기" 버튼이 substring 일치로 함께 잡히지 않도록.
  await page.getByRole('button', { name: '새 페이지', exact: true }).click()
  await expect(page).toHaveURL(/\/wiki\/spaces\/\d+\/pages\/\d+/)

  // 3) 제목 입력.
  await page.getByPlaceholder('제목 없음').fill(NEW_TITLE)

  // 4) 본문 입력 — .ProseMirror 클릭 후 타이핑(에디터 update → debounce 자동저장 트리거).
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('자동저장 본문 내용')

  // 5) 자동저장 완료 → '저장됨' 노출(debounce 800ms + PUT 라운드트립).
  await expect(page.getByText('저장됨')).toBeVisible({ timeout: 5000 })

  // PUT payload 에 입력한 제목이 그대로 전송됐는지 검증(라운드트립 증명).
  expect(putTitle).toBe(NEW_TITLE)

  // 6) 사이드바 트리에 새 제목이 반영된 버튼이 나타난다(저장 후 트리 invalidate→refetch).
  // exact:true — 삭제 버튼(aria-label "삭제: <제목>")이 부분일치로 함께 잡히는 것을 방지.
  await expect(page.getByRole('button', { name: NEW_TITLE, exact: true })).toBeVisible({
    timeout: 5000,
  })
})

// 에러 경로 테스트(409) — 4xx 이므로 @smoke 아님(workplace-web/CLAUDE.md smoke 분류).
test('위키 — 낙관적 동시성 충돌(409): 배너 노출 + 자동저장 중단', async ({
  authenticatedPage: page,
}) => {
  const CONFLICT_ID = 100

  // 스페이스 목록 — 개인 스페이스 1개.
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([personalSpace()]),
          })
        : route.fallback(),
  )

  // 트리 — 충돌 페이지 1건을 이미 포함(생성 없이 바로 진입 가능).
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              { id: CONFLICT_ID, parentId: null, title: '충돌 페이지', position: 0 } as WikiPageSummary,
            ]),
          })
        : route.fallback(),
  )

  // PUT 카운터 — 자동저장이 충돌 후 멈췄는지(재시도 안 함) 검증용.
  let putCount = 0

  // 페이지 상세 — GET 은 정상, PUT 은 항상 409 로 충돌을 발생시킨다.
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${CONFLICT_ID}`,
    (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: CONFLICT_ID,
            spaceId: SPACE_ID,
            parentId: null,
            title: '충돌 페이지',
            body: '',
            version: 1,
            updatedBy: 1,
            updatedAt: '2026-06-01T00:00:00Z',
          } as WikiPageDetail),
        })
      }
      if (method === 'PUT') {
        putCount += 1
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ message: '다른 사용자가 먼저 수정했습니다: page=100' }),
        })
      }
      return route.fallback()
    },
  )

  // 1) 충돌 페이지로 바로 진입.
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${CONFLICT_ID}`)

  // 2) 본문 입력 → debounce 자동저장 → PUT → 409.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('충돌을 유발하는 입력')

  // 3) 충돌 배너 노출.
  await expect(
    page.getByText('다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.'),
  ).toBeVisible({ timeout: 5000 })

  // 4) 자동저장 중단 검증 — 배너 노출 시점의 PUT 수를 기록하고,
  //    추가 입력 후 debounce(800ms)보다 길게 대기해도 PUT 이 늘지 않아야 한다.
  const putAfterConflict = putCount
  expect(putAfterConflict).toBeGreaterThan(0)
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('충돌 후 추가 입력')
  await page.waitForTimeout(1500)
  expect(putCount).toBe(putAfterConflict)
})

// 삭제 UI — 사이드바 트리 노드 삭제 → 트리에서 사라짐(에러 경로 아님, 단순 동작 → 미태그).
test('위키 — 사이드바 페이지 삭제: 노드가 트리에서 사라진다', async ({
  authenticatedPage: page,
}) => {
  const DELETE_ID = 200

  // 스페이스 목록.
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([personalSpace()]),
          })
        : route.fallback(),
  )

  // 가변 상태 — DELETE 가 도착하면 트리를 빈 목록으로 전환.
  const treeState = { deleted: false }

  // 트리 — 삭제 전엔 '삭제 대상' 1건, 삭제 후엔 빈 트리.
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
              treeState.deleted
                ? []
                : [{ id: DELETE_ID, parentId: null, title: '삭제 대상', position: 0 } as WikiPageSummary],
            ),
          })
        : route.fallback(),
  )

  // 페이지 상세 — GET(진입 시) + DELETE(204, 빈 본문).
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${DELETE_ID}`,
    (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: DELETE_ID,
            spaceId: SPACE_ID,
            parentId: null,
            title: '삭제 대상',
            body: '',
            version: 1,
            updatedBy: 1,
            updatedAt: '2026-06-01T00:00:00Z',
          } as WikiPageDetail),
        })
      }
      if (method === 'DELETE') {
        treeState.deleted = true
        return route.fulfill({ status: 204, body: '' })
      }
      return route.fallback()
    },
  )

  // 1) 스페이스로 진입 → '삭제 대상' 노드 노출 확인.
  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  const targetRow = page.getByTestId(`wiki-tree-row-${DELETE_ID}`)
  await expect(targetRow.getByRole('button', { name: '삭제 대상', exact: true })).toBeVisible()

  // 2) 행 hover → ⋯ 메뉴 → 삭제 → 확인 다이얼로그에서 삭제.
  await targetRow.hover()
  await targetRow.getByRole('button', { name: '페이지 메뉴' }).click()
  await page.getByRole('menuitem', { name: '삭제' }).click()
  await page.getByTestId('wiki-delete-dialog').getByRole('button', { name: '삭제', exact: true }).click()

  // 3) 삭제 후 트리 refetch → '삭제 대상' 버튼이 사라진다.
  await expect(page.getByRole('button', { name: '삭제 대상', exact: true })).toHaveCount(0)
})

// skeleton 로딩 — GET /wiki/pages/:id 응답을 지연시켜 skeleton이 노출됐다가 에디터로 전환됨 검증.
// (issue #246: 텍스트 "불러오는 중…" 대신 skeleton 컴포넌트를 표시해야 한다)
test('위키 — 페이지 로딩 중 skeleton이 표시되고 로드 후 에디터로 전환된다', async ({
  authenticatedPage: page,
}) => {
  const SLOW_PAGE_ID = 300

  // 스페이스 목록
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([personalSpace()]),
          })
        : route.fallback(),
  )

  // 트리 — SLOW_PAGE_ID 1건 포함
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              { id: SLOW_PAGE_ID, parentId: null, title: '느린 페이지', position: 0 } as WikiPageSummary,
            ]),
          })
        : route.fallback(),
  )

  // 페이지 상세 — 응답을 1.5초 지연시켜 skeleton 노출 시간 확보.
  let resolveSlowRoute!: () => void
  const slowRouteReady = new Promise<void>((res) => { resolveSlowRoute = res })
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${SLOW_PAGE_ID}`,
    async (route) => {
      if (route.request().method() === 'GET') {
        await slowRouteReady
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: SLOW_PAGE_ID,
            spaceId: SPACE_ID,
            parentId: null,
            title: '느린 페이지',
            body: '',
            version: 1,
            updatedBy: 1,
            updatedAt: '2026-06-01T00:00:00Z',
          } as WikiPageDetail),
        })
      }
      return route.fallback()
    },
  )

  // 1) 페이지 진입 — API 응답이 지연되므로 skeleton이 보여야 한다.
  void page.goto(`/wiki/spaces/${SPACE_ID}/pages/${SLOW_PAGE_ID}`)
  await expect(page.getByTestId('wiki-page-skeleton')).toBeVisible({ timeout: 3000 })

  // "불러오는 중…" 텍스트는 없어야 한다 (회귀 방지).
  await expect(page.getByText('불러오는 중…')).toHaveCount(0)

  // 2) API 응답 해제 → skeleton 사라지고 에디터(.ProseMirror) 등장.
  resolveSlowRoute()
  await expect(page.getByTestId('wiki-page-skeleton')).toHaveCount(0, { timeout: 5000 })
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
})

// 회귀: WikiSidebar 스페이스 선택기 — native <select> → shadcn/ui Select (refs #244)
// native <select>가 쓰이면 role="combobox"가 없고 대신 role 없는 select 요소가 DOM에 존재.
// shadcn Select가 정상 렌더링되면 SelectTrigger의 role="combobox"가 보여야 한다.
test('위키 사이드바 — 스페이스 선택기가 shadcn Select로 렌더링되고 값 전환이 동작한다', async ({
  authenticatedPage: page,
}) => {
  const SPACE_A_ID = 1
  const SPACE_B_ID = 2

  const spaces: WikiSpace[] = [
    { id: SPACE_A_ID, type: 'PERSONAL', name: '내 노트', ownerId: 1, role: 'OWNER', createdAt: '2026-01-01T00:00:00Z' },
    { id: SPACE_B_ID, type: 'PERSONAL', name: '두 번째 스페이스', ownerId: 1, role: 'OWNER', createdAt: '2026-01-01T00:00:00Z' },
  ]

  // 스페이스 목록 모킹
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(spaces) })
        : route.fallback(),
  )

  // 트리 빈 응답 (페이지 없음)
  await page.route(
    (url) => /^\/api\/v1\/wiki\/spaces\/\d+\/pages$/.test(url.pathname),
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        : route.fallback(),
  )

  await page.goto(`/wiki/spaces/${SPACE_A_ID}`)

  // 1) native <select>가 없어야 한다 — shadcn SelectTrigger(role="combobox")로 대체됨
  await expect(page.locator('select')).toHaveCount(0)

  // 2) shadcn SelectTrigger(role="combobox")가 보여야 한다
  const trigger = page.getByRole('combobox')
  await expect(trigger).toBeVisible()
  await expect(trigger).toContainText('내 노트')

  // 3) 다른 스페이스 선택 → URL이 해당 스페이스로 바뀜
  await trigger.click()
  await page.getByRole('option', { name: '두 번째 스페이스' }).click()
  await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${SPACE_B_ID}`), { timeout: 3000 })
})
