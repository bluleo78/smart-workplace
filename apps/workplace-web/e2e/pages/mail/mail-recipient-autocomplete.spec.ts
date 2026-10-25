// 메일 받는사람 자동완성·칩(WP-945) — 쓰는 중인 조각으로 최근 수신인·구성원·주소록을 함께 찾아 후보로 띄우고, 고르거나 쉼표·Tab 으로 굳힌 주소는 칩이 된다.
// 칩은 화면 모양일 뿐 발송 payload 는 지금처럼 주소 목록이다 — 고른 후보는 「이름 <주소>」로 실린다.
import type { Page } from '@playwright/test'

import { external, member, page as contactPage } from '../../factories/contacts.factory'
import { mailAccount } from '../../factories/mail.factory'
import type { RecentRecipient } from '../../../src/types/mailMessage'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { expectRecipientChips } from '../../fixtures/mailRecipients'
import { trackRequests } from '../../fixtures/requests'

const RECENT: RecentRecipient[] = [
  { address: 'adh@partner.com', name: null, lastSentAt: '2026-10-24T09:00:00+09:00', sentCount: 1 },
  // 연락처에도 있는 사람 — 최근 수신인으로 한 번만 보이고 이름은 구성원 이름으로 채운다.
  { address: 'dh.yang@iacloud.kr', name: null, lastSentAt: '2026-10-23T09:00:00+09:00', sentCount: 4 },
]
const CONTACTS = contactPage([
  member({ id: 1, name: '양동희', email: 'dh.yang@iacloud.kr' }),
  member({ id: 2, name: '김도훈', email: 'dhkim@iacloud.kr' }),
  external({ id: 100, name: 'David Han', email: 'dhan@partner.co.kr' }),
])

/** 두 후보 API 를 모킹하고 요청을 기록한다 — 검색어와 상관없이 같은 목록을 준다(화면이 쓰는 조각으로 다시 거른다). */
async function mockSuggestions(page: Page) {
  const recent = trackRequests(page, 'GET', '/api/v1/mail/recent-recipients')
  const contacts = trackRequests(page, 'GET', '/api/v1/contacts')
  await mockApi(page, 'GET', '/api/v1/mail/recent-recipients', RECENT)
  await mockApi(page, 'GET', '/api/v1/contacts', CONTACTS)
  return { recent, contacts }
}

async function openCompose(page: Page) {
  await page.goto('/mail/1')
  await page.getByTestId('mail-compose-new').click()
  await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
}

/** 후보 줄마다 「이름|주소|출처」 — 이름이 없으면 「주소|출처」. */
function suggestionRows(page: Page) {
  // 장식용 아바타 첫 글자(aria-hidden)는 빼고 읽는다.
  return page.getByTestId('mail-recipient-suggestion').evaluateAll((els) =>
    els.map((el) =>
      [...el.querySelectorAll(':scope > :not([aria-hidden])')]
        .flatMap((part) => (part as HTMLElement).innerText.split('\n'))
        .map((t) => t.trim())
        .filter(Boolean)
        .join('|'),
    ),
  )
}

