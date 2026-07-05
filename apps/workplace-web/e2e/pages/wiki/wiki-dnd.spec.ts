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
    { id: 10, parentId: null, title: 'A', position: 0 },
    { id: 11, parentId: null, title: 'B', position: 1 },
    { id: 12, parentId: null, title: 'C', position: 2 },
  ]
}

// 두 점 사이를 dnd-kit PointerSensor(distance:5)가 활성화되도록 단계적으로 드래그한다.
async function dragRowTo(
  page: import('@playwright/test').Page,
  sourceName: string,
  targetName: string,
) {
  const source = page.getByRole('button', { name: sourceName, exact: true })
  const target = page.getByRole('button', { name: targetName, exact: true })
  await source.hover()
  await page.mouse.down()
  await page.mouse.move(0, 0)
  const box = await target.boundingBox()
  if (!box) throw new Error(`${targetName} bounding box 없음`)
  // 대상 행 상단 근처(약간 위)로 이동 — A 위에 드롭되도록.
  await page.mouse.move(box.x + box.width / 2, box.y + 2, { steps: 12 })
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
