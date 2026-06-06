// 받은편지함 E2E — 계정 선택·목록·검색·상세·동기화 (백엔드 없이 page.route 모킹).
import type { Page } from '@playwright/test'

import { detail, mailAccount, summary } from '../factories/mail.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

// GET /mail/accounts/1/messages — query 파라미터에 따라 분기(검색 검증).
async function stubMessages(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
    (route, req) => {
      const q = new URL(req.url()).searchParams.get('query')?.toLowerCase() ?? ''
      const all = [
        summary(),
        summary({
          id: 11,
          fromName: '밥',
          fromAddress: 'bob@example.com',
          subject: '점심 메뉴',
          snippet: '오늘 점심 뭐 드실래요',
          seen: true,
          hasAttachment: false,
        }),
      ]
      const items = q
        ? all.filter(
            (m) =>
              (m.subject ?? '').toLowerCase().includes(q) ||
              (m.fromName ?? '').toLowerCase().includes(q) ||
              (m.fromAddress ?? '').toLowerCase().includes(q),
          )
        : all
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(items),
      })
    },
  )
}

test.describe('받은편지함', () => {
  test('계정 선택·목록·상세·첨부', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail())

    // /mail → 첫 계정으로 리다이렉트(/mail/1)
    await page.goto('/mail')
    await expect(page).toHaveURL(/\/mail\/1$/)

    // 사이드바 계정 스위처에 현재 계정, 목록에 두 메시지
    await expect(page.getByTestId('mail-account-switcher')).toContainText('me@example.com')
    await expect(page.getByTestId('mail-row-10')).toBeVisible()
    await expect(page.getByTestId('mail-row-11')).toBeVisible()
    // 첨부 있는 행만 클립 — 행 10 클릭 시 상세
    await page.getByTestId('mail-row-10').click()
    const detailPanel = page.getByTestId('mail-detail')
    await expect(detailPanel).toContainText('프로젝트 회의 안내')
    await expect(detailPanel).toContainText('내일 오후 2시')
    await expect(page.getByTestId('mail-attachments')).toContainText('안건.pdf')
  })

  test('검색 → query 파라미터 전달 + 목록 필터', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await page.goto('/mail/1')

    await expect(page.getByTestId('mail-row-10')).toBeVisible()
    await expect(page.getByTestId('mail-row-11')).toBeVisible()

    // '점심' 검색 → 밥의 메일만
    await page.getByTestId('mail-search').fill('점심')
    await expect(page.getByTestId('mail-row-11')).toBeVisible()
    await expect(page.getByTestId('mail-row-10')).toHaveCount(0)
  })

  test('동기화 버튼 → sync 호출 + 토스트', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)

    let syncCalled = false
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/sync',
      (route) => {
        syncCalled = true
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ fetched: 2, saved: 2 }),
        })
      },
    )
    // 동기화 클릭 시 폴링되는 sync-status 도 스텁(미모킹 시 :9090 프록시→ECONNREFUSED).
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', {
      phase: 'IDLE',
      total: 0,
      done: 0,
      running: false,
    })

    await page.goto('/mail/1')
    await page.getByTestId('mail-sync').click()
    await expect.poll(() => syncCalled).toBe(true)
    await expect(page.getByText('새 메일 2건을 받았습니다')).toBeVisible()
  })

  test('동기화 → 진행률 폴링(BODIES) → 완료 시 진행바 사라짐', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/sync',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ fetched: 2, saved: 2 }),
        }),
    )
    // 플래그로 BODIES→IDLE 전환을 제어(폴링이 running 동안 유지되므로 진행바가 확실히 노출됨).
    let syncDone = false
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/sync-status',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            syncDone
              ? { phase: 'IDLE', total: 2, done: 2, running: false }
              : { phase: 'BODIES', total: 2, done: 1, running: true },
          ),
        }),
    )
    await page.goto('/mail/1')
    await page.getByTestId('mail-sync').click()
    await expect(page.getByTestId('mail-sync-progress')).toContainText('본문 1/2')
    syncDone = true
    await expect(page.getByTestId('mail-sync-progress')).toHaveCount(0)
  })

  test('snippet 없는 행은 미리보기 줄 생략', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    // 행 10: snippet 있음 / 행 20: snippet null
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([summary(), summary({ id: 20, snippet: null })]),
        }),
    )
    await page.goto('/mail/1')
    await expect(page.getByTestId('mail-row-20')).toBeVisible()
    // snippet 있는 행은 미리보기 노출, null 행은 미리보기 줄 생략.
    await expect(page.getByTestId('mail-snippet-10')).toBeVisible()
    await expect(page.getByTestId('mail-snippet-20')).toHaveCount(0)
  })

  test('계정 없음 안내', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [])
    await page.goto('/mail')
    await expect(page.getByTestId('mail-empty-accounts')).toBeVisible()
  })

  // #113 전폭 PageHeader(폴더명) + 좁은 화면 뒤로가기 — 800px 뷰포트에서 마스터-디테일 토글 검증.
  test('메일 전폭 헤더 + 좁은 화면 뒤로가기', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 800, height: 900 }) // lg(1024px) 미만
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail())
    await page.goto('/mail/1')
    // 전폭 헤더에 폴더명 표시
    await expect(page.getByTestId('page-header')).toContainText('받은편지함')
    // 목록에서 첫 번째 행 클릭
    const firstRow = page.getByTestId('mail-row-10')
    await firstRow.click()
    // 선택 후: 뒤로가기 버튼·상세 표시, 목록 숨김
    await expect(page.getByTestId('mail-back')).toBeVisible()
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    await expect(page.getByTestId('mail-list')).toBeHidden()
    // 뒤로가기 클릭 → 목록 복귀
    await page.getByTestId('mail-back').click()
    await expect(page.getByTestId('mail-list')).toBeVisible()
  })

  // LNB 표준화(#98) — 메일 사이드바가 표준 셸(레일과 동일 아이콘+이름 타이틀 헤더)을 갖춘다.
  test('메일 사이드바 — 표준 LNB 타이틀 헤더', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await page.goto('/mail')
    const sidebar = page.getByTestId('mail-sidebar')
    await expect(sidebar).toBeVisible()
    // h-14 앱 타이틀 헤더에 "메일"(레일 라벨과 동일) 노출 — "메일 계정" 섹션 라벨과 구분되도록 exact
    await expect(sidebar.getByText('메일', { exact: true })).toBeVisible()
  })
})
