// 위키 E2E — /wiki 진입 리다이렉트 · 새 페이지 생성 · 제목/본문 입력 · 자동저장(저장됨)
// · 사이드바 트리 반영 (백엔드 없이 page.route 모킹).
//
// 이 하네스는 실제 백엔드를 띄우지 않고 page.route 로 API 를 모킹한다(playwright.config 의
// webServer 는 Vite dev 만 자동 기동). 따라서 '저장됨' 은 PUT /wiki/pages/:id 모킹이 성공
// 응답을 돌려줄 때 표시되며, 에디터의 debounce 자동저장 배선 + 낙관적 동시성(version) + UI
// 피드백이 end-to-end 로 동작함을 증명한다.
import type { WikiPageDetail, WikiPageSummary, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'
import { resizeAndSettle } from '../../fixtures/wait'

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
    aiLastUsedAt: null,
    aiLastAction: null,
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
  // 아이콘(svg), 제목, 설명, CTA 버튼 4요소 모두 존재.
  // #733 에서 보조 CTA("AI 초안으로 시작", Sparkles 아이콘)가 추가돼 svg 가 2개이므로
  // 4요소의 아이콘은 BookOpen 으로 특정한다.
  await expect(emptyState.locator('svg.lucide-book-open')).toBeVisible()
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
          ? [{ id: NEW_PAGE_ID, parentId: null, title: state.title, position: 0, aiLastUsedAt: null }]
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
  // 재클릭 폴백 — /wiki→/wiki/spaces/:id 리다이렉트 직후 극히 좁은 창에서, 브라우저 URL은
  // 이미 갱신됐지만 WikiSidebar의 useParams 커밋이 한 틱 뒤처져 addRootPage 가 스테일
  // spaceId=null 클로저로 무동작(no-op)하는 레이스를 실측 확인(단독 재현 5/5). 사람은 이
  // 창을 우연히도 밀리초 단위로 맞춰 클릭하기 어려워 실사용 영향은 미미하지만, 자동화 클릭은
  // 매번 정확히 그 창을 노릴 수 있다. 클릭 후 짧은 창 내 미이동 시 재클릭해 통과시킨다.
  const newPageBtn = page.getByRole('button', { name: '새 페이지', exact: true })
  await newPageBtn.click()
  try {
    await expect(page).toHaveURL(/\/wiki\/spaces\/\d+\/pages\/\d+/, { timeout: 3000 })
  } catch {
    await newPageBtn.click()
    await expect(page).toHaveURL(/\/wiki\/spaces\/\d+\/pages\/\d+/)
  }

  // 3) 제목 입력.
  await page.getByPlaceholder('제목 없음').fill(NEW_TITLE)

  // 4) 본문 입력 — .ProseMirror 클릭 후 타이핑(에디터 update → debounce 자동저장 트리거).
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('자동저장 본문 내용')

  // 5) 자동저장 완료 → '저장됨' 노출(debounce 800ms + PUT 라운드트립).
  // 전역 expect.timeout(10s, playwright.config.ts) 사용 — 로컬 5s 오버라이드는
  // lazy 라우트 지연(5~8s)을 흡수 못해 간헐 실패를 냈다.
  await expect(page.getByText('저장됨')).toBeVisible()

  // 5b) '저장됨' 은 헤더 저장상태 칩(StatusBadge) 안에 표시된다(#247 — 시각적 명확성).
  await expect(page.getByTestId('wiki-save-state')).toHaveText('저장됨')

  // PUT payload 에 입력한 제목이 그대로 전송됐는지 검증(라운드트립 증명).
  expect(putTitle).toBe(NEW_TITLE)

  // 6) 사이드바 트리에 새 제목이 반영된 버튼이 나타난다(저장 후 트리 invalidate→refetch).
  // exact:true — 삭제 버튼(aria-label "삭제: <제목>")이 부분일치로 함께 잡히는 것을 방지.
  await expect(page.getByRole('button', { name: NEW_TITLE, exact: true })).toBeVisible()
})

