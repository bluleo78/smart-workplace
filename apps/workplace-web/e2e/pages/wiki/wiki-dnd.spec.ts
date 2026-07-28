// 위키 사이드바 드래그앤드롭 재정렬/재부모 E2E — 백엔드 없이 page.route 모킹.
// 컨트랙트: PATCH /wiki/pages/{id}/move { parentId, position }. 백엔드가 형제 position 을
// 재시퀀스하므로 프론트는 목표 0-based index 만 전송한다. board.spec 의 dnd-kit 드래그
// 시뮬레이션(hover → down → move(0,0) → move(target, steps) → up)을 그대로 미러링한다.
import type { WikiPageSummary, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1

// 개인 위키 스페이스 1개 — WikiSidebar 가 마운트 시 페치한다.
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

// 루트 페이지 3개 A(10,0) · B(11,1) · C(12,2).
function rootPages(): WikiPageSummary[] {
  return [
    { id: 10, parentId: null, title: 'A', position: 0, aiLastUsedAt: null },
    { id: 11, parentId: null, title: 'B', position: 1, aiLastUsedAt: null },
    { id: 12, parentId: null, title: 'C', position: 2, aiLastUsedAt: null },
  ]
}

// 두 점 사이를 dnd-kit PointerSensor(distance:5)가 활성화되도록 단계적으로 드래그한다.
// dx 는 가로 오프셋(px) — getProjection 이 이 값을 INDENT(16) 로 나눠 depth 변화를 계산하므로,
// 들여쓰기(자식으로 만들기) 드롭을 재현하려면 반드시 넣어야 한다.
async function dragRowTo(
  page: import('@playwright/test').Page,
  sourceName: string,
  targetName: string,
  dx = 0,
) {
  const source = page.getByRole('button', { name: sourceName, exact: true })
  const target = page.getByRole('button', { name: targetName, exact: true })
  // 좌표는 드래그 시작 "전" 에 잡는다 — #760 이후 드래그 중에는 active 의 후손 행이 언마운트되므로
  // 드롭 목표가 후손이면 드래그 도중에는 boundingBox 를 얻을 수 없다(그 자리로 놓는 제스처 자체는 유효).
  const sourceBox = await source.boundingBox()
  if (!sourceBox) throw new Error(`${sourceName} bounding box 없음`)
  const box = await target.boundingBox()
  if (!box) throw new Error(`${targetName} bounding box 없음`)
  await source.hover()
  await page.mouse.down()
  await page.mouse.move(0, 0)
  // 가로는 시작점(source 중앙) 기준으로 dx 만큼만 이동한다 — delta.x 가 정확히 dx 가 되어야
  // 들여쓰기 깊이가 예측 가능하다(대상 행 중앙 기준으로 잡으면 행마다 다른 들여쓰기가 섞인다).
  // 세로는 대상 행 상단 근처(약간 위)로 — 그 행 위치에 드롭되도록.
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + dx, box.y + 2, { steps: 12 })
  await page.mouse.up()
}

test(
  '위키 사이드바 — C 를 A 위로 드래그 → PATCH move {parentId:null, position:0}',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
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

    // 트리 — 루트 3개(정적).
    await page.route(
      (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(rootPages()),
            })
          : route.fallback(),
    )

    // move PATCH — 204(빈 본문), payload 캡처.
    let movePayload: unknown = null
    await page.route(
      (url) => url.pathname === '/api/v1/wiki/pages/12/move',
      (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback()
        movePayload = route.request().postDataJSON()
        return route.fulfill({ status: 204, body: '' })
      },
    )

    // 스페이스 진입 → 3개 행 노출.
    await page.goto(`/wiki/spaces/${SPACE_ID}`)
    await expect(page.getByRole('button', { name: 'A', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'B', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'C', exact: true })).toBeVisible()

    // C 를 A 위로 드래그.
    await dragRowTo(page, 'C', 'A')

    // 컨트랙트 검증 — 루트 최상단으로 이동(parentId null, position 0).
    await expect.poll(() => movePayload).toEqual({ parentId: null, position: 0 })
  },
)

