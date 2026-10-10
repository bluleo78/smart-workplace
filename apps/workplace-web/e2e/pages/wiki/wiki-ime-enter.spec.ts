// 노트 본문 — macOS Chrome 에서 한글 마지막 글자 조합 중 Enter 를 쳐도 그 글자가 사라지지 않는다 (WP-333)
//
// Mac Chrome 은 "마지막 조합 글자 확정(DOM 변경) → compositionend → Enter keydown" 을 한 태스크 안에서 보내,
// ProseMirror 가 확정 글자를 문서에 반영하기 전에 줄 나누기가 돈다. 같은 순서를 만들어 수정(ImeCommitFlush) 뒤 동작을 지킨다.
// 한계: 실제 macOS 입력기의 글자 소실 자체는 합성 이벤트로 재현되지 않는다(이 경로에선 ProseMirror 가 늦은 변경을 맞춰 넣음) —
// 원인 메커니즘은 src/lib/imeCommitFlush.test.ts 가, 실제 소실 해소는 실기기 진단으로 확인했다.
import type { Page } from '@playwright/test'
import type { WikiPageDetail, WikiPageSummary, WikiRole, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'
import { seedCollabFor } from '../../fixtures/collab'
import { commitImeThenEnterInSameTask } from '../../fixtures/ime'

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
    title: 'IME 페이지',
    body,
    version: 1,
    updatedBy: 1,
    updatedAt: '2026-06-01T00:00:00Z',
    aiLastUsedAt: null,
    aiLastAction: null,
  }
}

async function setupWikiMocks(page: Page, body: string) {
  // 에디터 본문·역할은 동기화 서버 문서에서 온다(WP-172) — 모킹한 상세 본문·스페이스 역할과 같게 시드한다.
  await seedCollabFor(page, PAGE_ID, body, 'EDITOR')
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
              { id: PAGE_ID, parentId: null, title: 'IME 페이지', position: 0 } as WikiPageSummary,
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

test('마지막 글자 조합 중 Enter — 글자는 남고 다음 줄로 넘어가 이어 쓸 수 있다', async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page, '첫 줄')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  const editor = page.locator('.ProseMirror').first()
  await expect(editor).toContainText('첫 줄')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' 가나')

  // "다" 를 조합하다(화면엔 "닥") Enter — 확정하며 "다" 로 다시 쓰는 변경이 문서에 반영되기 전에 Enter 가 온다
  await commitImeThenEnterInSameTask(editor, { composing: '닥', committed: '다' })
  await page.keyboard.insertText('다음')

  // 확정 글자 "다" 가 첫 줄에 남고, Enter 로 새 줄이 생겨 이어 쓴 글자는 둘째 줄에 들어간다
  await expect(editor.locator('p')).toHaveText(['첫 줄 가나다', '다음'])
})
