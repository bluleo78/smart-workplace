// WP-183: 감사 로그 모바일 — 필터 줄과 표가 가로로 넘치지 않는다.
// 좁은 화면에선 리소스·설명·IP 열을 숨기고, 행을 누르면 상세 다이얼로그에서 전부 보인다.

import { setupAdminAuth } from '../../fixtures/admin.fixture'
import { createPageResponse } from '../../fixtures/api-mock'
import { createAuditLog } from '../../factories/admin.factory'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

test('감사 로그는 모바일에서 가로로 넘치지 않고, 숨긴 열은 상세 다이얼로그에서 보인다', { tag: '@layout' }, async ({ adminPage: page }) => {
  await setupAdminAuth(page)
  await page.route(
    (url) => url.pathname === '/api/v1/admin/audit-logs',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createPageResponse(
            // 운영과 같은 긴 아이디(이메일) — 짧은 값으로는 표 넘침이 재현되지 않는다
            [
              createAuditLog({
                id: 1,
                username: 'agent.kim@iacloud.kr',
                actionTime: '2026-10-02T04:00:00Z',
                description: '모바일 설명 텍스트',
                ipAddress: '10.1.2.3',
              }),
            ],
            { size: 50 },
          ),
        ),
      }),
  )

  await page.goto('/settings/audit-logs')
  const table = page.getByRole('table', { name: '감사 로그' })
  await expect(table).toBeVisible()

  // 페이지와 표 컨테이너 모두 가로 스크롤이 없다
  await expectNoHorizontalOverflow(page)
  const overflow = await table.evaluate((t) => {
    const box = t.parentElement as HTMLElement
    return box.scrollWidth - box.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(0)

  // 좁은 화면은 IP·설명 열을 숨긴다
  await expect(page.getByRole('columnheader', { name: 'IP' })).toBeHidden()
  await expect(page.getByRole('columnheader', { name: '설명' })).toBeHidden()

  // 행을 누르면 숨긴 값이 상세에 보인다
  await page.getByRole('button', { name: /상세 보기/ }).first().click()
  const dialog = page.getByRole('dialog', { name: '감사 로그 상세' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('모바일 설명 텍스트')
  await expect(dialog).toContainText('10.1.2.3')
  await expect(dialog).toContainText('agent.kim@iacloud.kr')
})

// WP-639: 운영과 같은 실데이터(긴 아이디·긴 액션)에서도 시간이 두 줄(날짜/시각)을 넘지 않고, 「결과」 배지가 표 안에 있다.
test('긴 아이디·긴 액션 행도 시간은 두 줄, 결과 배지는 표 안에 보인다', { tag: '@layout' }, async ({ adminPage: page }) => {
  await setupAdminAuth(page)
  await page.route(
    (url) => url.pathname === '/api/v1/admin/audit-logs',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createPageResponse(
            [
              createAuditLog({ id: 1, username: 'admin@workplace.local', actionType: 'MEMBER_CREATED', actionTime: '2026-10-21T00:28:47Z' }),
              createAuditLog({ id: 2, username: 'w617u-1231456789@x.io', actionType: 'USER_TOKEN_ISSUED', actionTime: '2026-10-21T00:28:43Z' }),
            ],
            { size: 50 },
          ),
        ),
      }),
  )

  await page.goto('/settings/audit-logs')
  const table = page.getByRole('table', { name: '감사 로그' })
  await expect(table.getByRole('button', { name: /상세 보기/ })).toHaveCount(2)

  // 표 스크롤 칸이 넘치지 않는다
  const overflow = await table.evaluate((t) => {
    const box = t.parentElement as HTMLElement
    return box.scrollWidth - box.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(0)

  // 시간 칸은 날짜/시각 두 줄 — 「2026-」 에서 꺾여 세 줄이 되지 않는다
  const firstRow = table.getByRole('button', { name: /상세 보기/ }).first()
  const lines = await firstRow.locator('td').first().evaluate((td) => {
    const lh = parseFloat(getComputedStyle(td).lineHeight)
    const cs = getComputedStyle(td)
    const h = td.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    return Math.round(h / lh)
  })
  expect(lines).toBe(2)

  // 결과 배지는 표 컨테이너 오른쪽 끝 안에 있다
  const badge = firstRow.getByText('성공')
  const [badgeBox, boxBox] = await Promise.all([badge.boundingBox(), table.locator('..').boundingBox()])
  expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(boxBox!.x + boxBox!.width)

  // 좁은 화면에서 숨긴 사용자 열의 값은 액션 아래 줄에 보인다
  await expect(firstRow).toContainText('admin@workplace.local')
})
