// 메일 수신인 칩 끌어놓기·칩 메뉴(WP-2150) — 완료 기준 1~7 을 실제 브라우저 입력으로 지킨다.
// 데스크톱은 포인터를 여러 번 나눠 움직여 dnd-kit 을 끌고(누른 자리에서 5px 를 넘어야 잡힌다), 모바일(390px)은
// 끌기 센서가 아예 꺼져 있어 터치는 스크롤과 메뉴만 남는다. 끌기·터치·메뉴는 jsdom 에서 잴 수 없어 전부 @input.
import type { Locator, Page } from '@playwright/test'

import { page as contactPage } from '../../factories/contacts.factory'
import { mailAccount } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { expectRecipientChips, type RecipientField } from '../../fixtures/mailRecipients'
import { centerOf, touchDrag, touchTap } from '../../fixtures/touch'
import { dropDnd, stableBox } from '../../fixtures/wait'

/** 끌기 중 강조된 칸·메뉴 항목이 함께 쓰는 이동 문구(완료 기준 3·6). */
const MOVE_LABEL: Record<RecipientField, string> = {
  to: '받는사람으로 옮기기',
  cc: '참조로 옮기기',
  bcc: '숨은참조로 옮기기',
}

/** 강조되지 않은 칸의 라벨에 뜨는 평소 칸 이름(완료 기준 3). */
const FIELD_LABEL: Record<RecipientField, string> = { to: '받는사람', cc: '참조', bcc: '숨은참조' }

/** 메일 계정·받은편지함 목록·후보 API 를 모킹한다 — 수신인 칸만 조작하기 위한 최소 셋. */
async function mockMailApis(page: Page) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await page.route(
    (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )
  // 쓰는 중인 조각이 생겨도 후보 조회는 빈 목록으로 — 오류 토스트가 칩 위에 겹치지 않게 한다.
  await mockApi(page, 'GET', '/api/v1/mail/recent-recipients', [])
  await mockApi(page, 'GET', '/api/v1/contacts', contactPage([]))
}

async function openCompose(page: Page) {
  await page.goto('/mail/1')
  await page.getByTestId('mail-compose-new').click()
  await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
}

/** 모바일 작성 화면 — 사이드바 시트의 편지쓰기로 연다(모바일 받은편지함의 새 작성 단추는 시트 안에 있다). */
async function openComposeMobile(page: Page) {
  await page.goto('/mail/1')
  await page.getByTestId('mobile-sidebar-trigger').click()
  const sheet = page.getByTestId('mobile-sidebar-sheet')
  await sheet.getByTestId('mail-compose-new').click()
  // 편지쓰기를 누르면 시트는 닫힌다(WP-578) — 아직 남아 있으면 Esc 로 닫는다(모바일 작성 스펙과 같은 처리).
  if (await sheet.isVisible()) await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
}

/** 주소를 칸에 넣어 칩으로 굳힌다 — 맨 뒤 쉼표로 즉시 굳혀 조각으로 남지 않는다. */
async function seedChips(page: Page, field: RecipientField, addresses: string[]) {
  await page.getByTestId(`mail-compose-${field}`).fill(addresses.map((a) => `${a},`).join(' '))
  await expectRecipientChips(page, field, addresses)
}

/** 놓을 자리(칸 컨테이너) — useDroppable 이 붙은 `data-field` div, 입력칸이 아니라 그 자체다. */
function fieldOf(page: Page, field: RecipientField): Locator {
  return page.getByTestId('mail-compose-dock').locator(`[data-field="${field}"]`)
}

/** 칩 이름 단추 — 끌기 시작 노드이자 메뉴 열기 단추(칩 안에서 왼쪽 글자 부분). */
function chipName(page: Page, field: RecipientField, index = 0): Locator {
  return page.getByTestId(`mail-compose-${field}-chip-menu`).nth(index)
}

/**
 * 칩 이름에서 끌기 시작 — dnd-kit PointerSensor 는 누른 자리에서 5px 를 넘게 움직여야 끌기로 잡힌다(distance: 5).
 * `locator.dragTo` 는 한 번에 움직여 안 잡히므로 포인터를 나눠 움직이고, 드래그 고스트가 뜨면 끌기 시작이다.
 */
