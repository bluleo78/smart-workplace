// 노트 에디터 블록 요소(목록/코드블록) 렌더 검증 (#738)
//
// Tailwind v4 preflight가 ul/ol/li의 list-style·padding·margin을 리셋해 마커·들여쓰기가
// 사라지던 버그. ::marker 는 Playwright 로 직접 단언하기 어려우므로 computed
// list-style-type·padding-left 로 마커/들여쓰기 복원 여부를 검증한다.
import type { Page } from '@playwright/test'
import type { WikiPageDetail, WikiPageSummary, WikiRole, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const PAGE_ID = 300

function space(role: WikiRole): WikiSpace {
  return {
    id: SPACE_ID,
    type: 'TEAM',
    name: '팀 위키',
    ownerId: 1,
    role,
    createdAt: '2026-06-01T00:00:00Z',
  }
}

function pageDetail(body: string): WikiPageDetail {
  return {
    id: PAGE_ID,
    spaceId: SPACE_ID,
    parentId: null,
    title: '블록 스타일 페이지',
    body,
    version: 1,
    updatedBy: 1,
    updatedAt: '2026-06-01T00:00:00Z',
  }
}

async function setupWikiMocks(page: Page, body: string) {
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([space('EDITOR')]) })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              { id: PAGE_ID, parentId: null, title: '블록 스타일 페이지', position: 0 } as WikiPageSummary,
            ]),
          })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/members`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${PAGE_ID}`,
    (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pageDetail(body)) })
      }
      if (method === 'PUT') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...pageDetail(body), version: 2 }),
        })
      }
      return route.fallback()
    },
  )
}

const BLOCK_BODY = [
  '- 최상위 불릿 1',
  '- 최상위 불릿 2',
  '  - 중첩 불릿 2-1',
  '',
  '1. 순서 1',
  '2. 순서 2',
  '',
  '```js',
  'const x = 1;',
  '```',
].join('\n')

test('노트 에디터 — 불릿/번호 목록 마커와 들여쓰기가 렌더된다 (#738)', async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page, BLOCK_BODY)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  const ul = page.locator('.ProseMirror ul').first()
  const ol = page.locator('.ProseMirror ol').first()
  await expect(ul).toBeVisible()
  await expect(ol).toBeVisible()

  const ulStyle = await ul.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { listStyleType: cs.listStyleType, paddingLeft: cs.paddingLeft }
  })
  expect(ulStyle.listStyleType).toBe('disc')
  expect(parseFloat(ulStyle.paddingLeft)).toBeGreaterThan(0)

  const olStyle = await ol.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { listStyleType: cs.listStyleType, paddingLeft: cs.paddingLeft }
  })
  expect(olStyle.listStyleType).toBe('decimal')
  expect(parseFloat(olStyle.paddingLeft)).toBeGreaterThan(0)

  // 중첩 목록은 부모보다 padding-left가 누적되어 더 들여써져야 한다.
  const nestedUl = page.locator('.ProseMirror li ul').first()
  const nestedIndent = await nestedUl.evaluate((el) => el.getBoundingClientRect().left)
  const topIndent = await ul.evaluate((el) => el.getBoundingClientRect().left)
  expect(nestedIndent).toBeGreaterThan(topIndent)
})

test('노트 에디터 — 코드블록에 배경/보더가 렌더된다 (#738)', async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page, BLOCK_BODY)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  const pre = page.locator('.ProseMirror pre').first()
  await expect(pre).toBeVisible()

  const preStyle = await pre.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { background: cs.backgroundColor, border: cs.borderTopWidth }
  })
  expect(preStyle.background).not.toBe('rgba(0, 0, 0, 0)')
  expect(parseFloat(preStyle.border)).toBeGreaterThan(0)
})
