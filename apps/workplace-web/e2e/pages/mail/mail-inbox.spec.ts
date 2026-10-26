// 받은편지함 E2E — 화면 배선(@wiring)과 브라우저가 필요한 것만 남긴다(백엔드 없이 page.route 모킹).
// 좁은 화면 마스터-디테일·다크 본문 색·막대/토글/인용 액자 기하(@layout), 다운로드·iframe 이미지 디코딩·새 탭 링크(@platform).
// 목록·검색(디바운스)·계정 안내·딥링크·계정 전환·읽음 반영·동기화·보기/안 읽은 메일만·빈 상태는
// src/pages/mail/mailInbox.test.tsx(vitest, WP-984)가 지킨다.
import type { Page } from '@playwright/test'

import type { EmailMessageDetail } from '../../../src/types/mailMessage'
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { expectThinScrollbar, retryOnNavigation } from '../../fixtures/wait'

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
  test('계정 선택·목록·상세·첨부', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
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

  // #113 전폭 PageHeader(폴더명) + 좁은 화면 뒤로가기 — 800px 뷰포트에서 마스터-디테일 토글 검증.
  test('메일 전폭 헤더 + 좁은 화면 뒤로가기', { tag: ['@layout', '@smoke'] }, async ({ authenticatedPage: page }) => {
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

  // #180·WP-280 — 첨부 칩은 뷰어를 열고, 뷰어 ⬇ 가 GET /mail/attachments/{id}/content 로 받아 첨부 파일명으로 저장한다.
  test('첨부 칩 → 뷰어 ⬇ 다운로드 → API 호출 + 파일 수신', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail())

    // 첨부 다운로드 엔드포인트 모킹 — 실제 바이너리 대신 1바이트 더미 + Content-Disposition 헤더
    const downloads = trackRequests(page, 'ANY', '/api/v1/mail/attachments/1/content')
    await page.route(
      (url) => url.pathname === '/api/v1/mail/attachments/1/content',
      (route) => {
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

    // 첨부 칩을 누르면 뷰어가 열린다(다운로드는 뷰어 ⬇ 가 맡는다).
    await page.getByTestId('mail-attachment-open-1').click()
    await expect(page.getByTestId('attachment-viewer')).toBeVisible()
    const downloadBtn = page.getByTestId('preview-download')

    // 다운로드 이벤트 대기 후 버튼 클릭 — 파이프라인: 클릭 → API 호출 → Blob download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadBtn.click(),
    ])

    // GET /mail/attachments/1/content 가 호출됐는지 검증
    expect(downloads.count()).toBeGreaterThan(0)

    // 브라우저가 제안하는 파일명이 첨부 파일명과 일치하는지 검증
    expect(download.suggestedFilename()).toBe('안건.pdf')
  })

  // WP-65 — 본문 인라인 이미지(cid:)를 첨부 바이너리로 받아 data URI 로 치환해 렌더한다.
  // Graph 경로는 contentId 가 null 이라 파일명 매칭, 매칭 없는 cid 는 원문 유지.
  test('본문 인라인 이미지 cid: → 첨부 조회 후 data URI 로 렌더', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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
    const attachments = trackRequests(page, 'ANY', (url) => url.pathname.startsWith('/api/v1/mail/attachments/'))
    await page.route(
      (url) => url.pathname.startsWith('/api/v1/mail/attachments/'),
      (route) => {
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
    expect(attachments.urls().map((u) => u.pathname)).toEqual(['/api/v1/mail/attachments/5/content'])
    // WP-70 본문에 표시된 인라인 이미지는 첨부 목록에서 빠지고 일반 첨부만 남는다
    await expect(page.getByTestId('mail-attachment-open-6')).toBeVisible()
    await expect(page.getByTestId('mail-attachment-open-5')).toHaveCount(0)
  })

  // WP-427 — 본문 링크가 iframe 안에서 열리면 SharePoint 등 프레임 표시를 거부하는 사이트는 '연결할 수 없음'이 된다.
  // 링크는 새 탭(opener 없음)에서 열리고 본문은 그대로 남아야 한다. 문서가 자기 base target 을 둬도 마찬가지.
  test('본문 링크는 새 탭에서 열리고 본문 프레임은 그대로다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    const shareUrl = 'https://contoso.sharepoint.com/:w:/r/sites/team/doc.docx'
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await mockApi(
      page,
      'GET',
      '/api/v1/mail/messages/10',
      detail({
        bodyText: null,
        bodyHtml: `<html><head><base target="_self"></head><body><p id="intro">공유 문서</p><a id="share" href="${shareUrl}">문서 열기</a></body></html>`,
      }),
    )
    // 실제 SharePoint 처럼 프레임 표시를 거부하는 응답 — iframe 안에서 열리면 '연결할 수 없음'이 된다.
    await page.context().route(
      (url) => url.hostname === 'contoso.sharepoint.com',
      (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', headers: { 'x-frame-options': 'DENY' }, body: '<p>SharePoint</p>' }),
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()
    const frame = page.frameLocator('[data-testid="mail-body-html"]')

    const popupPromise = page.waitForEvent('popup')
    await frame.locator('#share').click()
    const popup = await popupPromise
    await popup.waitForLoadState()
    expect(popup.url()).toBe(shareUrl)
    // target=_blank 는 noopener 를 함축 — 연 사이트가 본문 프레임을 조작할 수 없다.
    expect(await popup.evaluate(() => window.opener)).toBeNull()
    await expect(popup.locator('p')).toHaveText('SharePoint')
    // 본문 프레임은 이동하지 않았다.
    await expect(frame.locator('#intro')).toHaveText('공유 문서')
  })

  // WP-103·WP-159 — 다크 테마에서 HTML 메일은 종류와 관계없이 색 단위로 변환한다: 밝은 배경은 어둡게(흰색은 투명),
  // 어두운 글자는 밝게. 테마를 바꾸면 본문도 즉시 따라간다(html.dark class 관찰).
  test.describe('다크 테마 메일 본문', { tag: '@layout' }, () => {
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
      // WP-275: 다크 변환(재직렬화)된 본문에도 슬림 스크롤바가 주입된다 — srcDoc 은 앱 CSS 를 상속하지 않는다.
      await expectThinScrollbar(frame, '#text')

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

  // #685 — 인용 원문은 새 작성 텍스트와 시각적으로 구분돼야 한다. #765 이후 인용문은 에디터 밖 MailQuoteBlock(iframe + 테두리 액자)이라
  // 그 래퍼의 계산된 테두리를 잰다(jsdom 은 CSS 를 계산하지 않는다). 버튼 역할·도크 열림은 mailInbox.test.tsx 가 본다.
  test('답장 인용문 액자에 테두리가 그려진다 (#685)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail())

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()
    await page.getByTestId('mail-reply').click()
    await page.getByTestId('mail-compose-quote-toggle').click()
    const frame = page.getByTestId('mail-compose-quote-frame')
    await expect(frame).toBeVisible()
    const border = await frame.locator('..').evaluate((el) => getComputedStyle(el).borderWidth)
    expect(border).not.toBe('0px')
  })

  // WP-155 — 안 읽은 막대는 자기 행 높이 안에만 그려져야 한다. 행에 relative 가 없으면 바깥 컨테이너 기준으로 배치되어
  // 목록 왼쪽 전체가 파랗게 덮인다(모바일에서 발견). 막대 유무·열람 뒤 사라짐은 mailInbox.test.tsx 가 본다.
  test('안 읽은 막대가 자기 행 안에만 그려진다 (WP-155)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page) // 행 10: seen=false

    await page.goto('/mail/1')
    const rowBox = (await page.getByTestId('mail-row-10').boundingBox())!
    const barBox = (await page.getByTestId('mail-unread-bar-10').boundingBox())!
    expect(barBox.x).toBeCloseTo(rowBox.x, 0)
    expect(barBox.y).toBeGreaterThanOrEqual(rowBox.y - 0.5)
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 0.5)
  })

  // UI 리뷰 I-1(WP-186) — 「안 읽은 메일만」 토글 오른쪽 끝이 목록 열(목록/상세 구분선)을 넘지 않는다.
  // 헤더 문구·분류 전 배지·unread=true 요청은 mailInbox.test.tsx 가 본다.
  test('안 읽은 메일만 토글이 목록 열 경계를 넘지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await stubMessages(page)
    await page.goto('/mail/1')
    const toggleBox = await page.getByTestId('mail-unread-toggle').boundingBox()
    const listBox = await page.getByTestId('mail-list').boundingBox()
    expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(listBox!.x + listBox!.width - 12)
  })
})
