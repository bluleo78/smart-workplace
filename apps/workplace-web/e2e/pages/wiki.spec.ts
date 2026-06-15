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
  await page.getByRole('button', { name: '새 페이지' }).click()
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
