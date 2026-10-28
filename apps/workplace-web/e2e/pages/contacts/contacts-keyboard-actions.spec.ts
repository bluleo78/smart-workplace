// 마우스 데스크톱의 연락처 행 동작을 키보드로도 쓴다(WP-844).
// 내 그룹 행 ⋯(WP-978 전엔 수정·삭제 아이콘). 예전엔 hover 때만 생겨(display:none) Tab 순서에 없었고, 목록 행 ☆ 는 초점을 받아도 투명했다.
// 투명도는 transition 이 있어 toHaveCSS 가 끝값이 될 때까지 기다린다.
// 실제 Tab 초점 이동·포인터 이탈과 :focus-visible 계열 CSS 투명도는 jsdom 이 판정할 수 없어 모두 @input 으로 남는다.
import type { Page } from '@playwright/test'

import { external, page as makePage } from '../../factories/contacts.factory'
import { personalDetail, personalNode, tree } from '../../factories/userGroups.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** 연락처 목록·그룹 트리·내 그룹 상세 스텁. */
async function stub(page: Page) {
  await page.route((u) => u.pathname === '/api/v1/contacts', (r) => r.fulfill(json(makePage([external()]))))
  await page.route((u) => u.pathname === '/api/v1/user-groups', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(tree())) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/user-groups/20', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(personalDetail())) : r.fallback())
}

test('내 그룹 — 키보드로 그룹 이름에 오면 ⋯ 가 나타나고 Tab·Enter 로 메뉴를 열어 수정 창을 연다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stub(page)
  await page.goto('/contacts')
  const name = page.getByTestId('group-node-20')
  await expect(name).toBeVisible()
  // 평소엔 투명 — 마우스를 올리거나 행에 초점이 올 때만 보인다(WP-978: 수정·삭제는 행 ⋯ 메뉴 안).
  const more = page.getByTestId('group-more-20')
  await expect(more).toHaveCSS('opacity', '0')

  // 바로 앞 버튼(「내 그룹」 머리의 새 그룹)에서 Tab — 마우스 없이 키보드로 그룹 이름에 초점을 준다.
  // 하위 그룹이 없는 노드엔 접기 버튼이 없어(WP-923) 머리 버튼에서 출발한다.
  await page.getByTestId('group-create').focus()
  await page.keyboard.press('Tab')
  await expect(name).toBeFocused()
  await expect(more).toHaveCSS('opacity', '1')

  await page.keyboard.press('Tab')
  await expect(more).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('group-edit-20')).toBeVisible()
  await expect(page.getByTestId('group-delete-20')).toBeVisible()
  await page.getByTestId('group-edit-20').press('Enter')
  await expect(page.getByTestId('group-form-dialog')).toBeVisible()
})

test('내 그룹 — 마우스로 누른 뒤 포인터가 떠나면 ⋯ 는 다시 숨는다(키보드 초점일 때만 남는다)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stub(page)
  await page.goto('/contacts')
  const more = page.getByTestId('group-more-20')
  await page.getByTestId('group-node-20').click()
  await expect(page.getByTestId('group-node-20')).toBeFocused()
  await page.mouse.move(900, 700)
  await expect(more).toHaveCSS('opacity', '0')
  // 안 보이는 동안은 눌리지 않는다.
  await expect(more).toHaveCSS('pointer-events', 'none')
})

test('하위 그룹을 키보드로 ⋯ → 삭제하면 초점이 body 로 빠지지 않고 부모 노드로 간다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  // 내 분류(20) 아래 하위(21). 삭제 뒤 트리 조회는 하위가 빠진 트리를 돌려준다.
  let deleted = false
  const withChild = tree({ personal: [personalNode({ children: [personalNode({ id: 21, name: '하위 분류', parentId: 20 })] })] })
  await page.route((u) => u.pathname === '/api/v1/contacts', (r) => r.fulfill(json(makePage([external()]))))
  await page.route((u) => u.pathname === '/api/v1/user-groups', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(deleted ? tree() : withChild)) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/user-groups/21', (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback()
    deleted = true
    return r.fulfill({ status: 204, body: '' })
  })
  await page.goto('/contacts')

  // 하위 노드 이름에 초점 → Tab 으로 ⋯ → Enter 로 메뉴를 열고 「삭제」.
  await page.getByTestId('group-node-21').focus()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('group-more-21')).toBeFocused()
  await page.keyboard.press('Enter')
  await page.getByTestId('group-delete-21').press('Enter')
  const confirm = page.getByTestId('group-delete-confirm-btn')
  await expect(confirm).toBeVisible()
  await confirm.press('Enter')

  await expect(page.getByTestId('group-node-21')).toHaveCount(0)
  await expect(page.getByTestId('group-delete-confirm')).toHaveCount(0)
  // ⋯ 트리거가 있던 행은 사라졌다 — 초점은 남은 부모 노드에 있어야 한다(body 가 아니라).
  await expect(page.getByTestId('group-node-20')).toBeFocused()
})