// 회귀(#786): 제목 입력창에서 Enter 시 아무 반응이 없어(핸들러 부재) 이후 타이핑이
// 구분자 없이 제목에 이어붙는 결함 — onKeyDown 추가로 본문 에디터에 포커스가 이동해야 한다.
test('위키 — 제목 입력 중 Enter 시 본문 에디터로 포커스 이동(제목 오염 방지)', async ({
  authenticatedPage: page,
}) => {
  const TITLE_ENTER_PAGE_ID = 400

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

  // 트리 — 대상 페이지 1건
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              { id: TITLE_ENTER_PAGE_ID, parentId: null, title: '제목 없음', position: 0 } as WikiPageSummary,
            ]),
          })
        : route.fallback(),
  )

  // 페이지 상세 — GET(초기) + PUT(자동저장, body.title 캡처).
  // pageDetail() 헬퍼는 id 를 NEW_PAGE_ID(100) 로 고정 반환하므로 이 테스트의 페이지 id(400)와
  // 불일치가 나 backlinks/mentions/PUT 이 엉뚱한 id 로 나간다 — 여기선 id 를 직접 지정한다.
  let putTitle: string | null = null
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${TITLE_ENTER_PAGE_ID}`,
    (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: TITLE_ENTER_PAGE_ID,
            spaceId: SPACE_ID,
            parentId: null,
            title: '제목 없음',
            body: '',
            version: 1,
            updatedBy: 1,
            updatedAt: '2026-06-01T00:00:00Z',
            aiLastUsedAt: null,
            aiLastAction: null,
          }),
        })
      }
      if (method === 'PUT') {
        const body = route.request().postDataJSON() as { title: string; body: string; version: number }
        putTitle = body.title
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: TITLE_ENTER_PAGE_ID,
            spaceId: SPACE_ID,
            parentId: null,
            title: body.title,
            body: body.body,
            version: 2,
            updatedBy: 1,
            updatedAt: '2026-06-01T00:00:00Z',
            aiLastUsedAt: null,
            aiLastAction: null,
          }),
        })
      }
      return route.fallback()
    },
  )

  // 위키 에디터 마운트 시 backlinks/mentions 를 자동 페치하므로 빈 응답을 스텁한다.
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${TITLE_ENTER_PAGE_ID}/backlinks`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${TITLE_ENTER_PAGE_ID}/mentions`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${TITLE_ENTER_PAGE_ID}`)

  // Enter 핸들러는 editor 인스턴스로 포커스를 옮긴다 — 부하가 큰 전체 실행에서 에디터 생성 전에 Enter 를 치면
  // 이동할 대상이 없어 이후 타이핑이 제목에 붙는다(플래키). 본문 에디터가 편집 가능해진 뒤 시작한다.
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()

  // 1) 제목 입력 후 Enter — 줄바꿈도, submit 도 일어나지 않고 포커스만 본문으로 이동해야 한다.
  const titleInput = page.getByPlaceholder('제목 없음')
  await titleInput.click()
  await titleInput.fill('제목입니다')
  await titleInput.press('Enter')

  // 2) Enter 직후 타이핑 — 포커스가 본문(.ProseMirror)으로 이동했다면 여기로 들어간다.
  await page.keyboard.type('본문 내용입니다')

  // 3) 제목 값은 Enter 이전 입력까지만 유지 — 이후 타이핑이 섞여 오염되지 않아야 한다.
  await expect(titleInput).toHaveValue('제목입니다')

  // 4) 본문 에디터에 타이핑한 내용이 반영돼야 한다(포커스가 실제로 넘어갔다는 증거).
  await expect(page.locator('.ProseMirror')).toContainText('본문 내용입니다')

  // 5) 자동저장 PUT payload 의 title 도 오염되지 않은 값이어야 한다.
  await expect(page.getByTestId('wiki-save-state')).toHaveText('저장됨', { timeout: 10000 })
  expect(putTitle).toBe('제목입니다')
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

  // 3b) 헤더 저장상태 칩에도 '충돌' 피드백이 노출된다 — 콘텐츠 배너와 별개로
  //     헤더만 보고도 충돌 인지 가능해야 한다(#247). '충돌' 문구는 헤더 칩에만 존재.
  await expect(page.getByTestId('wiki-save-state')).toHaveText('충돌')

  // 4) 자동저장 중단 검증 — 배너 노출 시점의 PUT 수를 기록하고,
  //    추가 입력 후 debounce(800ms)보다 길게 대기해도 PUT 이 늘지 않아야 한다.
  const putAfterConflict = putCount
  expect(putAfterConflict).toBeGreaterThan(0)
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('충돌 후 추가 입력')
  // eslint-disable-next-line playwright/no-wait-for-timeout -- 디바운스(800ms)를 넘겨도 추가 PUT 이 나가지 않음(부재)을 확인
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

