// 하단 탭바 겹침(WP-806) — 휴대폰 탭 루트 화면에서 여는 대화상자·선택 창·드롭다운이 하단 탭바에 가리지 않는다.
// 대화상자는 탭바 위 영역 가운데에 놓이고 높이도 그 안으로 줄어(넘치면 안에서 스크롤), 팝오버·선택 창·메뉴는 탭바를 화면 끝처럼 피해
// 위로 뒤집힌다. 데스크톱(탭바 없음)은 그대로다. 캘린더 일정 창(WP-801)은 calendar-agenda.spec ⑧-3·⑧-4 가 맡는다.
import type { Locator, Page } from '@playwright/test'

import { page as contactsPage } from '../../factories/contacts.factory'
import { draftDetail, mailAccount, summary } from '../../factories/mail.factory'
import { tree } from '../../factories/userGroups.factory'
import { mockApi } from '../../fixtures/api-mock'
import { installFakeViewport, setKeyboard } from '../../fixtures/keyboard'
import { mockDraftServer } from '../../fixtures/mail-drafts-mock'
import {
  expect,
  expectAboveTabBar,
  expectCenteredAboveTabBar,
  stubChat,
  tabBarTop,
  test,
} from '../../fixtures/mobile.fixture'

/** 스크롤 컨테이너를 움직여 trigger 의 아래끝을 탭바 위끝에서 gap(px) 위에 둔다 — 아래 공간이 "화면 끝까지는 넉넉, 탭바까지는 부족"한 자리. */
async function placeAboveTabBar(page: Page, trigger: Locator, gap: number) {
  const navTop = await tabBarTop(page)
  await trigger.evaluate((el, target) => {
    let scroller: HTMLElement | null = el.parentElement
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
      scroller = scroller.parentElement
    }
    if (!scroller) throw new Error('스크롤 컨테이너 없음')
    scroller.scrollTop += el.getBoundingClientRect().bottom - target
  }, navTop - gap)
  const b = (await trigger.boundingBox())!
  expect(Math.abs(b.y + b.height - (navTop - gap))).toBeLessThan(2)
}

test.describe('390×664 — 낮은 화면', () => {
  test.use({ viewport: { width: 390, height: 664 } })

  test('연락처 — 새 외부 연락처 창은 탭바 위 가운데, 끝까지 내리면 저장이 탭바 위, 공개 범위 선택 창도 탭바 위', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await page.route((u) => u.pathname === '/api/v1/contacts', (r) => r.fulfill({ json: contactsPage([]) }))
    await page.route((u) => u.pathname === '/api/v1/user-groups', (r) => r.fulfill({ json: tree() }))
    await page.goto('/contacts')
    await page.getByTestId('contact-create').click()
    const dialog = page.getByTestId('external-contact-dialog')
    await expect(dialog).toBeVisible()
    await expectCenteredAboveTabBar(page, dialog)

    await dialog.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
    const save = page.getByTestId('c-save')
    await expect(save).toBeInViewport({ ratio: 1 })
    await expectAboveTabBar(page, save)

    // 창 맨 아래 칸의 선택 창 — 화면 끝 기준으로 펼치면 탭바 자리까지 내려온다.
    await page.getByTestId('c-visibility').click()
    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()
    await expectAboveTabBar(page, listbox)
    await listbox.getByRole('option', { name: '공유' }).click()
    await expect(page.getByTestId('c-visibility')).toHaveText('공유')
  })

  test('연락처 — 키보드가 열려도(탭바는 키보드 바로 위에 남는다) 새 외부 연락처 창은 탭바 위 가운데, 저장도 탭바 위', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    // 헤드리스엔 가상 키보드가 없어 visualViewport 를 가짜로 바꿔 키보드를 흉내 낸다(keyboard.spec 과 같은 방식) — goto 전에 설치.
    await installFakeViewport(page)
    await page.route((u) => u.pathname === '/api/v1/contacts', (r) => r.fulfill({ json: contactsPage([]) }))
    await page.route((u) => u.pathname === '/api/v1/user-groups', (r) => r.fulfill({ json: tree() }))
    await page.goto('/contacts')
    await page.getByTestId('contact-create').click()
    const dialog = page.getByTestId('external-contact-dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('input').first().focus()
    const visible = await setKeyboard(page, true)
    await expect(page.locator(':root')).toHaveAttribute('data-keyboard-open', 'true')
    // 셸이 보이는 높이로 줄어 탭바가 키보드 바로 위로 올라왔는지 — 탭바가 남아 있어야 이 단언이 의미가 있다.
    const bar = page.getByTestId('mobile-tabbar')
    await expect.poll(async () => Math.round((await bar.boundingBox())!.y + (await bar.boundingBox())!.height)).toBe(visible)
    // 보이는 영역 중 탭바 위 부분의 가운데 — 보이는 영역 전체 가운데면 아래끝·저장 버튼이 탭바에 겹쳤다.
    await expectCenteredAboveTabBar(page, dialog)
    await dialog.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
    await expectAboveTabBar(page, page.getByTestId('c-save'))
  })

  test('자체 스크롤 창은 스크롤이 한 겹이고 닫기 X 가 제자리 — overflow-hidden 창은 바깥 스크롤을 강제하지 않는다', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await stubChat(page)
    await page.goto('/apps')
    await page.getByTestId('apps-account').click()
    await page.getByTestId('apps-whats-new').click()
    const dialog = page.getByTestId('whats-new-dialog')
    await expect(dialog).toBeVisible()
    await expectCenteredAboveTabBar(page, dialog)
    // 새 소식 창은 제목 줄을 고정하고 본문만 안에서 스크롤한다 — 소식 길이는 릴리스마다 달라 본문에 긴 내용을 붙여 넘치게 한다.
    await dialog.evaluate((root) => {
      const body = root.querySelector<HTMLElement>('.overflow-y-auto')
      if (!body) throw new Error('본문 스크롤 영역 없음')
      body.append(Object.assign(document.createElement('div'), { style: 'height: 2000px' }))
    })
    const close = dialog.locator('[data-slot="dialog-close"]')
    const closeTop = (await close.boundingBox())!.y
    const scrollers = () =>
      dialog.evaluate((root) =>
        [root, ...root.querySelectorAll<HTMLElement>('*')].filter(
          (el) => el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY),
        ).length,
      )
    expect(await scrollers(), '스크롤 영역은 본문 하나').toBe(1)
    await dialog.evaluate((root) => {
      for (const el of root.querySelectorAll<HTMLElement>('*')) el.scrollTop = el.scrollHeight
      root.scrollTop = root.scrollHeight
    })
    expect((await close.boundingBox())!.y, '닫기 X 는 제자리').toBe(closeTop)

    // 창 자체를 overflow-hidden 으로 둔 창(개인 작업 모달·명령 창처럼 안쪽 영역이 스크롤을 맡는 창)은 높이 상한만 받고
    // overflow 는 그 창 값(hidden) 그대로 — 바깥까지 auto 로 바꾸면 스크롤이 두 겹이 되고 머리·닫기 X 가 밀려 올라간다.
    const style = await dialog.evaluate((el) => {
      el.classList.add('overflow-hidden')
      const cs = getComputedStyle(el)
      return { overflowY: cs.overflowY, maxHeight: parseFloat(cs.maxHeight) }
    })
    const navTop = await tabBarTop(page)
    expect(style.overflowY).toBe('hidden')
    expect(style.maxHeight).toBeLessThanOrEqual(navTop - 32 + 1)
  })

  test('메일 — 모두 읽음 확인 창(AlertDialog)도 탭바 위 가운데', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await stubChat(page)
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary({ id: 10, seen: false })])
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages/unread-count', { count: 1, asOf: '2026-10-03T01:00:00Z' })
    await page.goto('/mail/1')
    await page.getByTestId('mail-mark-all-read').click()
    const dialog = page.getByTestId('mail-mark-all-dialog')
    await expect(dialog).toBeVisible()
    await expectCenteredAboveTabBar(page, dialog)
    await expectAboveTabBar(page, page.getByTestId('mail-mark-all-cancel'))
  })
})

