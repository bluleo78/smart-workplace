// 노트 본문 앱 링크 칩 E2E(WP-1147) — 동기화 서버에서 온 본문의 이슈·노트 주소가 보는 사람 권한의 카드 API 결과로 그 자리의 칩이 되고,
// 볼 수 없는 대상은 원래 링크로 남으며, 칩을 누르면 앱 안에서 이동한다. 어느 글자가 칩이 되는지·커서가 닿으면 드러나는지는
// src/components/wiki/wikiAppLinkChips.test.ts 가 지킨다.
import type { Page } from '@playwright/test'

import type { AppLinkCard } from '../../../src/api/appLinks'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockWikiMentions, mockWikiPageEditor, openWikiEditor, savedMarkdown } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 431

const ISSUE_CARD: AppLinkCard = {
  kind: 'ISSUE',
  title: '로그인 오류 고치기',
  issueKey: 'WP-12',
  statusName: '진행 중',
  statusCategory: 'IN_PROGRESS',
  assignees: [],
  priority: 'MID',
}

async function open(page: Page, body: string, role: 'OWNER' | 'VIEWER') {
  await mockWikiMentions(page, PAGE_ID, [])
  await page.route('**/api/v1/app-links/issues/WP/12', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ISSUE_CARD) }))
  // 볼 수 없는 노트 — 서버는 없음과 같은 404 를 준다.
  await page.route('**/api/v1/app-links/pages/45', (r) =>
    r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ status: 404, message: 'Not Found' }) }))
  await mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title: '앱 링크', body, role })
  await openWikiEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, readOnly: role === 'VIEWER' })
}

test('본문의 이슈 주소는 칩(키·제목)으로, 볼 수 없는 노트 주소는 원래 링크로 — 칩을 누르면 이슈 화면으로 간다', { tag: '@platform' }, async ({
  authenticatedPage: page,
  baseURL,
}) => {
  const issueUrl = `${baseURL}/projects/WP/issues/12`
  const pageUrl = `${baseURL}/wiki/spaces/3/pages/45`
  const body = `이슈 ${issueUrl} 확인\n\n노트 [${pageUrl}](${pageUrl})`
  await open(page, body, 'VIEWER')

  const chip = page.getByTestId('wiki-app-link-chip')
  await expect(chip).toHaveCount(1)
  await expect(chip).toHaveText('WP-12로그인 오류 고치기')
  await expect(chip).toHaveAttribute('title', '이슈 WP-12 로그인 오류 고치기 · 진행 중')
  // 원래 주소 글자는 숨고, 볼 수 없는 노트는 링크 그대로 보인다.
  await expect(page.locator('.ProseMirror [data-app-link-src]', { hasText: issueUrl })).toBeHidden()
  await expect(page.locator('.ProseMirror [data-app-link-src]')).toHaveCount(1)
  await expect(page.locator('.ProseMirror a', { hasText: pageUrl })).toBeVisible()
  // 본문(동기화 문서)은 주소 그대로다 — 칩은 화면에만 있다.
  expect(await savedMarkdown(page, PAGE_ID)).toContain(issueUrl)

  await chip.click()
  await page.waitForURL('**/projects/WP/issues/12')
})