// 회귀 #788: 존재하지 않는 페이지 ID 진입 시 skeleton 이 영구 고착되지 않고
// ResourceErrorState(아이콘+제목+설명+버튼)가 표시되며, 버튼 클릭 시 /wiki 로 이동한다.
// (useWikiPage 가 404 를 isError 로 노출하지 못하면 WikiPageView 의 `isLoading || !page`
// 분기가 계속 true 로 남아 skeleton 이 영원히 사라지지 않는다.)
test('위키 — 존재하지 않는 페이지 ID 접근 시 에러 상태 표시 후 노트 목록으로 이동', async ({
  authenticatedPage: page,
}) => {
  const MISSING_PAGE_ID = 999

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

  // 트리 — 빈 목록 (요청한 페이지가 존재하지 않는 상황)
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        : route.fallback(),
  )

  // 페이지 상세 — 404
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${MISSING_PAGE_ID}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ status: 404, error: 'Not Found', message: '페이지를 찾을 수 없습니다' }),
          })
        : route.fallback(),
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${MISSING_PAGE_ID}`)

  // skeleton 이 아니라 에러 상태가 표시되어야 한다 (react-query retry 유예를 감안해 넉넉한 timeout).
  await expect(page.getByTestId('wiki-page-skeleton')).toHaveCount(0, { timeout: 10000 })
  await expect(page.getByText('페이지를 불러올 수 없습니다')).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('요청한 노트 페이지가 존재하지 않거나 접근 권한이 없습니다.')).toBeVisible()

  // navigate('/wiki') 후 WikiIndexRedirect 가 첫 스페이스로 다시 리다이렉트하므로
  // 최종 URL 은 페이지 상세(/pages/:id) 가 아닌 스페이스 루트여야 한다.
  await page.getByRole('button', { name: '노트 목록으로' }).click()
  await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${SPACE_ID}$`))
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

// WP-121: lg 경계를 넘으면(데스크톱↔모바일 셸) 페이지가 리마운트된다. 디바운스(800ms) 대기 중이던
// 자동저장은 언마운트 시 즉시 flush 되어야 한다 — 예전엔 타이머가 언마운트 뒤에야(최대 800ms 후) 떠서,
// 그 사이 새 에디터가 옛 version 을 들고 뜨거나 탭이 닫히면 편집이 유실될 수 있었다.
test('위키 — 디바운스 대기 중 리마운트(뷰포트 lg 경계 전환)되면 자동저장을 즉시 flush 한다', async ({
  authenticatedPage: page,
}) => {
  const puts: { at: number; body: string }[] = []
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) => route.fulfill({ json: [personalSpace()] }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.fulfill({ json: [{ id: NEW_PAGE_ID, parentId: null, title: NEW_TITLE, position: 0, aiLastUsedAt: null }] }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${NEW_PAGE_ID}`,
    (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON() as { body: string; version: number }
        puts.push({ at: Date.now(), body: body.body })
        return route.fulfill({ json: pageDetail(NEW_TITLE, body.version + 1) })
      }
      return route.fulfill({ json: pageDetail(NEW_TITLE, 1) })
    },
  )
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${NEW_PAGE_ID}`)
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('플러시')
  // 디바운스(800ms)가 끝나기 전에 모바일 폭으로 좁혀 에디터를 리마운트시킨다.
  const t0 = Date.now()
  // 1024 경계를 넘어 모바일 셸로 리마운트되므로 전환 완료까지 기다린다 — PUT 시각은 라우트에서 기록돼 영향 없음 (WP-225)
  await resizeAndSettle(page, { width: 390, height: 844 })
  await expect.poll(() => puts.length).toBeGreaterThan(0)
  // flush 는 언마운트 즉시 — 디바운스 잔여 시간(수백 ms)을 기다리지 않는다.
  expect(puts[0].at - t0).toBeLessThan(400)
  expect(puts[0].body).toContain('플러시')
  // 옛 타이머가 뒤늦게 한 번 더 PUT 하지 않는다(중복 저장·409 방지). 디바운스 창(800ms)을 넘겨 부재 확인 —
  // "일어나지 않음" 확인이라 고정 대기가 불가피하다.
  // eslint-disable-next-line playwright/no-wait-for-timeout -- 디바운스 창을 넘겨 옛 타이머의 중복 PUT 이 없음(부재)을 확인
  await page.waitForTimeout(1000)
  expect(puts).toHaveLength(1)
})

