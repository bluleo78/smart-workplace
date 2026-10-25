// 설정 › 앱 설정 › 작업 관리(WP-887) — 관리자만 보이는 「이슈 관계 유형」 관리: 목록(기본 유형 보호)·추가(미리보기·payload·이름 중복/검증 오류)·
// 편집(쓰이는 유형은 방향 잠금)·숨기기(관계 추가 창 선택지에서 사라짐)·삭제(옮기기/함께 삭제/미사용).
// 서버는 상태 있는 모킹 — 변경이 다음 GET 에 반영돼 화면이 서버 응답을 따르는지 본다.
import type { Page, Route } from '@playwright/test'

import type { IssueRelationType, IssueRelationTypeAdmin, SaveIssueRelationTypeRequest } from '../../../src/types/issue'
import { expect, test } from '../../fixtures/auth.fixture'
import { IssueRelationServer } from '../../fixtures/issueRelationServer'
import { trackRequests } from '../../fixtures/requests'

const ADMIN = '/api/v1/admin/issue-relation-types'
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** 유형 id → [이슈 사이 관계 수, 외부 링크 수]. */
type Counts = Record<number, [number, number]>

/** 관리용 API 모킹 — 공개 유형 목록(IssueRelationServer.types)과 같은 배열을 변경해 두 화면이 한 상태를 본다. */
async function installAdmin(page: Page, server: IssueRelationServer, counts: Counts = {}) {
  let nextId = 50
  const admin = (): IssueRelationTypeAdmin[] =>
    server.types.map((t) => ({ ...t, relationCount: counts[t.id]?.[0] ?? 0, externalLinkCount: counts[t.id]?.[1] ?? 0 }))
  const idOf = (r: Route) => Number(/issue-relation-types\/(\d+)/.exec(new URL(r.request().url()).pathname)?.[1])
  const nameTaken = (name: string, selfId?: number) =>
    server.types.some((t) => t.id !== selfId && t.name.toLowerCase() === name.trim().toLowerCase())

  await page.route(
    (u) => u.pathname.startsWith(ADMIN),
    (r) => {
      const req = r.request()
      const path = new URL(req.url()).pathname
      if (path === ADMIN && req.method() === 'GET') return r.fulfill(json(admin()))
      if (path === ADMIN && req.method() === 'POST') {
        const b = req.postDataJSON() as SaveIssueRelationTypeRequest
        if (nameTaken(b.name)) {
          return r.fulfill(json({ message: `이미 있는 관계 유형 이름입니다: ${b.name}`, errors: { code: 'RELATION_TYPE_NAME_TAKEN' } }, 409))
        }
        const t: IssueRelationType = {
          id: nextId++, code: null, name: b.name, directed: b.directed, outwardLabel: b.outwardLabel,
          inwardLabel: b.inwardLabel, externalOnly: false, hidden: false, sortOrder: 1000,
        }
        server.types.push(t)
        return r.fulfill(json(t))
      }
      const id = idOf(r)
      const t = server.types.find((x) => x.id === id)!
      if (path.endsWith('/hidden') && req.method() === 'PUT') {
        t.hidden = (req.postDataJSON() as { hidden: boolean }).hidden
        return r.fulfill(json(t))
      }
      if (req.method() === 'PUT') {
        const b = req.postDataJSON() as SaveIssueRelationTypeRequest
        if (nameTaken(b.name, id)) {
          return r.fulfill(json({ message: `이미 있는 관계 유형 이름입니다: ${b.name}`, errors: { code: 'RELATION_TYPE_NAME_TAKEN' } }, 409))
        }
        Object.assign(t, { name: b.name, directed: b.directed, outwardLabel: b.outwardLabel, inwardLabel: b.inwardLabel })
        return r.fulfill(json(t))
      }
      if (req.method() === 'DELETE') {
        server.types.splice(server.types.indexOf(t), 1)
        return r.fulfill({ status: 204, body: '' })
      }
      return r.fallback()
    },
  )
}

const customType = (over: Partial<IssueRelationType> = {}): IssueRelationType => ({
  id: 7, code: null, name: '테스트', directed: true, outwardLabel: '테스트 케이스', inwardLabel: '테스트 대상',
  externalOnly: false, hidden: false, sortOrder: 1000, ...over,
})

async function openPage(page: Page) {
  await page.goto('/settings/apps/work')
  await expect(page.getByTestId('work-app-settings-page')).toBeVisible()
  await expect(page.getByTestId('relation-type-row-1')).toBeVisible()
}