async function startDrag(page: Page, chip: Locator) {
  const box = await stableBox(chip, '칩 이름 단추')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 8, y + 4, { steps: 4 })
  await expect(page.getByTestId('mail-compose-drag-overlay')).toBeVisible()
}

/**
 * 끌는 중 포인터를 칸 가운데로 올리고, 그 칸이 "지금 놓으면 여기" 로 그려질 때까지 다시 잰다.
 * 끌기 시작 때 참조·숨은참조가 펼쳐지며 자리가 바뀌므로 한 번에 올라가지 않을 수 있고, 렌더가 끊긴 채 놓으면
 * 옛 `over` 로 판정된다 — 칸 이름 라벨이 이동 문구로 바뀌는 순간이 곧 그 칸이 `over` 로 잡힌 순간이다.
 */
async function moveOverField(page: Page, field: RecipientField) {
  await expect(async () => {
    const box = await stableBox(fieldOf(page, field), `칸 ${field}`)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 })
    await expect(page.getByTestId(`mail-compose-${field}-drop-label`)).toHaveText(MOVE_LABEL[field], { timeout: 1_500 })
  }).toPass({ timeout: 20_000 })
}

/** 끌기를 끝낸다 — Esc 로 취소한 뒤에도 손을 떼어 마우스를 정상 상태로 되돌리고 dnd-kit 의 클릭 막힘도 풀린다. */
async function releaseDrag(page: Page) {
  await dropDnd(page)
  await expect(page.getByTestId('mail-compose-drag-overlay')).toHaveCount(0)
}