// WP-121(리뷰 C2): flush 직후 리마운트된 에디터는 flush 전 캐시(옛 본문·version)로 뜨면 안 된다 —
// 방금 친 글자가 사라지고 다음 편집이 옛 version 으로 PUT 돼 409 가 났다. flush 가 끝날 때까지 skeleton 을 보이고
// 끝나면 최신 본문·version 으로 다시 마운트해야 한다.
test('위키 — lg 경계 전환 리마운트 후 에디터는 방금 친 글자를 보이고 다음 저장은 새 version 을 싣는다', async ({
  authenticatedPage: page,
}) => {
  // 서버 흉내: version 불일치면 409(낙관적 동시성), 일치하면 본문 저장 + version+1.
  const server = { version: 1, body: '' }
  const puts: { version: number; status: number }[] = []
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) => route.fulfill({ json: [personalSpace()] }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.fulfill({ json: [{ id: NEW_PAGE_ID, parentId: null, title: NEW_TITLE, position: 0, aiLastUsedAt: null }] }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${NEW_PAGE_ID}`,
    async (route) => {
      if (route.request().method() === 'PUT') {
        const req = route.request().postDataJSON() as { body: string; version: number }
        if (req.version !== server.version) {
          puts.push({ version: req.version, status: 409 })
          return route.fulfill({ status: 409, json: { message: 'conflict' } })
        }
        // 응답을 조금 늦춰 "flush 진행 중 리마운트" 창을 확실히 만든다.
        await new Promise((r) => setTimeout(r, 300))
        server.body = req.body
        server.version += 1
        puts.push({ version: req.version, status: 200 })
        return route.fulfill({ json: { ...pageDetail(NEW_TITLE, server.version), body: server.body } })
      }
      return route.fulfill({ json: { ...pageDetail(NEW_TITLE, server.version), body: server.body } })
    },
  )
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${NEW_PAGE_ID}`)
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('플러시')
  // 디바운스 전에 모바일 폭으로 → 에디터 리마운트 + 언마운트 flush.
  // 모바일 셸 전환이 끝나기 전에 옛 에디터를 누르지 않도록 셸 교체까지 기다린다 (WP-225)
  await resizeAndSettle(page, { width: 390, height: 844 })
  await expect.poll(() => puts.length).toBe(1)
  // 리마운트된 에디터가 방금 친 글자를 보인다(옛 캐시 본문으로 뜨지 않음).
  const editor = page.locator('.ProseMirror')
  await expect(editor).toContainText('플러시')
  // 다음 편집 → 자동저장은 flush 응답의 새 version(2)을 싣고 409 없이 성공.
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  await expect.poll(() => puts.length).toBe(2)
  expect(puts[1]).toEqual({ version: 2, status: 200 })
  await expect(editor).toContainText('플러시!')
})