test.describe('설정 › 앱 설정 › 작업 관리', () => {
  test('관리자 사이드바에 「앱 설정 › 작업 관리·노트」가 있고, 기본 유형은 편집·삭제가 없고 차단은 숨길 수 없다', async ({ adminPage: page }) => {
    const server = new IssueRelationServer()
    await installAdmin(page, server)
    await page.goto('/settings/profile')
    const group = page.getByTestId('settings-apps-group')
    await expect(group.getByRole('link', { name: '작업 관리' })).toBeVisible()
    await expect(group.getByRole('link', { name: '노트' })).toBeVisible()
    await group.getByRole('link', { name: '작업 관리' }).click()
    await expect(page).toHaveURL(/\/settings\/apps\/work$/)
    await expect(group.getByRole('link', { name: '작업 관리' })).toHaveAttribute('aria-current', 'page')

    // 기본 6종이 서버 순서대로 — 차단은 「고정」, 나머지 기본 유형은 숨기기만.
    await expect(page.getByTestId('relation-type-row-1')).toContainText('차단')
    await expect(page.getByTestId('relation-type-row-1')).toContainText('고정')
    await expect(page.getByTestId('relation-type-toggle-hidden-1')).toHaveCount(0)
    await expect(page.getByTestId('relation-type-row-5')).toContainText('원인')
    await expect(page.getByTestId('relation-type-row-5')).toContainText('원인임')
    await expect(page.getByTestId('relation-type-row-5')).toContainText('결과임')
    await expect(page.getByTestId('relation-type-row-6')).toContainText('외부 링크만')
    for (const id of [1, 2, 3, 4, 5, 6]) {
      await expect(page.getByTestId(`relation-type-edit-${id}`)).toHaveCount(0)
      await expect(page.getByTestId(`relation-type-delete-${id}`)).toHaveCount(0)
    }
    await expect(page.getByTestId('relation-type-toggle-hidden-2')).toBeVisible()
  })

  test('일반 사용자에겐 「앱 설정」 그룹이 없고 직접 주소로도 들어갈 수 없다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    await expect(page.getByTestId('settings-sidebar')).toBeVisible()
    await expect(page.getByTestId('settings-apps-group')).toHaveCount(0)
    await page.goto('/settings/apps/work')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('work-app-settings-page')).toHaveCount(0)
  })

  test('유형 추가 — 미리보기 문구 → POST payload → 표에 새 줄(추가)', { tag: '@smoke' }, async ({ adminPage: page }) => {
    const server = new IssueRelationServer()
    await installAdmin(page, server)
    const posts = trackRequests(page, 'POST', ADMIN)
    await openPage(page)

    await page.getByTestId('relation-type-add').click()
    const dialog = page.getByTestId('relation-type-dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByTestId('relation-type-name').fill('테스트')
    await dialog.getByTestId('relation-type-outward').fill('테스트 케이스')
    await dialog.getByTestId('relation-type-inward').fill('테스트 대상')
    // 미리보기 — #31 이 A, #12 가 B.
    const preview = dialog.getByTestId('relation-type-preview')
    await expect(preview).toContainText('#31 에서: 테스트 케이스 · #12')
    await expect(preview).toContainText('#12 에서: 테스트 대상 · #31')
    await dialog.getByTestId('relation-type-submit').click()

    await expect.poll(() => posts.lastBody()).toEqual({
      name: '테스트', directed: true, outwardLabel: '테스트 케이스', inwardLabel: '테스트 대상',
    })
    await expect(page.getByText('관계 유형을 추가했습니다')).toBeVisible()
    await expect(dialog).toHaveCount(0)
    const row = page.getByTestId('relation-type-row-50')
    await expect(row).toContainText('테스트')
    await expect(row).toContainText('테스트 케이스')
    await expect(row).toContainText('추가')
    await expect(page.getByTestId('relation-type-edit-50')).toBeVisible()
    await expect(page.getByTestId('relation-type-delete-50')).toBeVisible()
  })

  test('방향 없음으로 만들면 말이 하나고 payload 의 inwardLabel 은 null', async ({ adminPage: page }) => {
    const server = new IssueRelationServer()
    await installAdmin(page, server)
    const posts = trackRequests(page, 'POST', ADMIN)
    await openPage(page)

    await page.getByTestId('relation-type-add').click()
    const dialog = page.getByTestId('relation-type-dialog')
    await dialog.getByTestId('relation-type-directed-false').click()
    await expect(dialog.getByTestId('relation-type-inward')).toHaveCount(0)
    await dialog.getByTestId('relation-type-name').fill('참고')
    await dialog.getByTestId('relation-type-outward').fill('참고 자료')
    await expect(dialog.getByTestId('relation-type-preview')).toContainText('#12 에서: 참고 자료 · #31')
    await dialog.getByTestId('relation-type-submit').click()
    await expect.poll(() => posts.lastBody()).toEqual({ name: '참고', directed: false, outwardLabel: '참고 자료', inwardLabel: null })
  })

  test('이름이 이미 있으면(409) 이름 칸 아래에 오류, 비어 있으면 보내지 않고 검증 문구', async ({ adminPage: page }) => {
    const server = new IssueRelationServer()
    await installAdmin(page, server)
    const posts = trackRequests(page, 'POST', ADMIN)
    await openPage(page)

    await page.getByTestId('relation-type-add').click()
    const dialog = page.getByTestId('relation-type-dialog')
    // 검증 — 빈 채로 저장.
    await dialog.getByTestId('relation-type-submit').click()
    await expect(dialog.getByText('이름을 입력해 주세요')).toBeVisible()
    expect(posts.count()).toBe(0)

    // 기본 유형 이름과 같은 이름 — 서버가 409.
    await dialog.getByTestId('relation-type-name').fill('관련')
    await dialog.getByTestId('relation-type-outward').fill('연관됨')
    await dialog.getByTestId('relation-type-inward').fill('연관함')
    await dialog.getByTestId('relation-type-submit').click()
    await expect(dialog.getByText('이미 있는 관계 유형 이름입니다: 관련')).toBeVisible()
    expect(posts.count()).toBe(1)
    await expect(dialog).toBeVisible()
    // 이름을 고치면 오류가 사라지고 다시 저장할 수 있다.
    await dialog.getByTestId('relation-type-name').fill('연관')
    await expect(dialog.getByText('이미 있는 관계 유형 이름입니다: 관련')).toHaveCount(0)
    await dialog.getByTestId('relation-type-submit').click()
    await expect(dialog).toHaveCount(0)
    expect(posts.lastBody()).toMatchObject({ name: '연관' })
  })

  test('편집 — PUT payload·표 반영, 쓰이는 유형은 방향 선택이 잠긴다', async ({ adminPage: page }) => {
    const server = new IssueRelationServer()
    server.types.push(customType({ id: 7 }), customType({ id: 8, name: '검토', outwardLabel: '검토함', inwardLabel: '검토받음' }))
    await installAdmin(page, server, { 8: [2, 0] })
    const puts = trackRequests(page, 'PUT', `${ADMIN}/7`)
    await openPage(page)

    // 쓰이는 곳 없는 유형 — 이름·말 수정.
    await page.getByTestId('relation-type-edit-7').click()
    const dialog = page.getByTestId('relation-type-dialog')
    await expect(dialog.getByTestId('relation-type-name')).toHaveValue('테스트')
    await expect(dialog.getByTestId('relation-type-directed-true')).toBeEnabled()
    await dialog.getByTestId('relation-type-name').fill('시험')
    await dialog.getByTestId('relation-type-outward').fill('시험 항목')
    await dialog.getByTestId('relation-type-submit').click()
    await expect.poll(() => puts.lastBody()).toEqual({
      name: '시험', directed: true, outwardLabel: '시험 항목', inwardLabel: '테스트 대상',
    })
    await expect(page.getByText('관계 유형을 고쳤습니다')).toBeVisible()
    await expect(page.getByTestId('relation-type-row-7')).toContainText('시험 항목')

    // 쓰이는 유형 — 방향 잠금과 이유.
    await page.getByTestId('relation-type-edit-8').click()
    await expect(dialog.getByTestId('relation-type-directed-true')).toBeDisabled()
    await expect(dialog.getByTestId('relation-type-directed-false')).toBeDisabled()
    await expect(dialog.getByTestId('relation-type-direction-locked')).toContainText('방향은 바꿀 수 없어요')
  })

  test('숨기기 → PUT hidden, 「숨김」 표시, 이슈의 관계 추가 창 선택지에서 사라지고 보이기로 돌아온다', async ({ adminPage: page }) => {
    const server = new IssueRelationServer()
    server.addIssue('WP-1', '결제 모듈')
    await server.install(page)
    await installAdmin(page, server)
    const hides = trackRequests(page, 'PUT', `${ADMIN}/3/hidden`)
    await openPage(page)

    await page.getByTestId('relation-type-toggle-hidden-3').click()
    await expect.poll(() => hides.lastBody()).toEqual({ hidden: true })
    await expect(page.getByText('관계 유형을 숨겼습니다')).toBeVisible()
    await expect(page.getByTestId('relation-type-hidden-3')).toBeVisible()
    await expect(page.getByTestId('relation-type-toggle-hidden-3')).toHaveText('보이기')

    // 이슈 화면 — 「중복임」「원본임」이 선택지에 없다.
    await page.goto('/projects/WP/issues/1')
    await page.getByTestId('property-group-relations').getByRole('button', { name: /^관계(\s*\d+)?$/ }).click()
    await page.getByTestId('issue-relation-add').click()
    await page.getByTestId('issue-relation-type-select').click()
    await expect(page.getByTestId('issue-relation-option-2:source')).toBeVisible()
    await expect(page.getByTestId('issue-relation-option-3:source')).toHaveCount(0)
    await expect(page.getByTestId('issue-relation-option-3:target')).toHaveCount(0)

    // 다시 보이기.
    await page.goto('/settings/apps/work')
    await page.getByTestId('relation-type-toggle-hidden-3').click()
    await expect.poll(() => hides.lastBody()).toEqual({ hidden: false })
    await expect(page.getByTestId('relation-type-hidden-3')).toHaveCount(0)
  })

  test('삭제 — 쓰는 관계가 없으면 확인만, DELETE 에 옵션 없음', async ({ adminPage: page }) => {
    const server = new IssueRelationServer()
    server.types.push(customType({ id: 7 }))
    await installAdmin(page, server)
    const deletes = trackRequests(page, 'DELETE', `${ADMIN}/7`)
    await openPage(page)

    await page.getByTestId('relation-type-delete-7').click()
    const dialog = page.getByTestId('relation-type-delete-dialog')
    await expect(dialog.getByTestId('relation-type-delete-summary')).toContainText('걸린 관계가 없어요')
    await expect(dialog.getByTestId('relation-type-move-target')).toHaveCount(0)
    await dialog.getByTestId('relation-type-delete-confirm').click()
    await deletes.waitFor()
    expect(deletes.lastUrl()?.search).toBe('')
    await expect(page.getByText('관계 유형을 삭제했습니다')).toBeVisible()
    await expect(page.getByTestId('relation-type-row-7')).toHaveCount(0)
  })

  test('사용 중 삭제 — 다른 유형으로 옮기기(moveTo, 기본 「관련」)', async ({ adminPage: page }) => {
    const server = new IssueRelationServer()
    server.types.push(customType({ id: 7 }))
    await installAdmin(page, server, { 7: [3, 1] })
    const deletes = trackRequests(page, 'DELETE', `${ADMIN}/7`)
    await openPage(page)
    await expect(page.getByTestId('relation-type-usage-7')).toHaveText('4건')

    await page.getByTestId('relation-type-delete-7').click()
    const dialog = page.getByTestId('relation-type-delete-dialog')
    await expect(dialog.getByTestId('relation-type-delete-summary')).toContainText('4건 있어요(외부 링크 1건 포함)')
    // 차단(id 1)·외부 전용(id 6)은 옮길 곳 후보가 아니다 — 처음 값은 「관련」.
    await expect(dialog.getByTestId('relation-type-move-target')).toContainText('관련')
    await dialog.getByTestId('relation-type-delete-confirm').click()
    await deletes.waitFor()
    expect(deletes.lastUrl()?.searchParams.get('moveTo')).toBe('2')
    expect(deletes.lastUrl()?.searchParams.has('deleteLinks')).toBe(false)
    await expect(page.getByTestId('relation-type-row-7')).toHaveCount(0)
  })

  test('사용 중 삭제 — 관계도 함께 삭제(deleteLinks=true)', async ({ adminPage: page }) => {
    const server = new IssueRelationServer()
    server.types.push(customType({ id: 7 }))
    await installAdmin(page, server, { 7: [3, 0] })
    const deletes = trackRequests(page, 'DELETE', `${ADMIN}/7`)
    await openPage(page)

    await page.getByTestId('relation-type-delete-7').click()
    const dialog = page.getByTestId('relation-type-delete-dialog')
    await dialog.getByTestId('relation-type-delete-links').click()
    await expect(dialog.getByText('3건이 이슈에서 사라져요. 되돌릴 수 없어요.')).toBeVisible()
    await dialog.getByTestId('relation-type-delete-confirm').click()
    await deletes.waitFor()
    expect(deletes.lastUrl()?.searchParams.get('deleteLinks')).toBe('true')
    expect(deletes.lastUrl()?.searchParams.has('moveTo')).toBe(false)
    await expect(page.getByTestId('relation-type-row-7')).toHaveCount(0)
  })
})