test.describe('메일 받는사람 자동완성 (WP-945)', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    )
  })

  test('주소 일부로 최근·구성원·주소록 후보를 찾아 키보드·마우스로 고르면 칩이 되고, 발송에는 칩 순서대로 실린다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    const { recent, contacts } = await mockSuggestions(page)
    const sends = trackRequests(page, 'POST', '/api/v1/mail/accounts/1/send')
    await mockApi(page, 'POST', '/api/v1/mail/accounts/1/send', { localMessageId: 10, messageId: 'x@test.local' })
    await openCompose(page)
    const to = page.getByTestId('mail-compose-to')

    await to.pressSequentially('dh')
    // 연락처는 쓰는 중인 조각으로 찾고, 최근 수신인은 한 번 받아 두고 브라우저에서 거른다.
    await expect.poll(() => contacts.lastUrl()?.searchParams.get('search')).toBe('dh')
    await expect.poll(() => recent.count()).toBe(1)
    // 앞부분이 맞는 후보가 먼저(그 안은 최근 → 구성원 → 주소록), 가운데만 맞는 adh 는 뒤. 같은 주소는 한 번만.
    await expect
      .poll(() => suggestionRows(page))
      .toEqual([
        '양동희|dh.yang@iacloud.kr|최근',
        '김도훈|dhkim@iacloud.kr|구성원',
        'David Han|dhan@partner.co.kr|주소록',
        'adh@partner.com|최근',
      ])
    await expect(to).toHaveAttribute('aria-expanded', 'true')

    // ↓ 로 두 번째 후보를 골라 Enter — 이름과 주소를 함께 담은 칩이 되고 칸은 비며 후보가 닫힌다.
    await to.press('ArrowDown')
    await expect(page.getByRole('option', { name: /김도훈/ })).toHaveAttribute('aria-selected', 'true')
    await to.press('Enter')
    await expectRecipientChips(page, 'to', ['김도훈 <dhkim@iacloud.kr>'])
    await expect(to).toHaveValue('')
    await expect(page.getByTestId('mail-compose-to-suggestions')).toHaveCount(0)

    // 다시 찾으면 이미 넣은 사람은 후보에서 빠진다. 마우스로 고르기.
    await to.pressSequentially('dh')
    await expect.poll(() => suggestionRows(page)).not.toContain('김도훈|dhkim@iacloud.kr|구성원')
    await page.getByRole('option', { name: /양동희/ }).click()
    await expectRecipientChips(page, 'to', ['김도훈 <dhkim@iacloud.kr>', '양동희 <dh.yang@iacloud.kr>'])
    await expect(to).toBeFocused()

    // 완성된 주소를 쳤으면 후보(그 주소를 품은 dhan@…)가 떠 있어도 Enter 는 친 주소를 넣는다.
    await to.pressSequentially('han@partner.co')
    await expect(page.getByRole('option', { name: /David Han/ })).toBeVisible()
    await to.press('Enter')
    // 후보에 없는 주소는 쉼표로 굳히고, 주소 모양이 아니면 오류 칩으로 보인다.
    await to.pressSequentially('free@x.com,')
    await to.pressSequentially('oops')
    await to.press('Tab')
    await expectRecipientChips(page, 'to', [
      '김도훈 <dhkim@iacloud.kr>',
      '양동희 <dh.yang@iacloud.kr>',
      'han@partner.co',
      'free@x.com',
      'oops',
    ])
    await expect(page.getByTestId('mail-compose-to-chip').last()).toHaveAttribute('data-invalid', 'true')
    // 최근 수신인은 여러 번 찾아도 한 번만 받았다.
    expect(recent.count()).toBe(1)

    // 빈 칸에서 Backspace 는 마지막 칩을 칸으로 되돌려 고쳐 쓰게 한다. × 는 그 칩을 뺀다.
    await to.focus()
    await to.press('Backspace')
    await expect(to).toHaveValue('oops')
    await to.fill('ok@x.com')
    // × 를 누르면 칸이 초점을 잃어 고쳐 쓴 주소도 칩으로 굳는다.
    await page.getByRole('button', { name: '김도훈 빼기' }).click()
    await expectRecipientChips(page, 'to', ['양동희 <dh.yang@iacloud.kr>', 'han@partner.co', 'free@x.com', 'ok@x.com'])

    await page.getByTestId('mail-compose-subject').fill('안녕하세요')
    await page.getByTestId('mail-compose-send').click()
    await sends.waitFor()
    expect(sends.lastBody<{ to: string[] }>()!.to).toEqual([
      '양동희 <dh.yang@iacloud.kr>',
      'han@partner.co',
      'free@x.com',
      'ok@x.com',
    ])
  })

  test('Esc 는 후보만 닫고 쓰던 글자는 남기며, 칸을 떠나면 쓰던 주소가 칩으로 굳는다 — 참조 칸도 같은 후보를 쓴다', async ({ authenticatedPage: page }) => {
    await mockSuggestions(page)
    await openCompose(page)
    await page.getByRole('button', { name: '참조/숨은참조' }).click()
    const cc = page.getByTestId('mail-compose-cc')

    await cc.pressSequentially('dh')
    await expect(page.getByTestId('mail-compose-cc-suggestions')).toBeVisible()
    await cc.press('Escape')
    await expect(page.getByTestId('mail-compose-cc-suggestions')).toHaveCount(0)
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(cc).toHaveValue('dh')

    // 다시 치면 후보가 다시 열린다.
    await cc.pressSequentially('k')
    await expect(page.getByTestId('mail-compose-cc-suggestions')).toBeVisible()

    // 고르지 않고 칸을 떠나면 쓰던 글자가 그대로 칩이 된다(후보가 제목 칸을 덮고 있어 초점만 옮긴다).
    await cc.fill('lead@example.com')
    await page.getByTestId('mail-compose-subject').focus()
    await expectRecipientChips(page, 'cc', ['lead@example.com'])
    await expect(cc).toHaveValue('')
  })
})
