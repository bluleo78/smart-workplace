// 노트 팀 스페이스 생성 E2E — 드롭다운 하단 '＋ 새 스페이스' → 이름 모달 → POST payload 검증
// → 생성 후 새 스페이스로 이동 + 목록 반영 + 빈 이름 가드 (백엔드 없이 page.route 모킹).
import type { WikiPageSummary, WikiSpace } from '../../src/types/wiki'
import { expect, test } from '../fixtures/auth.fixture'

const SPACE_ID = 1
const NEW_SPACE_ID = 5

function personalSpace(): WikiSpace {
  return { id: SPACE_ID, type: 'PERSONAL', name: '내 노트', ownerId: 1, role: 'OWNER', createdAt: '2026-06-01T00:00:00Z' }
}
function newTeamSpace(name: string): WikiSpace {
  return { id: NEW_SPACE_ID, type: 'TEAM', name, ownerId: 1, role: 'OWNER', createdAt: '2026-07-01T00:00:00Z' }
}

// 스페이스 목록 — 생성 전엔 개인만, 생성(POST) 후엔 새 팀 스페이스 포함. 트리는 항상 빈 목록.
async function mockWiki(page: import('@playwright/test').Page, created: { space: WikiSpace | null }) {
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) => {
      if (route.request().method() === 'GET') {
        const spaces = [personalSpace(), ...(created.space ? [created.space] : [])]
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(spaces) })
      }
      return route.fallback()
    },
  )
  await page.route(
    (url) => /^\/api\/v1\/wiki\/spaces\/\d+\/pages$/.test(url.pathname),
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([] as WikiPageSummary[]) })
        : route.fallback(),
  )
}

test('노트 — 드롭다운에서 새 팀 스페이스 생성 후 이동', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const created: { space: WikiSpace | null } = { space: null }
  await mockWiki(page, created)

  // 생성 요청 캡처 — payload {name} 검증 후 새 스페이스 반환.
  let postBody: unknown = null
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) => {
      if (route.request().method() === 'POST') {
        postBody = route.request().postDataJSON()
        const space = newTeamSpace((postBody as { name: string }).name)
        created.space = space
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(space) })
      }
      return route.fallback()
    },
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}`)

  // 드롭다운 열고 생성 항목 클릭
  await page.getByRole('combobox').click()
  await page.getByTestId('wiki-space-create-item').click()

  // 모달 → 이름 입력 → 만들기
  await expect(page.getByTestId('wiki-space-create-dialog')).toBeVisible()
  await page.getByTestId('wiki-space-create-input').fill('제품팀 위키')
  await page.getByTestId('wiki-space-create-confirm').click()

  // 처리: POST payload 는 {name} 만
  await expect.poll(() => postBody).toEqual({ name: '제품팀 위키' })

  // 출력: 새 스페이스로 이동 + 드롭다운(목록)에 새 스페이스 반영
  await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${NEW_SPACE_ID}`))
  await page.getByRole('combobox').click()
  await expect(page.getByRole('option', { name: '제품팀 위키' })).toBeVisible()
})

test('노트 — 스페이스 이름이 비면 생성 요청이 나가지 않는다', async ({ authenticatedPage: page }) => {
  const created: { space: WikiSpace | null } = { space: null }
  await mockWiki(page, created)
  let posted = false
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) => {
      if (route.request().method() === 'POST') { posted = true; return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) }
      return route.fallback()
    },
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  await page.getByRole('combobox').click()
  await page.getByTestId('wiki-space-create-item').click()
  await expect(page.getByTestId('wiki-space-create-dialog')).toBeVisible()
  // 공백만 입력 → 만들기 비활성, 요청 없음
  await page.getByTestId('wiki-space-create-input').fill('   ')
  await expect(page.getByTestId('wiki-space-create-confirm')).toBeDisabled()
  expect(posted).toBe(false)
})

test('노트 — 취소 후 재오픈 시 이전 입력값이 남지 않는다', async ({ authenticatedPage: page }) => {
  const created: { space: WikiSpace | null } = { space: null }
  await mockWiki(page, created)

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  await page.getByRole('combobox').click()
  await page.getByTestId('wiki-space-create-item').click()
  await expect(page.getByTestId('wiki-space-create-dialog')).toBeVisible()

  await page.getByTestId('wiki-space-create-input').fill('임시 테스트 스페이스')
  await page.getByRole('button', { name: '취소' }).click()
  await expect(page.getByTestId('wiki-space-create-dialog')).not.toBeVisible()

  await page.getByRole('combobox').click()
  await page.getByTestId('wiki-space-create-item').click()
  await expect(page.getByTestId('wiki-space-create-dialog')).toBeVisible()
  await expect(page.getByTestId('wiki-space-create-input')).toHaveValue('')
})