// #760 드래그 중인 노드의 후손은 드롭 대상에서 제외돼야 한다 — 부모를 자기 자식 아래로 끌어
// 들여쓰기하면 서버가 400 으로 거부할 이동이 나간다. 단언은 "PATCH 가 안 나간다" 가 아니라
// "후손을 parentId 로 하는 PATCH 가 없다" — 후손이 배열에서 빠지면 투영은 no-op 이 아니라
// 남아 있는 이웃 기준의 합법 이동으로 바뀌기 때문이다.
test('위키 사이드바 — 부모를 자기 자식 아래로 드롭해도 후손을 parentId 로 보내지 않는다', async ({
  authenticatedPage: page,
}) => {
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

  // A(10) — 자식 A1(20), 그리고 형제 B(11). A 를 A1 자리로 끌어 들여쓰기하는 것이 재현 조건.
  const tree: WikiPageSummary[] = [
    { id: 10, parentId: null, title: 'A', position: 0, aiLastUsedAt: null },
    { id: 20, parentId: 10, title: 'A1', position: 0, aiLastUsedAt: null },
    { id: 11, parentId: null, title: 'B', position: 1, aiLastUsedAt: null },
  ]
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(tree),
          })
        : route.fallback(),
  )

  // 어떤 페이지의 move 든 전부 캡처 — "후손이 parentId 로 나갔는가" 를 봐야 하므로 경로를 넓게 잡는다.
  const moves: { pageId: number; parentId: number | null; position: number }[] = []
  await page.route(
    (url) => /\/api\/v1\/wiki\/pages\/\d+\/move$/.test(url.pathname),
    (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      const pageId = Number(route.request().url().match(/pages\/(\d+)\/move/)![1])
      const { parentId, position } = route.request().postDataJSON()
      moves.push({ pageId, parentId, position })
      return route.fulfill({ status: 204, body: '' })
    },
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  await expect(page.getByRole('button', { name: 'A', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'A1', exact: true })).toBeVisible()

  // A 를 자식 A1 자리로 + 오른쪽으로 24px(INDENT 16 초과) → 가드가 없으면 parentId=20 이 나간다.
  await dragRowTo(page, 'A', 'A1', 24)

  // 드래그가 실제로 동작했음을 먼저 고정한다 — PATCH 가 0건이면 아래 단언이 공허하게 통과한다.
  await expect.poll(() => moves.length).toBeGreaterThan(0)
  expect(moves.filter((m) => m.pageId === 10 && m.parentId === 20)).toEqual([])
  // 후손을 뺀 뒤 남은 이웃(B) 기준의 합법 이동으로 바뀐다 — position 도 같은 배열로 계산되는지 함께 고정.
  // 후손이 있는 트리에서 position 을 단언하는 건 이 테스트뿐이다(@smoke 는 루트 3개 평면 트리).
  expect(moves).toEqual([{ pageId: 10, parentId: 11, position: 0 }])
})

// #758 서버가 트리를 깨는 이동(자기 자신/후손을 부모로)을 400 으로 거부한다. 사이드바 DnD 는 드래그 중인
// 노드의 후손을 드롭 대상에서 제외하지 않으므로 사용자가 실제로 그 드롭을 할 수 있다 — onError 가 없으면
// 트리가 조용히 제자리로 돌아가 "드래그가 먹히지 않는다" 로만 보인다. 서버 메시지가 토스트로 뜨는지 고정.
test('위키 사이드바 — move 400 이면 서버 메시지를 토스트로 보여준다', async ({
  authenticatedPage: page,
}) => {
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

  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(rootPages()),
          })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === '/api/v1/wiki/pages/12/move',
    (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 400,
          message: '자기 자신이나 자기 하위 페이지를 부모로 지정할 수 없습니다: page=12',
        }),
      })
    },
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  await expect(page.getByRole('button', { name: 'A', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'C', exact: true })).toBeVisible()

  await dragRowTo(page, 'C', 'A')

  // 폴백 문구가 아니라 서버가 준 사유가 그대로 보여야 한다 — 왜 막혔는지 사용자가 알 수 있어야 한다.
  await expect(
    page.getByText('자기 자신이나 자기 하위 페이지를 부모로 지정할 수 없습니다: page=12'),
  ).toBeVisible()
})
