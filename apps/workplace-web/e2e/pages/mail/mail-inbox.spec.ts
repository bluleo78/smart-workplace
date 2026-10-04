// 받은편지함 E2E — 계정 선택·목록·검색·상세·동기화 (백엔드 없이 page.route 모킹).
import type { Page } from '@playwright/test'

import type { EmailMessageDetail, MailUnreadCounts } from '../../../src/types/mailMessage'
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { expectStays, retryOnNavigation } from '../../fixtures/wait'

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

  // #699 — 행(div[role=button]) accessible name 이 발신자+제목+스니펫+AI배지까지 뒤섞여
  // 장문화되던 문제. aria-label 로 발신자+제목만 남기고 스니펫은 aria-hidden 처리했는지 검증.
  test('메일 행 accessible name — 발신자+제목만 포함(스니펫 제외) (#699)', async ({
    authenticatedPage: page,
  }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await page.goto('/mail/1')

    const row = page.getByTestId('mail-row-10')
    await expect(row).toBeVisible()
    await expect(row).toHaveAccessibleName('앨리스 프로젝트 회의 안내')

    // 스니펫 텍스트는 화면에는 보이지만 accessible name 에는 포함되지 않는다.
    const name = await row.evaluate((el) => el.getAttribute('aria-label'))
    expect(name).not.toContain('내일 오후 2시에 회의를 진행합니다')
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

  // #814 — 검색 입력이 debounce 없이 매 키 입력마다 목록 API 를 재요청하던 문제 회귀 방지.
  test('검색 입력 — 키 입력마다 목록 API가 재요청되지 않고 debounce 후 1회만 호출된다 (#814)', async ({
    authenticatedPage: page,
  }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    let requestCount = 0
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => {
        requestCount += 1
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      },
    )
    await page.goto('/mail/1')
    await expect.poll(() => requestCount).toBeGreaterThanOrEqual(1)
    const initialCount = requestCount

    // 키 입력 시뮬레이션(한 글자씩) — fill()과 달리 실제 keystroke마다 onChange 를 발생시킨다.
    await page.getByTestId('mail-search').pressSequentially('lunch', { delay: 30 })

    // debounce(300ms) 전에는 추가 요청이 없어야 한다.
    await expectStays(page, () => requestCount, initialCount, { ms: 150 })

    // debounce 이후에는 정확히 1건만 추가로 요청돼야 한다(글자 수만큼 아님).
    await expect.poll(() => requestCount, { timeout: 2000 }).toBe(initialCount + 1)
    // debounce 1회 발사 뒤 뒤늦은 추가 요청이 없어야 한다.
    await expectStays(page, () => requestCount, initialCount + 1)
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
    // 전폭 헤더에 현재 보기 표시 — 모바일 폭은 현재 보기 이름만(기본 = 업무, WP-186)
    await expect(page.getByTestId('page-header')).toContainText('업무')
    // 목록에서 첫 번째 행 클릭
    const firstRow = page.getByTestId('mail-row-10')
    await firstRow.click()
    // 모바일 셸(WP-125): 본문이 열리면 하단 탭바 숨김
    await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)
    // 선택 후: 뒤로가기 버튼·상세 표시, 목록 숨김
    await expect(page.getByTestId('mail-back')).toBeVisible()
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    await expect(page.getByTestId('mail-list')).toBeHidden()
    // 뒤로가기 클릭 → 목록 복귀
    await page.getByTestId('mobile-back').click()
    await expect(page.getByTestId('mail-list')).toBeVisible()
    await expect(page.getByTestId('mobile-tabbar')).toBeVisible()

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

    // 계정 2로 이동 후 선택 해제 — 빈 디테일 패널, DS §2.5 4요소 패턴(아이콘+제목+설명) 확인
    await expect(page).toHaveURL(/\/mail\/2/)
    const emptyState = page.getByTestId('mail-detail-empty')
    await expect(emptyState).toBeVisible()
    await expect(emptyState).toContainText('메일을 선택하세요')
    await expect(emptyState.locator('svg')).toBeVisible()
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

  // WP-65 — 본문 인라인 이미지(cid:)를 첨부 바이너리로 받아 data URI 로 치환해 렌더한다.
  // Graph 경로는 contentId 가 null 이라 파일명 매칭, 매칭 없는 cid 는 원문 유지.
  test('본문 인라인 이미지 cid: → 첨부 조회 후 data URI 로 렌더', async ({ authenticatedPage: page }) => {
    // 1x1 투명 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await mockApi(
      page,
      'GET',
      '/api/v1/mail/messages/10',
      detail({
        bodyText: null,
        bodyHtml: '<p>안내</p><img id="inline" src="cid:7dc8b642.png"><img id="missing" src="cid:none.png">',
        attachments: [
          { id: 5, filename: '7dc8b642.png', contentType: 'image/png', sizeBytes: png.length, contentId: null },
          { id: 6, filename: '안건.pdf', contentType: 'application/pdf', sizeBytes: 10, contentId: null },
        ],
      }),
    )
    const requested: string[] = []
    await page.route(
      (url) => url.pathname.startsWith('/api/v1/mail/attachments/'),
      (route, req) => {
        requested.push(new URL(req.url()).pathname)
        // octet-stream 응답도 첨부 메타 contentType(image/png)으로 보정돼야 한다
        return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: png })
      },
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()

    const frame = page.frameLocator('[data-testid="mail-body-html"]')
    await expect(frame.locator('#inline')).toHaveAttribute('src', /^data:image\/png;base64,/)
    // 실제로 이미지가 디코딩돼 로드됐는지(깨진 이미지면 naturalWidth=0)
    // srcdoc 재작성 순간의 evaluate 예외(문서 교체)는 poll 이 재시도하지 않으므로 넘겨 다시 잰다(WP-225).
    await expect
      .poll(() => retryOnNavigation(() => frame.locator('#inline').evaluate((el) => (el as HTMLImageElement).naturalWidth)))
      .toBe(1)
    await expect(frame.locator('#missing')).toHaveAttribute('src', 'cid:none.png')
    expect(requested).toEqual(['/api/v1/mail/attachments/5/content'])
    // WP-70 본문에 표시된 인라인 이미지는 첨부 목록에서 빠지고 일반 첨부만 남는다
    await expect(page.getByTestId('mail-attachment-download-6')).toBeVisible()
    await expect(page.getByTestId('mail-attachment-download-5')).toHaveCount(0)
  })

  // WP-70 — 인라인 이미지 조회가 실패하면 본문엔 표시할 수 없으므로 첨부 목록에 남겨 다운로드라도 가능해야 한다.
  test('인라인 이미지 조회 실패 시 해당 첨부는 목록에 남는다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await mockApi(
      page,
      'GET',
      '/api/v1/mail/messages/10',
      detail({
        bodyText: null,
        bodyHtml: '<p>안내</p><img id="inline" src="cid:7dc8b642.png">',
        attachments: [
          { id: 5, filename: '7dc8b642.png', contentType: 'image/png', sizeBytes: 10, contentId: null },
        ],
      }),
    )
    let calls = 0
    await page.route(
      (url) => url.pathname === '/api/v1/mail/attachments/5/content',
      (route) => {
        calls += 1
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"없음"}' })
      },
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()

    // 재시도(1회)까지 실패 확정 후 목록에 다시 노출, 본문 참조는 원문 유지
    await expect(page.getByTestId('mail-attachment-download-5')).toBeVisible({ timeout: 10_000 })
    const frame = page.frameLocator('[data-testid="mail-body-html"]')
    await expect(frame.locator('#inline')).toHaveAttribute('src', 'cid:7dc8b642.png')
    expect(calls).toBeGreaterThanOrEqual(1)
  })

  // WP-103·WP-159 — 다크 테마에서 HTML 메일은 종류와 관계없이 색 단위로 변환한다: 밝은 배경은 어둡게(흰색은 투명),
  // 어두운 글자는 밝게. 테마를 바꾸면 본문도 즉시 따라간다(html.dark class 관찰).
  test.describe('다크 테마 메일 본문', () => {
    // 다크 테마로 받은편지함을 열고 10번 메일(본문 bodyHtml)을 선택 — 본문 frame 과 요소 글자색 조회 헬퍼를 돌려준다
    async function openDarkMail(page: Page, bodyHtml: string, extra: Partial<EmailMessageDetail> = {}) {
      await page.emulateMedia({ colorScheme: 'dark' })
      await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
      await stubMessages(page)
      await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail({ bodyText: null, bodyHtml, ...extra }))
      await mockApi(page, 'GET', '/api/v1/mail/messages/11', detail({ id: 11, bodyText: null, bodyHtml }))
      await page.goto('/mail/1')
      await page.getByTestId('mail-row-10').click()
      const frame = page.frameLocator('[data-testid="mail-body-html"]')
      // 본문 iframe 은 srcdoc 를 다시 쓸 때(인라인 이미지 치환·원본/다크 전환·테마 전환) 새 문서를 띄운다 —
      // 그 순간의 evaluate 예외를 넘겨 새 문서에서 다시 잰다(WP-225).
      const computed = (selector: string, prop: 'color' | 'backgroundColor' | 'backgroundImage' | 'boxShadow') =>
        retryOnNavigation(() => frame.locator(selector).evaluate((el, p) => getComputedStyle(el)[p], prop))
      const color = (id: string) => computed(`#${id}`, 'color')
      const bg = (id: string) => computed(`#${id}`, 'backgroundColor')
      return { frame, color, bg, computed }
    }

    test('배경 없는 메일을 어둡게 변환·원본 보기 토글·라이트 전환 시 원본으로', async ({ authenticatedPage: page }) => {
      // 1x1 투명 PNG — 다크 변환 후에도 cid 인라인 이미지 치환이 유지되는지 함께 본다
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      )
      await page.route(
        (url) => url.pathname === '/api/v1/mail/attachments/5/content',
        (route) => route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: png }),
      )
      const { frame, color, bg, computed } = await openDarkMail(
        page,
        '<html><head><style>p{margin-top:0}</style></head><body>' +
          '<div id="text" style="font-size:12pt; color:rgb(0,0,0); background-color:white">안녕하세요.</div>' +
          '<span id="accent" style="color:rgb(243,112,33)">M.</span><img id="inline" src="cid:7dc8b642.png"></body></html>',
        {
          attachments: [
            { id: 5, filename: '7dc8b642.png', contentType: 'image/png', sizeBytes: png.length, contentId: null },
          ],
        },
      )

      await expect(frame.locator('#text')).toHaveText('안녕하세요.')
      // 배경은 흰색이 아닌 앱 다크 토큰, 검정 글자는 밝게, 강조 오렌지는 유지, 인라인 흰 배경은 투명으로
      await expect
        .poll(() => computed('body', 'backgroundColor'))
        .not.toMatch(/^rgba?\(255, 255, 255|^rgba\(0, 0, 0, 0\)/)
      await expect.poll(() => color('text')).toBe('rgb(237, 237, 237)')
      await expect.poll(() => color('accent')).toBe('rgb(243, 112, 33)')
      await expect.poll(() => bg('text')).toBe('rgba(0, 0, 0, 0)')
      await expect(frame.locator('#inline')).toHaveAttribute('src', /^data:image\/png;base64,/)

      // "원본 배경으로 보기" → 변환 전 원본(검정 글자, 인라인 이미지 유지), 다시 누르면 다크 변환으로
      const toggle = page.getByTestId('mail-body-theme-toggle')
      await expect(toggle).toHaveText('원본 배경으로 보기')
      await toggle.click()
      await expect(toggle).toHaveText('다크 배경으로 보기')
      await expect.poll(() => color('text')).toBe('rgb(0, 0, 0)')
      await expect(frame.locator('#inline')).toHaveAttribute('src', /^data:image\/png;base64,/)
      await toggle.click()
      await expect(toggle).toHaveText('원본 배경으로 보기')
      await expect.poll(() => color('text')).toBe('rgb(237, 237, 237)')

      // 원본 보기는 해당 메일에만 — 다른 메일을 열면 다크 기본값으로 돌아간다
      await toggle.click()
      await expect(toggle).toHaveText('다크 배경으로 보기')
      await page.getByTestId('mail-row-11').click()
      await expect(toggle).toHaveText('원본 배경으로 보기')
      await expect.poll(() => color('text')).toBe('rgb(237, 237, 237)')

      // 라이트로 전환하면 주입 스타일 없이 원본(검정 글자)으로 돌아가고, 변환이 없으므로 토글도 없다
      await page.emulateMedia({ colorScheme: 'light' })
      await expect.poll(() => color('text')).toBe('rgb(0, 0, 0)')
      await expect(page.getByTestId('mail-body-html')).not.toHaveAttribute('srcdoc', /color-scheme:dark/)
      await expect(toggle).toHaveCount(0)
    })

    // WP-159 — 형광펜·bgcolor·배경 이미지가 있어도 메일 전체를 원본(흰 바탕)으로 두지 않는다
    test('형광펜·bgcolor 뉴스레터도 다크로 변환하고 원본 보기 토글 제공', async ({ authenticatedPage: page }) => {
      const { frame, color, bg, computed } = await openDarkMail(
        page,
        '<table bgcolor="#ffffff"><tr><td id="cell" style="color:#000000">뉴스레터</td></tr></table>' +
          '<h3><font id="hl" style="background-color:rgb(255,255,0)">■ 일정/장소</font></h3>' +
          '<div id="hero" style="background:#fff url(hero.png) no-repeat">배너</div>',
      )
      await expect(frame.locator('#cell')).toHaveText('뉴스레터')
      await expect
        .poll(() => computed('body', 'backgroundColor'))
        .not.toMatch(/^rgba?\(255, 255, 255|^rgba\(0, 0, 0, 0\)/)
      await expect.poll(() => color('cell')).toBe('rgb(237, 237, 237)')
      // 형광펜은 노란색 계열로 남되 어둡게(R=G, B 낮음)
      await expect.poll(() => bg('hl')).not.toBe('rgb(255, 255, 0)')
      const [r, g, b] = (await bg('hl')).match(/\d+/g)!.map(Number)
      expect(r).toBe(g)
      expect(b).toBeLessThan(r)
      expect(r).toBeLessThan(100)
      // 배경 이미지는 그대로 두고 inset box-shadow 덮개로 어둡게, 함께 쓴 흰 배경색은 투명으로
      await expect.poll(() => bg('hero')).toBe('rgba(0, 0, 0, 0)')
      const hero = (prop: 'backgroundImage' | 'boxShadow') => computed('#hero', prop)
      await expect.poll(() => hero('backgroundImage')).toMatch(/^url\(.*hero\.png/)
      await expect.poll(() => hero('boxShadow')).toContain('inset')

      const toggle = page.getByTestId('mail-body-theme-toggle')
      await toggle.click()
      await expect(toggle).toHaveText('다크 배경으로 보기')
      await expect.poll(() => color('cell')).toBe('rgb(0, 0, 0)')
      await expect.poll(() => bg('hl')).toBe('rgb(255, 255, 0)')
    })
  })

  // WP-70 — text 본문이 표시되면 HTML(인라인 이미지)이 안 보이므로 이미지 첨부를 목록에서 숨기지 않고 조회도 하지 않는다.
  test('text 본문 표시 시 인라인 이미지 첨부는 목록에 남고 조회하지 않는다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await mockApi(
      page,
      'GET',
      '/api/v1/mail/messages/10',
      detail({
        bodyText: '안내 본문',
        bodyHtml: '<p>안내</p><img src="cid:7dc8b642.png">',
        attachments: [
          { id: 5, filename: '7dc8b642.png', contentType: 'image/png', sizeBytes: 10, contentId: null },
        ],
      }),
    )
    let fetched = false
    await page.route(
      (url) => url.pathname.startsWith('/api/v1/mail/attachments/'),
      (route) => {
        fetched = true
        return route.fulfill({ status: 200, body: '' })
      },
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()

    await expect(page.getByText('안내 본문')).toBeVisible()
    await expect(page.getByTestId('mail-attachment-download-5')).toBeVisible()
    expect(fetched).toBe(false)
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

    // 인용 원문이 새 작성 텍스트와 시각적으로 구분돼야 한다 (#685) — #765 이후 인용문은
    // 에디터 밖 MailQuoteBlock(iframe + 테두리 액자)으로 분리됐으므로 그 래퍼를 검증한다.
    // border 및 muted 배경이 적용돼 있어야 함(둘 다 0/투명이면 회귀).
    await expect(page.getByTestId('mail-compose-quote')).toBeVisible()
    await page.getByTestId('mail-compose-quote-toggle').click()
    const frame = page.getByTestId('mail-compose-quote-frame')
    await expect(frame).toBeVisible()
    const wrapper = frame.locator('..')
    const border = await wrapper.evaluate((el) => getComputedStyle(el).borderWidth)
    expect(border).not.toBe('0px')
  })
})

  // #481 — 받은편지함 리스트 툴바 좌측에 새로고침 아이콘 + 상대시간 표시.
  test('받은편지함 툴바 좌측에 새로고침 아이콘 + "N분 전 동기화됨" 표시 + 클릭 시 sync', async ({
    authenticatedPage: page,
  }) => {
    const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString()
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ lastSyncedAt: twoMinAgo })])
    await stubMessages(page)
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', {
      phase: 'IDLE', total: 0, done: 0, running: false,
    })
    let syncCalled = false
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/sync',
      (route) => { syncCalled = true; return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ fetched: 0, saved: 0 }),
      }) },
    )

    await page.goto('/mail/1')
    await expect(page.getByTestId('mail-synced-at')).toContainText('2분 전')
    await page.getByTestId('mail-sync').click()
    await expect.poll(() => syncCalled).toBe(true)
  })

  // #481 — lastSyncedAt=null 이면 회색 점+"동기화 안 됨" 표시, 녹색 점 없음.
  test('lastSyncedAt=null 이면 "동기화 안 됨" + 녹색 점 없음', async ({ authenticatedPage: page }) => {
    // 기본 mailAccount() 는 lastSyncedAt: null
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)

    await page.goto('/mail/1')

    // "동기화 안 됨" 텍스트가 표시돼야 한다.
    await expect(page.getByTestId('mail-synced-at')).toContainText('동기화 안 됨')
    // 녹색 점(bg-green-500)이 없어야 한다 — 정직 신호.
    await expect(page.locator('[data-testid="mail-synced-at"] .bg-green-500')).toHaveCount(0)
  })

  // #481 회귀 — 수동 동기화 성공 후 계정 목록(['mail-accounts'])이 무효화되어
  // 상태 텍스트가 "동기화 안 됨"→"동기화됨"으로 갱신되어야 한다. useSyncMailbox 가
  // 계정 쿼리를 무효화하지 않으면 동기화해도 stale 값이 그대로 남는다.
  test('수동 동기화 완료 후 "동기화됨"으로 갱신된다 (#481 회귀)', async ({
    authenticatedPage: page,
  }) => {
    let synced = false
    // 계정 목록: 동기화 전 lastSyncedAt=null, 동기화 후 방금 시각.
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            mailAccount({ lastSyncedAt: synced ? new Date().toISOString() : null }),
          ]),
        }),
    )
    await stubMessages(page)
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', {
      phase: 'IDLE', total: 0, done: 0, running: false,
    })
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/sync',
      (route) => {
        synced = true
        return route.fulfill({
          status: 200, contentType: 'application/json', body: JSON.stringify({ fetched: 1, saved: 1 }),
        })
      },
    )

    await page.goto('/mail/1')
    // 초기: 동기화 안 됨
    await expect(page.getByTestId('mail-synced-at')).toContainText('동기화 안 됨')
    // 동기화 클릭 → 성공 시 계정 목록 무효화 → 재조회로 "동기화됨"으로 갱신
    await page.getByTestId('mail-sync').click()
    await expect(page.getByTestId('mail-synced-at')).toContainText('동기화됨')
    await expect(page.getByTestId('mail-synced-at')).not.toContainText('동기화 안 됨')
  })

  // #181 — 메일 열람 시 목록의 해당 항목이 굵음(bold) 상태에서 일반 상태로 전환되어야 한다.
  test('메일 열람 시 목록 항목의 읽음 상태(seen)가 업데이트된다 (#181)', async ({
    authenticatedPage: page,
  }) => {
    // 회귀(#181): 메일 클릭 후 본문 열람 시 목록의 해당 항목이 굵음(font-semibold) 상태 유지.
    // WP-214: 상세 조회는 읽음 처리하지 않고(markSeen=false → seen=false 그대로 응답), 열 때 POST /read 를 따로 보내며 목록을 낙관적으로 갱신한다.
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page) // 행 10: seen=false(굵음), 행 11: seen=true

    // 상세는 지금 서버 상태(안 읽음) 그대로 응답한다 — 읽음 요청은 별도 POST 로 캡처한다.
    await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail())
    const read = await mockApi(page, 'POST', '/api/v1/mail/messages/10/read', null, { capture: true })

    await page.goto('/mail/1')

    // 클릭 전: 행 10 이 font-semibold(미읽음 bold) 상태
    await expect(page.getByTestId('mail-row-10').locator('.font-semibold')).toBeVisible()

    // 메일 클릭 → 상세 조회 → 읽음 요청 + 목록 캐시 seen=true 로 업데이트
    await page.getByTestId('mail-row-10').click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    await read.waitForRequest()

    // 열람 후: 행 10 의 font-semibold 가 사라져야 함(읽음 처리)
    await expect(page.getByTestId('mail-row-10').locator('.font-semibold')).toHaveCount(0)
  })

  // WP-155 — 안 읽은 메일은 행 왼쪽 강조 막대로 구분하고, 열람하면 막대가 사라져야 한다.
  test('안 읽은 메일 행에만 왼쪽 강조 막대 표시 + 열람 시 사라짐 (WP-155)', async ({
    authenticatedPage: page,
  }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page) // 행 10: seen=false, 행 11: seen=true
    await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail()) // WP-214: 조회는 읽음 처리하지 않아 안 읽음 그대로 응답

    await page.goto('/mail/1')

    // 안 읽은 행 10 에만 막대가 있고, 읽은 행 11 에는 없다
    await expect(page.getByTestId('mail-unread-bar-10')).toBeVisible()
    await expect(page.getByTestId('mail-unread-bar-11')).toHaveCount(0)

    // 막대는 자기 행 높이 안에만 그려져야 한다 — 행에 relative 가 없으면 바깥 컨테이너
    // 기준으로 배치되어 목록 왼쪽 전체가 파랗게 덮인다(모바일에서 발견).
    const rowBox = (await page.getByTestId('mail-row-10').boundingBox())!
    const barBox = (await page.getByTestId('mail-unread-bar-10').boundingBox())!
    expect(barBox.x).toBeCloseTo(rowBox.x, 0)
    expect(barBox.y).toBeGreaterThanOrEqual(rowBox.y - 0.5)
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 0.5)

    // 열람 → 목록 캐시 seen=true → 막대 제거
    await page.getByTestId('mail-row-10').click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    await expect(page.getByTestId('mail-unread-bar-10')).toHaveCount(0)
  })