test('메일 임시보관함 — 탭바 바로 위 행의 ⋯ 메뉴는 탭바 밑으로 펼치지 않고 위로 뒤집힌다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [])
  const drafts = Array.from({ length: 20 }, (_, i) => draftDetail({ id: i + 1, subject: `임시저장 ${i + 1}` }))
  await mockDraftServer(page, drafts)
  await page.goto('/mail/1?folder=drafts')
  const trigger = page.getByTestId('mail-draft-menu-12')
  await expect(trigger).toBeVisible()
  // 아래로 화면 끝까지는 메뉴(약 80px)가 들어가지만 탭바까지는 모자라는 자리.
  await placeAboveTabBar(page, trigger, 40)
  await trigger.click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expectAboveTabBar(page, menu)
  // 위로 뒤집혀 트리거 위에 붙는다.
  expect((await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThanOrEqual((await trigger.boundingBox())!.y)
  await expect(page.getByTestId('mail-draft-open-12')).toBeVisible()
})

test('메일 임시보관함 — 탭바 없는 화면에 갔다가 뒤로 돌아와도(캐시로 바로 그림) ⋯ 메뉴가 탭바를 피한다', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  // 돌아올 때 목록은 캐시로 탭바와 같은 커밋에 그려진다 — 탭바 높이를 렌더 때 한 번만 읽으면 0(탭바 없던 화면 값)에 머문다.
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [])
  await mockDraftServer(page, Array.from({ length: 20 }, (_, i) => draftDetail({ id: i + 1, subject: `임시저장 ${i + 1}` })))
  await page.goto('/mail/1?folder=drafts')
  await expect(page.getByTestId('mail-draft-menu-12')).toBeVisible()
  await page.getByTestId('mobile-bell').click()
  await expect(page).toHaveURL(/\/notifications$/)
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)
  await page.goBack()
  const trigger = page.getByTestId('mail-draft-menu-12')
  await expect(trigger).toBeVisible()
  await placeAboveTabBar(page, trigger, 40)
  await trigger.click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expectAboveTabBar(page, menu)
})

test('앱 — 새 소식 창은 탭바 위 가운데', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  await page.getByTestId('apps-account').click()
  await page.getByTestId('apps-whats-new').click()
  const dialog = page.getByTestId('whats-new-dialog')
  await expect(dialog).toBeVisible()
  await expectCenteredAboveTabBar(page, dialog)
})
