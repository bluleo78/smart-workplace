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

    // 다시 메시지 선택(디테일 노출) 후 보낸편지함으로 폴더 전환 →
    // 선택이 초기화되어 목록이 다시 보이고 뒤로가기 버튼은 숨겨져야 한다(스테일 디테일에 갇히지 않음).
    await firstRow.click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    await page.goto('/mail/1?folder=sent')
    await expect(page.getByTestId('page-header')).toContainText('보낸편지함')
    await expect(page.getByTestId('mail-list')).toBeVisible()
    await expect(page.getByTestId('mail-back')).toBeHidden()
  })

  // #474 딥링크 — ?messageId=N 직접 로드 시 해당 메시지가 선택(상세 패널에 표시)된다.
  // 리셋 effect 가 마운트 시 첫 실행을 건너뛰지 않으면 selectedId 가 null 로 덮여 실패한다.
  test('메일 — ?messageId 직접 로드 시 해당 메시지가 선택된다 (#474)', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    // 목록: 메시지 100 포함
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            summary({ id: 100, subject: '월간 보고서', snippet: '이번 달 실적을 공유합니다', seen: false }),
          ]),
        }),
    )
    // 상세: 메시지 100
    await mockApi(page, 'GET', '/api/v1/mail/messages/100', detail({ id: 100, subject: '월간 보고서', bodyText: '이번 달 실적을 공유합니다.' }))

    // 직접 로드(클릭이 아님) — 리셋 effect 회귀를 잡는다
    await page.goto('/mail/1?messageId=100')
    await expect(page.getByTestId('mail-detail')).toContainText('월간 보고서')
  })

  // #474 회귀 — 딥링크로 진입 후 계정 전환 시 이전 선택이 초기화돼야 한다.
  test('메일 — 계정 전환 시 이전 선택이 해제된다 (#474 회귀)', async ({ authenticatedPage: page }) => {
    const account2 = mailAccount({ id: 2, emailAddress: 'work@example.com' })
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount(), account2])
    // 계정 1 메시지 목록 + 상세
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            summary({ id: 100, subject: '월간 보고서', snippet: '이번 달 실적을 공유합니다', seen: false }),
          ]),
        }),
    )
    await mockApi(page, 'GET', '/api/v1/mail/messages/100', detail({ id: 100, subject: '월간 보고서', bodyText: '이번 달 실적을 공유합니다.' }))
    // 계정 2 메시지 목록(빈 목록)
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/2/messages',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        }),
    )

    // 직접 로드 → 메시지 100 선택돼 있어야 함
    await page.goto('/mail/1?messageId=100')
    await expect(page.getByTestId('mail-detail')).toContainText('월간 보고서')

    // 계정 전환: 스위처 열고 계정 2 클릭
    await page.getByTestId('mail-account-switcher').click()
    await page.getByTestId('mail-account-2').click()

    // 계정 2로 이동 후 선택 해제 — 빈 디테일 패널
    await expect(page).toHaveURL(/\/mail\/2/)
    await expect(page.getByTestId('mail-detail-empty')).toBeVisible()
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

  // #180 — 첨부 파일 다운로드 버튼이 렌더링되고 클릭 시 GET /mail/attachments/{id}/content 를 호출한다.
  test('첨부 파일 다운로드 버튼 → API 호출 + 파일 수신', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail())

    // 첨부 다운로드 엔드포인트 모킹 — 실제 바이너리 대신 1바이트 더미 + Content-Disposition 헤더
    let downloadRequestUrl = ''
    await page.route(
      (url) => url.pathname === '/api/v1/mail/attachments/1/content',
      (route, req) => {
        downloadRequestUrl = req.url()
        return route.fulfill({
          status: 200,
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': "attachment; filename*=UTF-8''%EC%95%88%EA%B1%B4.pdf",
          },
          body: Buffer.from([0x25, 0x50, 0x44, 0x46]), // '%PDF' magic bytes
        })
      },
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()

    // 다운로드 버튼이 첨부마다 존재해야 한다.
    const downloadBtn = page.getByTestId('mail-attachment-download-1')
    await expect(downloadBtn).toBeVisible()

    // 다운로드 이벤트 대기 후 버튼 클릭 — 파이프라인: 클릭 → API 호출 → Blob download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadBtn.click(),
    ])

    // GET /mail/attachments/1/content 가 호출됐는지 검증
    expect(downloadRequestUrl).toContain('/api/v1/mail/attachments/1/content')

    // 브라우저가 제안하는 파일명이 첨부 파일명과 일치하는지 검증
    expect(download.suggestedFilename()).toBe('안건.pdf')
  })

  // #265 — 답장/전체답장/전달 버튼이 shadcn Button(role=button)으로 렌더링되고 클릭 시 컴포즈 도크가 열린다.
  test('메일 상세 — 답장·전체답장·전달 버튼 shadcn Button + 답장 클릭 → 컴포즈 도크', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail())

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()

    // 각 버튼이 data-testid로 식별 가능하고 role="button" 을 가져야 한다.
    const replyBtn = page.getByTestId('mail-reply')
    const replyAllBtn = page.getByTestId('mail-reply-all')
    const forwardBtn = page.getByTestId('mail-forward')
    await expect(replyBtn).toBeVisible()
    await expect(replyAllBtn).toBeVisible()
    await expect(forwardBtn).toBeVisible()
    await expect(replyBtn).toHaveRole('button')
    await expect(replyAllBtn).toHaveRole('button')
    await expect(forwardBtn).toHaveRole('button')

    // 답장 클릭 → MailComposeContext.openCompose() → 컴포즈 도크가 열려야 한다.
    await replyBtn.click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
  })
})

  // #181 — 메일 열람 시 목록의 해당 항목이 굵음(bold) 상태에서 일반 상태로 전환되어야 한다.
  test('메일 열람 시 목록 항목의 읽음 상태(seen)가 업데이트된다 (#181)', async ({
    authenticatedPage: page,
  }) => {
    // 회귀(#181): 메일 클릭 후 본문 열람 시 목록의 해당 항목이 굵음(font-semibold) 상태 유지.
    // 수정: GET /messages/{id} 응답에 seen=true 포함 + 프론트 캐시 낙관적 업데이트.
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page) // 행 10: seen=false(굵음), 행 11: seen=true

    // seen=true 로 응답하는 상세 모킹 (백엔드가 읽음 처리 후 seen=true 반환)
    await mockApi(
      page,
      'GET',
      '/api/v1/mail/messages/10',
      { ...detail(), seen: true }, // 백엔드가 seen=true 로 마킹해 반환
    )

    await page.goto('/mail/1')

    // 클릭 전: 행 10 이 font-semibold(미읽음 bold) 상태
    await expect(page.getByTestId('mail-row-10').locator('.font-semibold')).toBeVisible()

    // 메일 클릭 → 상세 조회 → 목록 캐시 seen=true 로 업데이트
    await page.getByTestId('mail-row-10').click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()

    // 열람 후: 행 10 의 font-semibold 가 사라져야 함(읽음 처리)
    await expect(page.getByTestId('mail-row-10').locator('.font-semibold')).toHaveCount(0)
  })
