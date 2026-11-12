// 메일 첨부 → 통합 첨부 뷰어(WP-280, 데스크톱). 모바일 배치·뒤로가기는 e2e/pages/mobile/mail-attachment-viewer-mobile.spec.ts.
// 묶음 = 한 메일의 목록 첨부(본문 인라인 이미지 제외), 다운로드는 뷰어 ⬇, ✨ 없음. ☁ 는 메일 첨부 저장(WP-1400) — 공간은 누를 때 조회해 열 때는 늘 누를 수 있다. 공유 불가라 ⋯ 는 없다.
// 남은 것: PDF 렌더·다운로드(@platform), 닫은 뒤·폴더 창 뒤 포커스 복원(@input), 오류 토스트가 뷰어 위에 쌓이는지(@layout).
// 딥링크·찾을 수 없음 안내·열 때만 받기·다른 메일 주소·조회 실패 ?preview 는 src/pages/mail/mailDetailExtras.test.tsx(vitest, WP-984)가 지킨다.
import { expect, test } from '../../fixtures/auth.fixture'
import { personalSpace } from '../../factories/drive.factory'
import { detail } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { MEMO_TEXT, stubMailWithAttachments } from '../../fixtures/mail-viewer-mock'
import { trackRequests } from '../../fixtures/requests'

test.describe('메일 첨부 뷰어', () => {
  test('상세에서 첨부를 열고 묶음 안에서 넘긴 뒤 ⬇ 로 받는다', { tag: ['@platform', '@smoke'] }, async ({ authenticatedPage: page }) => {
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

    // 메일 첨부엔 요약이 없다. ☁ 는 메일 첨부 저장(WP-1400) — 공간 조회는 누를 때 해서 열 때는 늘 누를 수 있다.
    // ⋯ 에는 ☁ 와 겹치던 저장 항목을 두지 않아(WP-1525) 공유·원본 이동이 없는 메일 첨부는 ⋯ 자체가 없다.
    // 저장 흐름(폴더 창 → save-to-drive → 위치 토스트)·조회 실패 토스트는 vitest(mailDetailExtras.test.tsx)가 지킨다.
    await expect(viewer.getByRole('button', { name: 'AI 요약' })).toHaveCount(0)
    await expect(viewer.getByRole('button', { name: '드라이브에 저장' })).toBeEnabled()
    await expect(viewer.getByRole('button', { name: '더 보기' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: '드라이브에 저장' })).toHaveCount(0)

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

  test('Esc·뒤로가기는 뷰어만 닫고 메일 상세는 남는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  // WP-1525 라이브 결함: 조회 중 ☁ 에 disabled 를 달면 Chromium 이 포커스를 body 로 떨어뜨려 폴더 창을 닫아도 ☁ 로 돌아오지 못했다.
  // 조회 중에는 aria-disabled 로만 막아 포커스가 ☁ 에 남고, 폴더 창을 닫으면 ☁ 로 돌아온다. jsdom·happy-dom 은 disabled 가 된 요소에서
  // 포커스를 빼지 않아 이 결함을 재현하지 못하므로 실제 브라우저에서 본다.
  test('키보드로 ☁ 를 누르면 조회 중에도 포커스가 ☁ 에 남고 폴더 창을 닫으면 ☁ 로 돌아온다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubMailWithAttachments(page)
    // 공간 조회 응답을 테스트가 풀 때까지 붙잡아 조회 중(busy) 상태를 시간에 기대지 않고 본다.
    let releaseSpaces: () => void = () => {}
    const spacesGate = new Promise<void>((resolve) => {
      releaseSpaces = resolve
    })
    await page.route(
      (url) => url.pathname === '/api/v1/drive/spaces',
      async (route) => {
        await spacesGate
        await route.fulfill({ json: [personalSpace({ id: 1 })] })
      },
    )
    await mockApi(page, 'GET', '/api/v1/drive/spaces/1', personalSpace({ id: 1 }))
    await mockApi(page, 'GET', '/api/v1/drive/spaces/1/items', { folders: [], files: [] })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()
    await page.getByTestId('mail-attachment-open-7').click()
    await expect(page.getByTestId('preview-body')).toContainText(MEMO_TEXT)

    // 폴더 창이 떠 있는 동안 뷰어는 aria-hidden 이라 역할 조회로는 못 찾는다 — 속성으로 집는다.
    const cloud = page.getByTestId('attachment-viewer').locator('button[aria-label="드라이브에 저장"]')
    await cloud.focus()
    await page.keyboard.press('Enter')
    // 조회 중 — aria-disabled 로 막혔지만 포커스는 ☁ 에 그대로다.
    await expect(cloud).toHaveAttribute('aria-disabled', 'true')
    await expect(cloud).toBeFocused()
    releaseSpaces()
    const picker = page.getByTestId('folder-picker')
    await expect(picker).toBeVisible()
    await expect(cloud).not.toHaveAttribute('aria-disabled')
    // 폴더 창을 닫으면 Radix 가 포커스를 연 버튼(☁)으로 돌려준다 — 뷰어는 열린 채다.
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(page.getByTestId('attachment-viewer')).toBeVisible()
    await expect(cloud).toBeFocused()
  })

  test('메일 클라이언트가 octet-stream·빈 형식으로 보낸 PDF·Markdown 도 파일명으로 미리 본다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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

  test('다운로드가 실패하면 토스트로 알리고, 받는 중 연타는 한 번만 요청한다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
    // 토스트가 뷰어(z-50) 위에 실제로 보여야 한다 — toBeVisible 은 가림을 보지 않으므로 화면 안·최상단까지 확인한다.
    const toast = page.locator('[data-sonner-toast]', { hasText: '파일을 내려받지 못했습니다' })
    await expect(toast).toBeInViewport()
    // fixture 의 에러 토스트 포인터 통과 규칙과 모달의 body pointer-events:none 이 있으면 elementFromPoint 가 토스트를 건너뛴다 —
    // 규칙을 걷어내고 판정 순간만 body 를 되돌려 쌓임 순서 그대로 읽는다(auth.fixture.ts·mobile.fixture.ts expectOnTop).
    await page.evaluate(() => document.querySelector('style[data-test-toast-passthrough]')?.remove())
    await expect
      .poll(() =>
        toast.evaluate((el) => {
          const r = el.getBoundingClientRect()
          const prev = document.body.style.pointerEvents
          document.body.style.pointerEvents = 'auto'
          try {
            return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
          } finally {
            document.body.style.pointerEvents = prev
          }
        }),
      )
      .toBe(true)
    expect(downloads.count()).toBe(1)
  })
})
