// 설정 › 앱 설정 › 작업 관리(WP-887) — 관리자만 보이는 「이슈 관계 유형」 관리: 목록(기본 유형 보호)·추가(미리보기·payload·이름 중복/검증 오류)·
// 편집(쓰이는 유형은 방향 잠금)·숨기기(관계 추가 창 선택지에서 사라짐)·삭제(옮기기/함께 삭제/미사용).
// 서버는 상태 있는 모킹 — 변경이 다음 GET 에 반영돼 화면이 서버 응답을 따르는지 본다.
// 여기엔 유형 추가 배선(@wiring)과 숨긴 유형이 이슈 관계 추가 창에서 사라지는 흐름(@flow)만 남는다. 기본 유형 보호·방향 없음 payload·
// 검증·409·편집·방향 잠금·숨기기·삭제 세 경우는 src/pages/settings/apps/workAppSettings.test.tsx, 사이드바·관리자 가드는
// src/pages/settings/settingsNav.test.tsx 가 지킨다.
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

async function openPage(page: Page) {
  await page.goto('/settings/apps/work')
  await expect(page.getByTestId('work-app-settings-page')).toBeVisible()
  await expect(page.getByTestId('relation-type-row-1')).toBeVisible()
}

test.describe('설정 › 앱 설정 › 작업 관리', () => {
  test('유형 추가 — 미리보기 문구 → POST payload → 표에 새 줄(추가)', { tag: ['@wiring', '@smoke'] }, async ({ adminPage: page }) => {
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

  test('숨기기 → PUT hidden, 「숨김」 표시, 이슈의 관계 추가 창 선택지에서 사라지고 보이기로 돌아온다', { tag: '@flow' }, async ({ adminPage: page }) => {
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
})
