// 드라이브 팀 공간 생성 다이얼로그 더블 서브밋 방지 E2E (#582) — 백엔드 없이 page.route 모킹.
// "만들기" 버튼을 동기적으로 연속 클릭해도 createSpace 요청이 1번만 나가야 한다.
import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import type { DriveSpace } from '../../src/types/drive'

const PERSONAL_SPACE_ID = 1
const NEW_SPACE_ID = 9

function personalSpace(): DriveSpace {
  return {
    id: PERSONAL_SPACE_ID,
    type: 'PERSONAL',
    name: '내 드라이브',
    ownerId: 1,
    role: 'OWNER',
    archived: false,
    createdAt: '2026-06-01T00:00:00Z',
  }
}
function newTeamSpace(name: string): DriveSpace {
  return {
    id: NEW_SPACE_ID,
    type: 'TEAM',
    name,
    ownerId: 1,
    role: 'OWNER',
    archived: false,
    createdAt: '2026-07-02T00:00:00Z',
  }
}

// 사이드바 + DrivePage 가 요구하는 공통 경로 모킹(목록·쿼터·항목).
async function mockBaseRoutes(page: Page, created: { space: DriveSpace | null }) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/quota',
    (r) => r.fulfill({ json: { usedBytes: 0, quotaBytes: 1024 * 1024 * 1024 } }),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (r) => {
      if (r.request().method() !== 'GET') return r.fallback()
      const spaces = [personalSpace(), ...(created.space ? [created.space] : [])]
      return r.fulfill({ json: spaces })
    },
  )
  // DrivePage 가 진입 시 호출하는 항목 목록 — 빈 목록으로 안정화.
  await page.route(
    (url) => /\/api\/v1\/drive\/spaces\/\d+\/items$/.test(url.pathname),
    (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { folders: [], files: [] } }) : r.fallback()),
  )
}

test('드라이브 — 팀 공간 이름이 비면 만들기 버튼이 비활성', async ({ authenticatedPage: page }) => {
  const created: { space: DriveSpace | null } = { space: null }
  await mockBaseRoutes(page, created)
  await page.goto('/drive')
  await page.getByRole('button', { name: '팀 공간 만들기' }).click()
  await expect(page.getByTestId('space-name-dialog')).toBeVisible()
  // 빈 값(트림 후 공백) → 비활성
  await expect(page.getByTestId('space-name-confirm')).toBeDisabled()
  await page.getByTestId('space-name-input').fill('   ')
  await expect(page.getByTestId('space-name-confirm')).toBeDisabled()
})

test('드라이브 — 만들기 버튼을 동기적으로 연속 클릭해도 요청이 1번만 나간다', async ({ authenticatedPage: page }) => {
  const created: { space: DriveSpace | null } = { space: null }
  await mockBaseRoutes(page, created)

  // POST 호출 횟수 카운트 — race condition 재현을 위해 약간의 지연을 준다
  // (실제 네트워크 latency가 있는 환경에서 더블 서브밋이 재현되기 쉬운 조건을 모사).
  let postCount = 0
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    async (r) => {
      if (r.request().method() === 'POST') {
        postCount += 1
        await new Promise((resolve) => setTimeout(resolve, 200))
        const body = r.request().postDataJSON() as { name: string }
        const space = newTeamSpace(body.name)
        created.space = space
        return r.fulfill({ json: space })
      }
      return r.fallback()
    },
  )

  await page.goto('/drive')
  await page.getByRole('button', { name: '팀 공간 만들기' }).click()
  await expect(page.getByTestId('space-name-dialog')).toBeVisible()
  await page.getByTestId('space-name-input').fill('동시생성테스트공간')

  // 같은 이벤트 루프 틱 내에 두 번 dispatch — React state 리렌더 전에 disabled 속성이
  // 반영되기 전 상태를 재현(실제 버그의 근본 원인 조건).
  const confirmButton = page.getByTestId('space-name-confirm')
  await confirmButton.evaluate((el: HTMLButtonElement) => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

  // 처리 완료(새 공간으로 이동) 대기 후 POST 는 정확히 1번만 발생해야 한다
  await expect(page).toHaveURL(new RegExp(`/drive/spaces/${NEW_SPACE_ID}`))
  expect(postCount).toBe(1)
})

test('드라이브 — 취소 후 재오픈 시 이전 입력값이 남지 않는다', async ({ authenticatedPage: page }) => {
  const created: { space: DriveSpace | null } = { space: null }
  await mockBaseRoutes(page, created)

  await page.goto('/drive')
  await page.getByRole('button', { name: '팀 공간 만들기' }).click()
  await expect(page.getByTestId('space-name-dialog')).toBeVisible()

  await page.getByTestId('space-name-input').fill('임시 테스트 공간')
  await page.getByRole('button', { name: '취소' }).click()
  await expect(page.getByTestId('space-name-dialog')).not.toBeVisible()

  await page.getByRole('button', { name: '팀 공간 만들기' }).click()
  await expect(page.getByTestId('space-name-dialog')).toBeVisible()
  await expect(page.getByTestId('space-name-input')).toHaveValue('')
})
