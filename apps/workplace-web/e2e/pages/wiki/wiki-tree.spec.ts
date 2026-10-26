// 노트 사이드바 트리 — 하위 페이지 생성(parentId payload) + 접기/펼치기 + 삭제 다이얼로그.
// 하위 페이지 생성 payload·400 토스트·선택 표시·접기/펼치기·role=group·삭제 확인·하위 경고·AI 배지는 src/pages/wiki/wikiSidebar.test.tsx 가 지킨다(WP-983).
import type { Page } from '@playwright/test'

import type { WikiPageDetail, WikiPageSummary, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

/** 페이지 생성 POST 본문. */
type CreateBody = { parentId: number | null; title: string }

const SPACE_ID = 1
const space: WikiSpace = {
  id: SPACE_ID,
  type: 'PERSONAL',
  name: '내 노트',
  ownerId: 1,
  role: 'OWNER',
  createdAt: '2026-06-01T00:00:00Z',
}
function detail(id: number, title: string, parentId: number | null): WikiPageDetail {
  return {
    id,
    spaceId: SPACE_ID,
    parentId,
    title,
    body: '',
    version: 1,
    updatedBy: 1,
    updatedAt: '2026-06-01T00:00:00Z',
    aiLastUsedAt: null,
    aiLastAction: null,
  }
}

async function routeCommon(page: Page) {
  await page.route('**/api/v1/wiki/spaces', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([space]) }),
  )
  await page.route('**/api/v1/wiki/pages/*/backlinks', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/v1/wiki/pages/*/mentions', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
}

test('새 페이지 생성 직후 제목 입력 — placeholder 위에 이어붙지 않고 입력값만 저장(#596)', { tag: '@input' }, async ({
  authenticatedPage: page,
}) => {
  await routeCommon(page)
  const creates = trackRequests(page, 'POST', `/api/v1/wiki/spaces/${SPACE_ID}/pages`)

  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) => {
    if (r.request().method() === 'POST') {
      return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(detail(2, '', null)) })
    }
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 1, parentId: null, title: '제품 문서', position: 0 }]),
    })
  })
  await page.route('**/api/v1/wiki/pages/*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(2, '', null)) }),
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  await page.getByRole('button', { name: '새 페이지', exact: true }).click()

  await creates.waitFor()
  // 생성 요청 자체가 빈 문자열 title 이어야 한다(리터럴 "제목 없음" 전송 금지).
  expect(creates.lastBody<CreateBody>()?.title).toBe('')

  // 새 페이지 진입 시 제목 입력란은 실제 값이 비어 있어 placeholder 만 노출되고,
  // 클릭 후 바로 입력하면 접합 없이 입력값만 남아야 한다.
  const titleInput = page.getByPlaceholder('제목 없음')
  await expect(titleInput).toHaveValue('')
  await titleInput.click()
  await titleInput.pressSequentially('탐색 테스트 문서')
  await expect(titleInput).toHaveValue('탐색 테스트 문서')
})

test('인라인 액션 버튼 — WCAG 2.5.8 최소 24×24px 충족', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await routeCommon(page)
  const tree: WikiPageSummary[] = [
    { id: 1, parentId: null, title: '제품 문서', position: 0, aiLastUsedAt: null },
    { id: 2, parentId: 1, title: '기획', position: 0, aiLastUsedAt: null },
  ]
  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree) }),
  )
  await page.route('**/api/v1/wiki/pages/*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(1, '제품 문서', null)) }),
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  const row = page.getByTestId('wiki-tree-row-1')
  await row.hover()

  // 접기 토글, 하위 페이지, 페이지 메뉴 버튼 각각 24px 이상 확인 — 이름은 「<제목> <동작>」(WP-923).
  for (const label of ['제품 문서 접기', '제품 문서 하위 페이지 추가', '제품 문서 페이지 메뉴']) {
    const btn = row.getByRole('button', { name: label })
    const box = await btn.boundingBox()
    expect(box, `${label} 버튼의 boundingBox가 null`).not.toBeNull()
    expect(box!.width, `${label} 버튼 너비 < 24px`).toBeGreaterThanOrEqual(24)
    expect(box!.height, `${label} 버튼 높이 < 24px`).toBeGreaterThanOrEqual(24)
  }
})

// WP-237: 터치 태블릿(≥1024px, pointer: coarse)은 hover 가 없어 ＋·⋯ 클러스터에 닿지 못했다 → 제목 옆 44px ⋯ 하나로 모아 드롭다운으로 연다.
test.describe('트리 행 액션 — 터치 태블릿(≥1024px)', { tag: '@layout' }, () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true })

  test('⋯ 하나가 상시 보이고(＋ 없음, 제목과 안 겹침) 메뉴로 하위 페이지 추가(POST parentId)·삭제(DELETE)', async ({
    authenticatedPage: page,
  }) => {
    await routeCommon(page)
    const creates = trackRequests(page, 'POST', `/api/v1/wiki/spaces/${SPACE_ID}/pages`)
    const deletes = trackRequests(page, 'DELETE', /^\/api\/v1\/wiki\/pages\/[^/]+$/)
    await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) => {
      if (r.request().method() === 'POST') {
        return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(detail(2, '', 1)) })
      }
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 1, parentId: null, title: '아주 긴 제품 문서 제목이 사이드바 폭을 넘어가는 경우', position: 0 }]),
      })
    })
    await page.route('**/api/v1/wiki/pages/*', (r) => {
      if (r.request().method() === 'DELETE') {
        return r.fulfill({ status: 204, body: '' })
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(1, '제품 문서', null)) })
    })

    await page.goto(`/wiki/spaces/${SPACE_ID}`)
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    const row = page.getByTestId('wiki-tree-row-1')
    const trigger = row.getByRole('button', { name: '페이지 메뉴' })
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveCSS('opacity', '1')
    await expect(row.getByRole('button', { name: '하위 페이지' })).toHaveCount(0)
    // 44px 터치 영역 + 제목 버튼과 겹치지 않음.
    const t = (await trigger.boundingBox())!
    expect(t.width).toBeGreaterThanOrEqual(44)
    expect(t.height).toBeGreaterThanOrEqual(44)
    const titleBox = (await row.getByRole('button', { name: '아주 긴 제품 문서 제목이 사이드바 폭을 넘어가는 경우', exact: true }).boundingBox())!
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(t.x)

    await trigger.tap()
    await page.getByRole('menuitem', { name: '하위 페이지 추가' }).click()
    await creates.waitFor()
    expect(creates.lastBody<CreateBody>()?.parentId).toBe(1)

    await page.goto(`/wiki/spaces/${SPACE_ID}`)
    await page.getByTestId('wiki-tree-row-1').getByRole('button', { name: '페이지 메뉴' }).tap()
    await page.getByRole('menuitem', { name: '삭제' }).click()
    await page.getByTestId('wiki-delete-dialog').getByRole('button', { name: '삭제' }).click()
    await deletes.waitFor()
  })
})
