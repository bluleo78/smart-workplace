// WP-686: 모바일 설정 표 — 역할 목록·메일 계정 표가 설명·이메일 길이만큼 넓어져 삭제 버튼이 화면 밖에 있던 문제.
// WP-639(에이전트·감사 로그 표)와 같은 방식: 좁은 화면은 보조 열을 숨기고 첫 열 아래 줄로 모은다.

import { setupAdminAuth } from '../../fixtures/admin.fixture'
import { mockApi } from '../../fixtures/api-mock'
import { createRole } from '../../factories/auth.factory'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import type { Locator } from '@playwright/test'

/** 표 스크롤 칸(표의 부모)이 가로로 넘치지 않는다. */
async function expectTableFits(table: Locator) {
  const overflow = await table.evaluate((t) => {
    const box = t.parentElement as HTMLElement
    return box.scrollWidth - box.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(0)
}

/** 대상이 표 스크롤 칸의 오른쪽 끝 안에 있다(가로로 밀지 않아도 보인다). */
async function expectInsideTable(table: Locator, target: Locator) {
  const [a, b] = await Promise.all([target.boundingBox(), table.locator('..').boundingBox()])
  expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + b!.width + 0.5)
}

test('역할 목록 — 긴 설명이 있어도 표가 화면 안에 들고 삭제 버튼이 보인다', { tag: '@layout' }, async ({ adminPage: page }) => {
  await setupAdminAuth(page)
  // 운영과 같은 긴 설명 — 짧은 값으로는 넘침이 재현되지 않는다
  await mockApi(page, 'GET', '/api/v1/roles', [
    createRole({ id: 1, name: 'USER', description: '일반 사용자', isSystem: true }),
    createRole({
      id: 3,
      name: 'HR_MANAGER',
      description: '인사 담당 — 구성원 조회·정지와 조직도 편집, 신규 입사자 계정 생성까지 맡는 역할',
      isSystem: false,
    }),
  ])

  await page.goto('/settings/roles')
  const table = page.getByRole('table', { name: '역할 목록' })
  await expect(table.getByRole('button', { name: /상세 보기/ })).toHaveCount(2)

  await expectNoHorizontalOverflow(page)
  await expectTableFits(table)
  await expectInsideTable(table, page.getByRole('button', { name: 'HR_MANAGER 역할 삭제' }))

  // 좁은 화면은 유형·설명 열을 숨기고, 값은 이름 아래 줄에 보인다
  await expect(page.getByRole('columnheader', { name: '설명' })).toBeHidden()
  await expect(page.getByRole('columnheader', { name: '유형' })).toBeHidden()
  const row = table.getByRole('button', { name: 'HR_MANAGER 상세 보기' })
  await expect(row).toContainText('사용자 정의')
  await expect(row).toContainText('인사 담당')
})

test('메일 계정 — 긴 이메일·공급자여도 표가 화면 안에 들고 수정·삭제 버튼이 보인다', { tag: '@layout' }, async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [
    {
      id: 7,
      provider: 'IMAP',
      emailAddress: 'very.long.mailbox.name.for.team@iacloud-workplace.co.kr',
      displayName: '팀 메일',
      imapHost: 'outlook.office365.com',
      imapPort: 993,
      imapSecurity: 'SSL_TLS',
      imapUsername: 'very.long.mailbox.name.for.team@iacloud-workplace.co.kr',
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      smtpSecurity: 'STARTTLS',
      smtpUsername: 'very.long.mailbox.name.for.team@iacloud-workplace.co.kr',
      aiEnabled: false,
      lastSyncedAt: '2026-10-21T10:00:00Z',
      lastTestedAt: '2026-10-21T09:00:00Z',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-21T00:00:00Z',
    },
  ])

  await page.goto('/settings/mail')
  const table = page.getByRole('table', { name: '메일 계정 목록' })
  await expect(page.getByTestId('mail-account-row-7')).toBeVisible()

  await expectNoHorizontalOverflow(page)
  await expectTableFits(table)
  await expectInsideTable(table, page.getByTestId('mail-delete-7'))
  await expectInsideTable(table, page.getByTestId('mail-account-row-7').getByRole('button', { name: '수정' }))

  // 좁은 화면은 공급자·마지막 동기화 열을 숨기고, 값은 이메일 아래 줄에 보인다
  await expect(page.getByRole('columnheader', { name: '공급자' })).toBeHidden()
  await expect(page.getByRole('columnheader', { name: '마지막 동기화' })).toBeHidden()
  const meta = page.getByTestId('mail-account-mobile-meta-7')
  await expect(meta).toContainText('outlook.office365.com')
  // 긴 공급자를 잘라도 동기화 시각(「…전」)은 메타 줄 안에 다 보인다
  const syncBox = await meta.getByText(/전$/).boundingBox()
  const metaBox = await meta.boundingBox()
  expect(syncBox!.x + syncBox!.width).toBeLessThanOrEqual(metaBox!.x + metaBox!.width + 0.5)
})