test('연락처 목록 — ☆ 는 키보드 초점을 받으면 보이고 Enter 로 즐겨찾기한다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stub(page)
  const posts = trackRequests(page, 'POST', '/api/v1/contacts/favorites')
  await page.route((u) => u.pathname === '/api/v1/contacts/favorites', (r) =>
    r.request().method() === 'POST' ? r.fulfill({ status: 204, body: '' }) : r.fallback())
  await page.goto('/contacts')

  const fav = page.getByTestId('contact-fav-EXTERNAL-100')
  await expect(fav).toHaveCSS('opacity', '0')
  await page.getByTestId('contact-row-EXTERNAL-100').locator('button').first().focus()
  await page.keyboard.press('Tab')
  await expect(fav).toBeFocused()
  await expect(fav).toHaveCSS('opacity', '1')

  await page.keyboard.press('Enter')
  await posts.waitFor()
  expect(posts.lastBody()).toMatchObject({ targetType: 'EXTERNAL', targetId: 100 })
})

// WP-1085 — 저장 중 「저장」을 disabled 로 끄면 초점이 body 로 빠져, 이어 뜬 중복 경고를 닫거나 강행 저장이 실패한 뒤 돌아올 곳이 없었다.
// 경고를 취소·Esc 로 닫아도, 「그래도 추가」가 실패해도 열린 채 남는 폼의 「저장」에 초점이 있어야 한다.
// 꺼진 버튼에서 초점이 빠지는 것은 실제 브라우저만 재현한다(jsdom 은 초점을 그대로 둔다).
for (const close of ['Escape', '취소'] as const) {
  test(`외부 연락처 중복 경고를 ${close === 'Escape' ? 'Esc' : '「취소」'}로 닫으면 초점이 폼의 「저장」으로 돌아온다`, { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stub(page)
    await page.route((u) => u.pathname === '/api/v1/contacts/external', (r) =>
      r.request().method() === 'POST'
        ? r.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ status: 409, error: 'Conflict', message: '이미 존재하는 연락처입니다: 중복 테스트', errors: null, path: '/api/v1/contacts/external' }),
          })
        : r.fallback())
    await page.goto('/contacts')
    await page.getByTestId('contact-create').click()
    await page.getByTestId('c-name').fill('중복 테스트')
    await page.getByTestId('c-email').fill('DUP@x.com')
    await page.getByTestId('c-save').focus()
    await page.keyboard.press('Enter')

    const warning = page.getByTestId('contact-duplicate-dialog')
    await expect(warning).toBeVisible()
    if (close === 'Escape') await page.keyboard.press('Escape')
    else await warning.getByRole('button', { name: '취소' }).click()

    await expect(warning).toBeHidden()
    await expect(page.getByTestId('external-contact-dialog')).toBeVisible()
    await expect(page.getByTestId('c-save')).toBeFocused()
    // 입력값은 그대로 — 고쳐서 다시 저장할 수 있다.
    await expect(page.getByTestId('c-name')).toHaveValue('중복 테스트')
  })
}

test('외부 연락처 중복 경고에서 「그래도 추가」가 실패해도 초점이 폼의 「저장」에 남는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stub(page)
  await page.route((u) => u.pathname === '/api/v1/contacts/external', (r) => {
    if (r.request().method() !== 'POST') return r.fallback()
    const force = new URL(r.request().url()).searchParams.get('force') === 'true'
    return r.fulfill({
      status: force ? 500 : 409,
      contentType: 'application/json',
      body: JSON.stringify({
        status: force ? 500 : 409,
        error: force ? 'Internal Server Error' : 'Conflict',
        message: force ? '서버 오류' : '이미 존재하는 연락처입니다: 중복 테스트',
        errors: null,
        path: '/api/v1/contacts/external',
      }),
    })
  })
  await page.goto('/contacts')
  await page.getByTestId('contact-create').click()
  await page.getByTestId('c-name').fill('중복 테스트')
  await page.getByTestId('c-email').fill('DUP@x.com')
  await page.getByTestId('c-save').focus()
  await page.keyboard.press('Enter')

  const warning = page.getByTestId('contact-duplicate-dialog')
  await expect(warning).toBeVisible()
  const forced = page.waitForResponse((r) => r.url().includes('force=true'))
  await page.getByTestId('contact-duplicate-confirm').focus()
  await page.keyboard.press('Enter')
  await forced

  await expect(warning).toBeHidden()
  await expect(page.getByTestId('external-contact-dialog')).toBeVisible()
  await expect(page.getByTestId('c-save')).toBeFocused()
})
