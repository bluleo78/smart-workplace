// 위키 멤버 관리 E2E — TEAM 위키 공유. 백엔드 없이 page.route 모킹.
// OWNER 가 멤버 검색 → 추가 → POST payload({userId,role}) 검증 → 목록 반영을 확인한다.
import type { WikiMember, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1

// TEAM 위키 스페이스 1개 — 첫 스페이스가 /wiki 리다이렉트 대상이 된다(OWNER).
function teamSpace(): WikiSpace {
  return {
    id: SPACE_ID,
    type: 'TEAM',
    name: '팀 위키',
    ownerId: 1,
    role: 'OWNER',
    createdAt: '2026-06-01T00:00:00Z',
  }
}

test('위키 멤버 — OWNER 가 멤버 검색·추가(POST payload 검증 + 목록 반영)', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  // 가변 멤버 상태 — 처음엔 소유자(나)만, POST 도착 후 김편집 추가.
  const members: WikiMember[] = [{ userId: 1, name: '나', role: 'OWNER' }]
  // POST payload 검증 통과 여부 — 라우트 핸들러가 expect 를 통과했는지 확인.
  let addPayloadVerified = false

  // 스페이스 목록 — TEAM 1개.
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([teamSpace()]),
          })
        : route.fallback(),
  )

  // 페이지 트리 — 빈 목록(멤버 플로우와 무관).
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        : route.fallback(),
  )

  // 멤버 — GET(동적 목록) + POST(추가 → 목록에 김편집 push).
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/members`,
    (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(members),
        })
      }
      if (method === 'POST') {
        // payload 검증 — 신규 멤버는 EDITOR 기본.
        const payload = route.request().postDataJSON() as { userId: number; role: string }
        expect(payload).toEqual({ userId: 2, role: 'EDITOR' })
        addPayloadVerified = true
        members.push({ userId: 2, name: '김편집', role: 'EDITOR' })
        return route.fulfill({ status: 201, body: '' })
      }
      return route.fallback()
    },
  )

  // 멤버 검색 — GET /users?search= (MemberSearchPopover 의 useUserSearch).
  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              content: [
                { id: 2, username: 'editor', email: 'e@x.com', name: '김편집', isActive: true, createdAt: '2026-06-01T00:00:00Z', kind: 'HUMAN' },
              ],
              page: 0,
              size: 20,
              totalElements: 1,
              totalPages: 1,
            }),
          })
        : route.fallback(),
  )

  // 1) /wiki 진입 → 첫(TEAM) 스페이스로 리다이렉트.
  await page.goto('/wiki')
  await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${SPACE_ID}$`))

  // 2) 멤버 관리 버튼 → 다이얼로그 노출.
  await page.getByRole('button', { name: '멤버 관리' }).click()
  await expect(page.getByTestId('wiki-members-dialog')).toBeVisible()
  // 소유자 행은 읽기 전용 Badge.
  await expect(page.getByTestId('wiki-member-role-1')).toContainText('OWNER')

  // 3) 멤버 추가 popover → 검색 → 김편집 선택.
  await page.getByTestId('wiki-member-add-trigger').click()
  await expect(page.getByTestId('member-search-popover')).toBeVisible()
  await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('김편집')
  await page.getByTestId('member-search-row-2').click()

  // 4) POST 가 호출되어 payload 검증을 통과했는지 확인.
  await expect.poll(() => addPayloadVerified).toBe(true)

  // 5) 멤버 목록 invalidate→refetch → 김편집 행이 다이얼로그에 나타난다.
  await expect(page.getByTestId('wiki-member-row-2')).toContainText('김편집')
})
