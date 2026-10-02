// WP-183: 감사 로그 모바일 — 필터 줄과 표가 가로로 넘치지 않는다.
// 좁은 화면에선 리소스·설명·IP 열을 숨기고, 행을 누르면 상세 다이얼로그에서 전부 보인다.

import { setupAdminAuth } from '../../fixtures/admin.fixture'
import { createPageResponse } from '../../fixtures/api-mock'
import { createAuditLog } from '../../factories/admin.factory'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

test('감사 로그는 모바일에서 가로로 넘치지 않고, 숨긴 열은 상세 다이얼로그에서 보인다', async ({ adminPage: page }) => {
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
  await page.route(
    (url) => url.pathname === '/api/v1/members',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createPageResponse([])) }),
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