test.describe('메일 수신인 칩 옮기기 (WP-2150)', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockMailApis(page)
  })

  test('받는사람 칩을 참조 칸 위로 끌어 놓으면 받는사람에서 빠지고 참조 맨 끝에 보인다', { tag: ['@input'] }, async ({ authenticatedPage: page }) => {
    await openCompose(page)
    // 놓을 칸을 미리 펼친다 — 접힘을 펼치는 동작은 완료 기준 2 가 따로 본다.
    await page.getByRole('button', { name: '참조/숨은참조' }).click()
    await seedChips(page, 'to', ['a@x.test', 'b@x.test'])
    await seedChips(page, 'cc', ['c@x.test'])

    await startDrag(page, chipName(page, 'to', 0))
    await moveOverField(page, 'cc')
    await releaseDrag(page)

    await expectRecipientChips(page, 'to', ['b@x.test'])
    // 대상 칸 맨 끝에 붙는다(이미 있던 c@x.test 는 앞에 그대로).
    await expectRecipientChips(page, 'cc', ['c@x.test', 'a@x.test'])
    // 끌기와 메뉴가 같은 단추라, 놓은 뒤 메뉴가 따라 열리지 않는다.
    await expect(page.getByRole('menu')).toHaveCount(0)
  })

  test('참조·숨은참조가 접힌 채 끌기 시작하면 두 칸이 펼쳐지고 숨은참조에 놓으면 숨은참조로 간다', { tag: ['@input'] }, async ({ authenticatedPage: page }) => {
    await openCompose(page)
    await seedChips(page, 'to', ['a@x.test'])
    await expect(page.getByTestId('mail-compose-cc')).toHaveCount(0)
    await expect(page.getByTestId('mail-compose-bcc')).toHaveCount(0)

    await startDrag(page, chipName(page, 'to', 0))
    // 끌기 시작과 동시에 두 칸이 펼쳐진다 — 펼쳐지지 않으면 놓을 자리가 없다.
    await expect(page.getByTestId('mail-compose-cc')).toBeVisible()
    await expect(page.getByTestId('mail-compose-bcc')).toBeVisible()

    await moveOverField(page, 'bcc')
    await releaseDrag(page)
    await expectRecipientChips(page, 'to', [])
    await expectRecipientChips(page, 'bcc', ['a@x.test'])
  })

  test('끄는 동안 포인터가 올라간 칸에 「참조로 옮기기」와 강조, 나머지 칸은 점선 + 칸 이름이 보인다', { tag: ['@input'] }, async ({ authenticatedPage: page }) => {
    await openCompose(page)
    await seedChips(page, 'to', ['a@x.test'])
    await startDrag(page, chipName(page, 'to', 0))

    // 포인터가 올라간 참조: 이동 문구 라벨 + 진한 배경(지금 놓으면 여기).
    await moveOverField(page, 'cc')
    await expect(page.getByTestId('mail-compose-cc-drop-label')).toHaveText(MOVE_LABEL.cc)
    await expect(fieldOf(page, 'cc')).toHaveClass(/bg-primary\/15/)
    // 나머지 두 칸: 점선 테두리(공용 DROP_TARGET_CLASS.allowed — 칸 전체를 감싸는 outline) + 평소 칸 이름(강조 배경은 없다).
    await expect(page.getByTestId('mail-compose-to-drop-label')).toHaveText(FIELD_LABEL.to)
    await expect(fieldOf(page, 'to')).toHaveClass(/outline-dashed/)
    await expect(fieldOf(page, 'to')).not.toHaveClass(/bg-primary\/15/)
    await expect(page.getByTestId('mail-compose-bcc-drop-label')).toHaveText(FIELD_LABEL.bcc)
    await expect(fieldOf(page, 'bcc')).toHaveClass(/outline-dashed/)
    await expect(fieldOf(page, 'bcc')).not.toHaveClass(/bg-primary\/15/)

    // 포인터를 숨은참조로 옮기면 강조도 그 칸으로 따라간다.
    await moveOverField(page, 'bcc')
    await expect(page.getByTestId('mail-compose-bcc-drop-label')).toHaveText(MOVE_LABEL.bcc)
    await expect(fieldOf(page, 'bcc')).toHaveClass(/bg-primary\/15/)
    await expect(page.getByTestId('mail-compose-cc-drop-label')).toHaveText(FIELD_LABEL.cc)

    // 끌기를 끝내면 라벨·강조는 사라지고 값은 그대로다(Esc 로 취소).
    await page.keyboard.press('Escape')
    await releaseDrag(page)
    await expect(page.getByTestId('mail-compose-cc-drop-label')).toHaveCount(0)
    await expectRecipientChips(page, 'to', ['a@x.test'])
  })

  test('칸 밖에 놓거나 Esc 를 누르면 칩이 원래 자리에 그대로 있다', { tag: ['@input'] }, async ({ authenticatedPage: page }) => {
    await openCompose(page)
    await seedChips(page, 'to', ['a@x.test', 'b@x.test'])
    const same = ['a@x.test', 'b@x.test']

    // 칸 밖(제목 칸)에 놓는다 — 제목은 놓을 자리가 아니므로 아무 일도 없다.
    await startDrag(page, chipName(page, 'to', 0))
    // 받는사람 칸이 강조를 벗어난 순간이 곧 앱이 "칸 밖" 으로 판정한 순간이다 — 그 뒤에 손을 떼어 결과를 본다.
    await expect(async () => {
      const box = await stableBox(page.getByTestId('mail-compose-subject'), '제목 칸')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 })
      await expect(page.getByTestId('mail-compose-to-drop-label')).toHaveText(FIELD_LABEL.to, { timeout: 1_500 })
    }).toPass({ timeout: 20_000 })
    await releaseDrag(page)
    // 어느 칸에도 가지 않고 제자리여야 한다(완료 기준 4) — 칸 밖은 놓을 자리가 아니라 받는사람·참조 어디에도 남지 않는다.
    await expectRecipientChips(page, 'cc', [])
    await expectRecipientChips(page, 'to', same)

    // 같은 칸에 놓는다 — 옮길 곳이 자기 자리라 그대로다.
    await startDrag(page, chipName(page, 'to', 0))
    await moveOverField(page, 'to')
    await releaseDrag(page)
    await expectRecipientChips(page, 'to', same)

    // 남의 칸 위에서 Esc 로 끌기를 취소한다 — 놓기 전에 취소했으므로 값은 그대로여야 한다.
    await startDrag(page, chipName(page, 'to', 0))
    await moveOverField(page, 'cc')
    await page.keyboard.press('Escape')
    await releaseDrag(page)
    await expectRecipientChips(page, 'to', same)
    await expectRecipientChips(page, 'cc', [])
  })

  test('대상 칸에 같은 주소가 있으면 놓은 뒤 대상에 하나만 남는다', { tag: ['@input'] }, async ({ authenticatedPage: page }) => {
    await openCompose(page)
    await page.getByRole('button', { name: '참조/숨은참조' }).click()
    await seedChips(page, 'to', ['dup@x.test', 'other@x.test'])
    await seedChips(page, 'cc', ['dup@x.test'])

    await startDrag(page, chipName(page, 'to', 0))
    await moveOverField(page, 'cc')
    await releaseDrag(page)

    // 받는사람에서는 빠지고, 참조에는 이미 있던 주소 하나만 남는다(같은 주소가 두 칸에 남지 않는다).
    await expectRecipientChips(page, 'to', ['other@x.test'])
    await expectRecipientChips(page, 'cc', ['dup@x.test'])
  })

  test('놓을 칸에 쉼표 없이 치던 조각이 남아도, 칩을 놓은 뒤 그 글자가 입력에 그대로다', { tag: ['@input'] }, async ({ authenticatedPage: page }) => {
    await openCompose(page)
    await page.getByRole('button', { name: '참조/숨은참조' }).click()
    await seedChips(page, 'to', ['a@x.test'])
    // 참조 칸에 쉼표 없는 조각을 친다 — 칩 단추 누름은 포인터 preventDefault 로 초점을 옮기지 않으니, 끄는 동안에도
    // 칸을 떠나지 않고 blur 로 미리 굳지 않는다(받는사람에서 끌 때도 같은 상태다).
    await page.getByTestId('mail-compose-cc').fill('par')

    await startDrag(page, chipName(page, 'to', 0))
    await moveOverField(page, 'cc')
    await releaseDrag(page)

    // 칩은 참조 맨 끝에 붙고, 치던 조각은 입력에 그대로다 — 조각까지 칩으로 다시 나누면 빨간 칩이 되어 입력이 비다(WP-2150 반려).
    await expectRecipientChips(page, 'cc', ['a@x.test'])
    await expect(page.getByTestId('mail-compose-cc')).toHaveValue('par')
    await expectRecipientChips(page, 'to', [])
  })

  test('조각이 든 칸에서 × 로 칩을 빼도 치던 글자가 입력에 그대로다', { tag: ['@input'] }, async ({ authenticatedPage: page }) => {
    await openCompose(page)
    await page.getByRole('button', { name: '참조/숨은참조' }).click()
    await seedChips(page, 'to', ['a@x.test', 'b@x.test'])
    // 쉼표 없는 조각을 친다 — × 를 누르면 초점은 칩으로 옮지만 칸을 떠나지 않으므로 조각이 칩으로 미리 굳지 않는다(WP-2150 반려).
    await page.getByTestId('mail-compose-to').fill('par')

    await page.getByRole('button', { name: 'a@x.test 빼기' }).click()

    await expectRecipientChips(page, 'to', ['b@x.test'])
    await expect(page.getByTestId('mail-compose-to')).toHaveValue('par')
  })

  test('칩 이름을 누르면 메뉴가 열리고 「참조로 옮기기」로 같은 결과가 된다. × 는 바로 뺀다', { tag: ['@input'] }, async ({ authenticatedPage: page }) => {
    await openCompose(page)
    await seedChips(page, 'to', ['a@x.test', 'b@x.test'])
    // 참조 칸은 아직 접혀 있다 — 끌기와 같은 결과를 보려면 옮긴 칸이 보여야 한다(완료 기준 6).
    await expect(page.getByTestId('mail-compose-cc')).toHaveCount(0)

    await chipName(page, 'to', 0).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: MOVE_LABEL.cc, exact: true }).click()

    // 끌어놓기와 같은 결과: 받는사람에서 빠지고 접혀 있던 참조 칸이 펼쳐져 옮긴 칩이 보인다.
    await expectRecipientChips(page, 'to', ['b@x.test'])
    await expect(page.getByTestId('mail-compose-cc')).toBeVisible()
    await expectRecipientChips(page, 'cc', ['a@x.test'])
    await expect(menu).toHaveCount(0)

    // × 는 메뉴를 열지 않고 그 자리에서 바로 뺀다.
    await page.getByRole('button', { name: 'b@x.test 빼기' }).click()
    await expectRecipientChips(page, 'to', [])
    await expect(page.getByRole('menu')).toHaveCount(0)
  })

  test.describe('모바일 390px (완료 기준 7)', () => {
    // 끌기 센서 판정(폭 < 1024)은 미디어 쿼리라 뷰포트만 390 으로 좁혀도 꺼진다 — 터치가 실 입력이라 hasTouch.
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('모바일(390px)에서 칩을 누르면 같은 메뉴로 옮겨지고, 칩을 끌어도 화면이 스크롤만 된다', { tag: ['@input'] }, async ({ authenticatedPage: page }) => {
      await openComposeMobile(page)
      const addresses = Array.from({ length: 14 }, (_, i) => `person${i}@example.com`)
      await seedChips(page, 'to', addresses)

      const chip = page.getByTestId('mail-compose-to-chip').first()
      // 칩을 감싼 세로 스크롤러의 scrollTop — 화면이 움직였는지 숫자로 본다(없으면 -1).
      const scrollTop = () =>
        chip.evaluate((el) => {
          for (let n: Element | null = el; n; n = n.parentElement) {
            const box = n as HTMLElement
            const overflowY = getComputedStyle(box).overflowY
            if ((overflowY === 'auto' || overflowY === 'scroll') && box.scrollHeight > box.clientHeight + 8) return box.scrollTop
          }
          return -1
        })
      // 스크롤할 자리가 있는지 먼저 본다 — 넘치지 않는 화면에서는 끌기가 스크롤로 응답할 수 없다.
      const beforeTop = await scrollTop()
      expect(beforeTop, '작성 화면이 세로로 넘쳐야 칩 끌기가 스크롤로 응답한다').toBeGreaterThan(-1)

      // 칩 이름을 손으로 위로 끌어본다 — 끌기가 시작되면 고스트가 뜨고 칩이 옮겨지므로 둘 다 없어야 한다(기준 7).
      const before = await stableBox(chip, '칩(끌기 전)')
      const start = await centerOf(chipName(page, 'to', 0))
      const dy = Math.max(60, Math.min(120, start.y - 16))
      await touchDrag(page, start, { x: start.x, y: start.y - dy }, { steps: 10, stepDelayMs: 30, settleMs: 60 })
      const after = await stableBox(chip, '칩(끌기 뒤)')
      const afterTop = await scrollTop()
      expect(
        Math.abs(after.y - before.y),
        `손을 끌면 화면이 스크롤해야 한다 — scrollTop ${beforeTop} → ${afterTop}`,
      ).toBeGreaterThan(40)
      await expect(page.getByTestId('mail-compose-drag-overlay')).toHaveCount(0)
      await expectRecipientChips(page, 'to', addresses)
      // 끌기 중에 메뉴가 떠서는 안 된다 — 모바일은 끌기가 아니라 메뉴로만 옮기기 때문이고, 뜨면 스크롤만 하려는 손이 메뉴에 갇힌다(완료 기준 7).
      await expect(page.getByRole('menu')).toHaveCount(0)

      await touchTap(page, await centerOf(chipName(page, 'to', 1)))
      const menu = page.getByRole('menu')
      await expect(menu).toBeVisible()
      await menu.getByRole('menuitem', { name: MOVE_LABEL.cc, exact: true }).click()
      // 데스크톱 메뉴와 같은 결과 — 모바일에서도 접혀 있던 참조 칸이 펼쳐져 옮긴 칩이 보인다.
      await expect(page.getByTestId('mail-compose-cc')).toBeVisible()
      await expectRecipientChips(page, 'to', addresses.filter((_, i) => i !== 1))
      await expectRecipientChips(page, 'cc', [addresses[1]])
    })
  })
})
