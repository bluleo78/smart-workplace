// 노트 앱 "마지막으로 본 노트" 복원 E2E — /wiki 진입(앱 레일·새로고침) 시 직전 페이지를 열고,
// 삭제(404)·권한 상실(403)이면 기록을 지운 뒤 기본 화면(첫 스페이스)으로 이동한다.
// 기록은 localStorage(사용자·테넌트 스코프 키)에 남으므로 새 문서 로드(goto)로 새로고침·재로그인을 대신한다.
// 404/403 기록 정리·500 기록 유지·다른 사용자 키·에러 화면 「노트 목록으로」는 src/pages/wiki/wikiPage.test.tsx 가 지킨다(WP-983).
// 여기엔 앱 레일로 돌아오는 흐름(@flow)과 새로고침 뒤 유지(@platform)만 남는다.
import type { Page } from '@playwright/test'

import type { WikiPageDetail, WikiPageSummary, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const PERSONAL_SPACE_ID = 1
const TEAM_SPACE_ID = 2
const PAGE_ID = 42
const PAGE_TITLE = '마지막으로 본 팀 노트'
const KEY_PREFIX = 'wiki.lastVisitedPage:'

function space(id: number, name: string, type: WikiSpace['type']): WikiSpace {
  return { id, type, name, ownerId: 1, role: 'OWNER', createdAt: '2026-06-01T00:00:00Z' }
}

// 첫 스페이스(기본 화면)와 다른 팀 스페이스의 페이지를 쓴다 — 복원이 "첫 스페이스"와 구분되게.
function pageDetail(): WikiPageDetail {
  return {
    id: PAGE_ID,
    spaceId: TEAM_SPACE_ID,
    parentId: null,
    title: PAGE_TITLE,
    body: '본문',
    version: 1,
    updatedBy: 1,
    updatedAt: '2026-06-01T00:00:00Z',
    aiLastUsedAt: null,
    aiLastAction: null,
  }
}

/** 스페이스·트리·페이지 상세 모킹. pageStatus 로 페이지 상세 응답 코드를 테스트 도중 바꿀 수 있다. */
async function mockWiki(page: Page) {
  const state = { pageStatus: 200 }
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              space(PERSONAL_SPACE_ID, '내 위키', 'PERSONAL'),
              space(TEAM_SPACE_ID, '팀 위키', 'TEAM'),
            ]),
          })
        : route.fallback(),
  )
  await page.route(
    (url) => /^\/api\/v1\/wiki\/spaces\/\d+\/pages$/.test(url.pathname),
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      const tree: WikiPageSummary[] = route.request().url().includes(`/spaces/${TEAM_SPACE_ID}/`)
        ? [{ id: PAGE_ID, parentId: null, title: PAGE_TITLE, position: 0, aiLastUsedAt: null }]
        : []
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree) })
    },
  )
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${PAGE_ID}`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      if (state.pageStatus !== 200) {
        return route.fulfill({
          status: state.pageStatus,
          contentType: 'application/json',
          body: JSON.stringify({ status: state.pageStatus, message: '페이지를 열 수 없습니다' }),
        })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pageDetail()) })
    },
  )
  return state
}

/** 페이지를 한 번 열어 기록을 남기고, 앱이 저장한 키 이름을 돌려준다. */
async function visitPage(page: Page): Promise<string> {
  await page.goto(`/wiki/spaces/${TEAM_SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.getByText(PAGE_TITLE).first()).toBeVisible({ timeout: 10000 })
  await expect.poll(() => lastVisitedEntries(page)).toHaveLength(1)
  const [[key, value]] = await lastVisitedEntries(page)
  expect(value).toBe(String(PAGE_ID))
  return key
}

function lastVisitedEntries(page: Page): Promise<[string, string][]> {
  return page.evaluate(
    (prefix) =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith(prefix))
        .map((k) => [k, localStorage.getItem(k) ?? ''] as [string, string]),
    KEY_PREFIX,
  )
}

const pageUrl = new RegExp(`/wiki/spaces/${TEAM_SPACE_ID}/pages/${PAGE_ID}$`)

test('다른 앱에 갔다가 앱 레일로 노트에 돌아오면 직전에 보던 노트가 열린다', { tag: ['@flow', '@smoke'] }, async ({
  authenticatedPage: page,
}) => {
  await mockWiki(page)
  const key = await visitPage(page)
  // 키는 로그인 사용자(id=1) 스코프여야 한다.
  expect(key.startsWith(`${KEY_PREFIX}1:`)).toBe(true)

  // 다른 앱(홈)으로 이동 후 레일의 「노트」 클릭 → /wiki → 복원
  await page.goto('/')
  await page.locator('a[href="/wiki"]').first().click()
  await expect(page).toHaveURL(pageUrl)
  await expect(page.getByText(PAGE_TITLE).first()).toBeVisible()
})

test('새로고침(새 문서 로드) 후 /wiki 진입 시에도 마지막으로 본 노트가 유지된다', { tag: '@platform' }, async ({
  authenticatedPage: page,
}) => {
  await mockWiki(page)
  await visitPage(page)

  await page.goto('/wiki')
  await expect(page).toHaveURL(pageUrl)
  await expect(page.getByText(PAGE_TITLE).first()).toBeVisible()
})

