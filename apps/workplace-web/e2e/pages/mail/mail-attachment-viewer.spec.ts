// 메일 첨부 → 통합 첨부 뷰어(WP-280, 데스크톱). 모바일 배치·뒤로가기는 e2e/pages/mobile/mail-attachment-viewer-mobile.spec.ts.
// 묶음 = 한 메일의 목록 첨부(본문 인라인 이미지 제외), 다운로드는 뷰어 ⬇, ✨·☁·⋯ 없음.
import { expect, test } from '../../fixtures/auth.fixture'
import { detail } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { MEMO_TEXT, stubMailWithAttachments } from '../../fixtures/mail-viewer-mock'
import { trackRequests } from '../../fixtures/requests'

test.describe('메일 첨부 뷰어', () => {
  test('상세에서 첨부를 열고 묶음 안에서 넘긴 뒤 ⬇ 로 받는다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    const contents = await stubMailWithAttachments(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()

    // 인라인 이미지(5)는 본문에 쓰여 목록에서 빠지고 PDF·텍스트만 칩으로 남는다.
    await expect(page.getByTestId('mail-attachment-open-6')).toBeVisible()
    await expect(page.getByTestId('mail-attachment-open-5')).toHaveCount(0)

    await page.getByTestId('mail-attachment-open-6').click()
    const viewer = page.getByTestId('attachment-viewer')
    await expect(viewer).toBeVisible()
    await expect(viewer).toHaveAccessibleName('안건.pdf 미리보기')
    // 열림은 URL ?preview=mail:{id} — 메일 상세(?messageId)는 그대로 둔다.
    await expect(page).toHaveURL(/\/mail\/1\?messageId=10&preview=mail%3A6$/)
    await expect(page.getByTestId('pdf-page-1')).toBeVisible()
    await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')

    // 메일 첨부엔 요약·드라이브 가져오기가 없고, 공유 불가라 ⋯ 메뉴 자체가 없다.
    await expect(viewer.getByRole('button', { name: 'AI 요약' })).toHaveCount(0)
    await expect(viewer.getByRole('button', { name: '드라이브로 가져오기' })).toHaveCount(0)
    await expect(viewer.getByRole('button', { name: '더 보기' })).toHaveCount(0)

    // 다음 = 텍스트 첨부(형식 파라미터·대소문자가 섞여도 텍스트로 미리 본다), 마지막이라 › 는 숨는다.
    await expect(page.getByRole('button', { name: '이전 파일' })).toHaveCount(0)
    await page.getByRole('button', { name: '다음 파일' }).click()
    await expect(page.getByTestId('preview-body')).toContainText(MEMO_TEXT)
    await expect(page.getByTestId('preview-meta')).toContainText('2 / 2')
    await expect(page.getByTestId('viewer-live')).toHaveText('memo.txt, 2개 중 2번째')
    await expect(page).toHaveURL(/preview=mail%3A7$/)
    await expect(page.getByRole('button', { name: '다음 파일' })).toHaveCount(0)

    // ⬇ — 미리보기로 이미 받은 blob 을 메타 파일명으로 저장한다(같은 파일을 다시 받지 않는다).
    const fetchedBefore = contents.count()
    const download = page.waitForEvent('download')
    await page.getByTestId('preview-download').click()
    expect((await download).suggestedFilename()).toBe('memo.txt')
    expect(contents.count()).toBe(fetchedBefore)

    // 이전으로 돌아가 PDF 를 다시 본다.
    await page.getByRole('button', { name: '이전 파일' }).click()
    await expect(page.getByTestId('pdf-page-1')).toBeVisible()
    await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
  })

  test('Esc·뒤로가기는 뷰어만 닫고 메일 상세는 남는다', async ({ authenticatedPage: page }) => {
    await stubMailWithAttachments(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()
    await page.getByTestId('mail-attachment-open-7').click()
    await expect(page.getByTestId('preview-body')).toContainText(MEMO_TEXT)

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
    await expect(page).toHaveURL(/\/mail\/1\?messageId=10$/)
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    // 닫으면 연 칩으로 포커스가 돌아간다.
    await expect(page.getByTestId('mail-attachment-open-7')).toBeFocused()

    await page.getByTestId('mail-attachment-open-7').click()
    await expect(page.getByTestId('attachment-viewer')).toBeVisible()
    await page.goBack()
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
    await expect(page).toHaveURL(/\/mail\/1\?messageId=10$/)
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    // 히스토리로 닫혀도(onOpenChange 없이 언마운트) 연 칩으로 포커스가 돌아간다.
    await expect(page.getByTestId('mail-attachment-open-7')).toBeFocused()
  })

  test('딥링크 — 있는 첨부는 바로 열리고, 이 메일에 없는 첨부는 찾을 수 없음 안내', async ({ authenticatedPage: page }) => {
    await stubMailWithAttachments(page)
    await page.goto('/mail/1?messageId=10&preview=mail:7')
    await expect(page.getByTestId('preview-body')).toContainText(MEMO_TEXT)
    await expect(page.getByTestId('preview-meta')).toContainText('2 / 2')

    await page.goto('/mail/1?messageId=10&preview=mail:99')
    await expect(page.getByTestId('preview-not-found')).toBeVisible()
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  })

  test('칩을 그리기만 해서는 첨부를 받지 않는다 — 열 때만 받는다', async ({ authenticatedPage: page }) => {
    const contents = await stubMailWithAttachments(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()
    await expect(page.getByTestId('mail-attachment-open-6')).toBeVisible()
    // 인라인 이미지(5) 치환 조회만 나간다.
    await expect.poll(() => contents.urls().map((u) => u.pathname)).toEqual(['/api/v1/mail/attachments/5/content'])

    await page.getByTestId('mail-attachment-open-7').click()
    await expect(page.getByTestId('preview-body')).toContainText(MEMO_TEXT)
    expect(contents.urls().map((u) => u.pathname)).toContain('/api/v1/mail/attachments/7/content')
  })

  test('메일 클라이언트가 octet-stream·빈 형식으로 보낸 PDF·Markdown 도 파일명으로 미리 본다', async ({ authenticatedPage: page }) => {
    await stubMailWithAttachments(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-12').click()
    await page.getByTestId('mail-attachment-open-8').click()
    // 응답 헤더도 octet-stream 이지만 확장자(.PDF)로 PDF 렌더러가 그린다.
    await expect(page.getByTestId('pdf-page-1')).toBeVisible()
    await expect(page.getByTestId('pdf-document').locator('canvas')).toHaveCount(3)

    await page.getByRole('button', { name: '다음 파일' }).click()
    await expect(page.getByTestId('preview-meta')).toContainText('2 / 2')
    await expect(page.getByTestId('preview-body').getByRole('heading', { name: '설치 안내' })).toBeVisible()
    await expect(page.getByTestId('preview-body')).not.toContainText('미리 볼 수 없어요')
  })

  test('다른 메일 URL 로 바뀌면 앞 메일 첨부를 계속 보여 주지 않고 찾을 수 없음 안내', async ({ authenticatedPage: page }) => {
    await stubMailWithAttachments(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()
    await page.getByTestId('mail-attachment-open-6').click()
    await expect(page.getByTestId('pdf-page-1')).toBeVisible()

    // 손으로 고친 URL(메일만 11 로 바꾸고 ?preview 는 그대로)을 앱 안 내비게이션으로 재현 — 새로고침 없이 같은 화면 인스턴스가 받는다.
    await page.evaluate(() => {
      window.history.pushState(window.history.state, '', '/mail/1?messageId=11&preview=mail:6')
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    })
    await expect(page.getByTestId('preview-not-found')).toBeVisible()
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  })

  test('메일 없이·메일 조회 실패로 남은 ?preview 는 찾을 수 없음 안내 후 닫으면 지운다', async ({ authenticatedPage: page }) => {
    await stubMailWithAttachments(page)
    await page.goto('/mail/1?preview=mail:7')
    await expect(page.getByTestId('preview-not-found')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('preview-not-found')).toHaveCount(0)
    await expect(page).toHaveURL(/\/mail\/1$/)

    await mockApi(page, 'GET', '/api/v1/mail/messages/13', { message: '없음' }, { status: 404 })
    await page.goto('/mail/1?messageId=13&preview=mail:7')
    await expect(page.getByText('메일을 불러오지 못했습니다')).toBeVisible()
    await expect(page.getByTestId('preview-not-found')).toBeVisible()
  })

  test('다운로드가 실패하면 토스트로 알리고, 받는 중 연타는 한 번만 요청한다', async ({ authenticatedPage: page }) => {
    await stubMailWithAttachments(page)
    // 미리보기가 없는 형식(zip)이라 ⬇ 가 서버에서 다시 받는다 — 그 요청이 500.
    await mockApi(page, 'GET', '/api/v1/mail/messages/14', detail({
      id: 14,
      attachments: [{ id: 20, filename: 'archive.zip', contentType: 'application/zip', sizeBytes: 10, contentId: null }],
    }))
    const downloads = trackRequests(page, 'GET', '/api/v1/mail/attachments/20/content')
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    await page.route(
      (url) => url.pathname === '/api/v1/mail/attachments/20/content',
      async (route) => {
        await gate
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"오류"}' })
      },
    )
    await page.goto('/mail/1?messageId=14&preview=mail:20')
    await expect(page.getByTestId('preview-body')).toContainText('이 형식은 미리 볼 수 없어요')

    // 응답 전 헤더 ⬇ 두 번 + 본문 다운로드 한 번 → 요청은 한 번.
    await page.getByTestId('preview-download').click()
    await page.getByTestId('preview-download').click()
    await page.getByTestId('preview-body').getByRole('button', { name: /다운로드/ }).click()
    await downloads.waitFor(1)
    release()
    await expect(page.getByText('파일을 내려받지 못했습니다')).toBeVisible()
    expect(downloads.count()).toBe(1)
  })
})