// WP-186: 보기·안 읽은 메일만·분류 전 배지.
const counts = (over: Partial<MailUnreadCounts> = {}): MailUnreadCounts => ({
  classificationActive: true,
  inbox: 4,
  byCategory: { 업무: 2, 개인: 1, 알림: 1, 프로모션: 0, 뉴스레터: 0 },
  needsReply: 0,
  ...over,
})

async function stubCounts(page: Page) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', counts())
}

test.describe('메일 목록 — 보기·안 읽은 메일만(WP-186)', () => {
  test('헤더 = 받은편지함 › 업무, 토글 → unread=true 요청, 분류 전 배지', async ({ authenticatedPage: page }) => {
    await stubCounts(page)
    const list = await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages',
      [summary({ id: 10, categoryPending: true }), summary({ id: 11, aiCategory: '업무', seen: true })], { capture: true })
    await page.goto('/mail/1')
    await expect(page.getByTestId('page-header')).toContainText('받은편지함')
    await expect(page.getByTestId('page-header')).toContainText('업무')
    await expect(page.getByTestId('mail-badge-pending-10')).toHaveText('분류 전')
    await expect(page.getByTestId('mail-badge-pending-11')).toHaveCount(0)
    // UI 리뷰 I-1: 토글 오른쪽 끝이 목록 열(목록/상세 구분선)을 넘지 않는다.
    const toggleBox = await page.getByTestId('mail-unread-toggle').boundingBox()
    const listBox = await page.getByTestId('mail-list').boundingBox()
    expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(listBox!.x + listBox!.width - 12)
    await page.getByTestId('mail-unread-toggle').click()
    await expect(page).toHaveURL(/unread=true/)
    await expect(page.getByTestId('mail-unread-toggle')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => list.lastRequest()?.searchParams.get('unread')).toBe('true')
  })

  test('안 읽은 메일만 + 메일 열기 → 재조회에서 빠져도 목록에 남음, 보기 바꾸면 빠짐', async ({ authenticatedPage: page }) => {
    await stubCounts(page)
    let opened = false
    let listCalls = 0
    await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/messages', (route) => {
      listCalls++
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opened ? [summary({ id: 11 })] : [summary({ id: 10 }), summary({ id: 11 })]) })
    })
    await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail()) // WP-214: 조회는 읽음 처리하지 않아 안 읽음 그대로 응답
    const read = await mockApi(page, 'POST', '/api/v1/mail/messages/10/read', null, { capture: true })
    await page.clock.install()
    await page.goto('/mail/1?unread=true')
    await page.getByTestId('mail-row-10').click()
    // 앱은 상세 조회가 끝난 뒤 첫 열람 읽음 처리에서 행을 "안 읽은 메일만" 유지 집합에 넣는다.
    // 그 전에 시계를 당겨 재조회(10 이 빠진 목록)가 먼저 끝나면 넣을 행이 없어 사라지므로,
    // 읽음 요청이 나간 뒤에 재조회를 일으킨다(WP-225).
    await read.waitForRequest()
    opened = true
    const before = listCalls
    // 60초 주기 재조회(refetchInterval)를 실제로 일으킨다 — 재조회가 없으면 행이 남는 것은 당연하므로, 요청이 나갔는지 먼저 확인한다
    await page.clock.fastForward(61_000)
    await expect.poll(() => listCalls).toBeGreaterThan(before)
    await expect(page.getByTestId('mail-row-10')).toBeVisible()
    await page.getByTestId('mail-filter-category-개인').click()
    await page.getByTestId('mail-filter-category-업무').click()
    await expect(page.getByTestId('mail-row-10')).toHaveCount(0)
  })

  test('토글 off→on 으로 돌아와도 읽은 메일은 되살아나지 않는다', async ({ authenticatedPage: page }) => {
    await stubCounts(page)
    // 10 을 열기 전 unread=true 는 [10,11], 연 뒤에는 서버가 10 을 뺀다. 전체 보기는 항상 10 포함.
    let opened = false
    await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/messages', (route, req) => {
      const unread = new URL(req.url()).searchParams.get('unread') === 'true'
      const body = unread && opened ? [summary({ id: 11 })] : [summary({ id: 10 }), summary({ id: 11 })]
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail()) // WP-214: 조회는 읽음 처리하지 않아 안 읽음 그대로 응답
    const read = await mockApi(page, 'POST', '/api/v1/mail/messages/10/read', null, { capture: true })
    await page.clock.install()
    await page.goto('/mail/1?unread=true')
    await page.getByTestId('mail-row-10').click()
    // 첫 열람 읽음 처리가 토글·시계 전진 뒤로 밀리면 10 이 유지 집합에 늦게 들어가 되살아날 수 있으므로,
    // 읽음 요청이 나간 뒤에 토글을 조작한다(WP-225).
    await read.waitForRequest()
    opened = true
    await page.getByTestId('mail-unread-toggle').click() // off — 목록에 10 이 있고 prev 행에도 보관된다
    await expect(page).not.toHaveURL(/unread=true/)
    await expect(page.getByTestId('mail-row-10')).toBeVisible()
    // staleTime(30초) 이 지나야 unread=true 캐시가 낡아 다시 조회된다 — 캐시된 옛 [10,11] 이 아니라 서버 응답 기준으로 검증한다.
    await page.clock.fastForward(31_000)
    await page.getByTestId('mail-unread-toggle').click() // on 다시 — 서버가 뺀 10 이 되살아나면 안 된다
    await expect(page).toHaveURL(/unread=true/)
    await expect(page.getByTestId('mail-row-11')).toBeVisible()
    await expect(page.getByTestId('mail-row-10')).toHaveCount(0)
  })

  test('보낸편지함 — 토글·분류 전 배지 없음', async ({ authenticatedPage: page }) => {
    await stubCounts(page)
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary({ id: 10, categoryPending: true })])
    await page.goto('/mail/1?folder=sent')
    await expect(page.getByTestId('mail-row-10')).toBeVisible()
    await expect(page.getByTestId('mail-unread-toggle')).toHaveCount(0)
    await expect(page.getByTestId('mail-badge-pending-10')).toHaveCount(0)
  })

  test('보기별 빈 상태 문구', async ({ authenticatedPage: page }) => {
    await stubCounts(page)
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [])
    await page.goto('/mail/1?unread=true')
    await expect(page.getByTestId('mail-view-empty')).toContainText('업무 메일 중 안 읽은 메일이 없어요.')
  })
})
