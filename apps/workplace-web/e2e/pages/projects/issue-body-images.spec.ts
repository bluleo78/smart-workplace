// 이슈 본문 이미지(WP-199) E2E — 브라우저가 있어야 판정되는 것만 남긴다.
// 클립보드 붙여넣기·파일 드롭과 업로드 중 막힘·실패 롤백(@input), 인증 blob 이미지의 실제 디코딩·미리보기(@platform),
// 미리보기를 닫는 키·클릭이 편집으로 번지지 않음(@input).
// 이미지 버튼 업로드 → 본문 끝 마크다운, 지워진 이미지(404) 대체 문구, 복원된 초안의 업로드 중 토큰 저장 안내는
// 페이지 테스트 src/pages/projects/issueBodyImages.test.tsx 가 지킨다(WP-980).
// 상세 편집칸(WP-1656)·생성 다이얼로그 본문 칸(WP-1657)은 본문 모드 RichInput — 이미지는 칸 안 그림이고 원문 마크다운은 저장·생성 요청에서 본다.
import type { Page } from '@playwright/test'

import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory'
import { systemTypes } from '../../factories/issueType.factory'
import { createProject } from '../../factories/project.factory'

const KEY = 'WP'
const IMG_URL = `/api/v1/projects/${KEY}/issue-images/77`
// 1x1 투명 PNG — 실제 디코딩돼 naturalWidth > 0 이 되어야 한다.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

// 업로드는 지연 응답 — "업로드 중 등록 비활성" 을 관찰할 시간을 준다. release() 로 응답을 흘려보낸다.
async function stubUpload(page: Page) {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  await page.route(`**/api/v1/projects/${KEY}/issue-images`, async (route) => {
    await gate
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ fileId: 77, url: IMG_URL, name: 'bug.png', mimeType: 'image/png', size: 70 }),
    })
  })
  await page.route(`**${IMG_URL}`, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  return { release: () => release() }
}

// 클립보드 이미지 붙여넣기 — 텍스트 없음(순수 이미지 복사).
async function pasteImage(page: Page, selector: string) {
  await page.locator(selector).evaluate((el) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'bug.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  })
}

async function stubProjectList(page: Page) {
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject())
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues`, createIssueSearchResponse([createIssue()]))
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/types`,
    (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(systemTypes()) }),
  )
  await page.route(`**/api/v1/projects/${KEY}/**`, (route) => {
    const u = route.request().url()
    if (route.request().method() === 'GET' && !u.includes('/issues') && !u.includes('/issue-images')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return route.fallback()
  })
}

// 이슈 상세 화면 공통 스텁 — attachments.spec.ts 의 setupCommonStubs 를 본문(body) 지정 가능하게 복사.
async function setupDetailStubs(page: Page, body: string) {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  )
  await page.route(`**/api/v1/projects/${KEY}/members`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues/1`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssueDetail({
            summary: createIssue({ id: 1, number: 1, title: '본문 이미지 대상' }),
            body,
            comments: [],
            history: [],
            attachments: [],
          }),
        ),
      })
    },
  )
  for (const sub of ['watchers', 'labels', 'drive-links']) {
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${KEY}/issues/1/${sub}`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
  }
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/labels`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
}

test.describe('이슈 본문 이미지 — 생성 다이얼로그', () => {
  test('붙여넣은 이미지가 업로드되어 본문에 들어가고, 업로드 중에는 등록이 막힌다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubProjectList(page)
    const upload = await stubUpload(page)
    const creates = trackRequests(page, 'POST', `/api/v1/projects/${KEY}/issues`)
    await page.route(`**/api/v1/projects/${KEY}/issues`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(createIssue({ number: 9 })) })
    })

    await page.goto(`/projects/${KEY}`)
    // 기존 issue-create-validation.spec.ts 의 다이얼로그 여는 방식과 동일하게 연다.
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    const dialog = page.getByRole('dialog', { name: '새 이슈' })
    await dialog.getByLabel('제목').fill('로그인 버튼 깨짐')
    // 본문 칸은 본문 모드 편집칸(WP-1657) — 붙여넣은 이미지는 칸 안에 자리표시 → 그림으로 보인다.
    const editor = dialog.getByTestId('issue-body')
    await pasteImage(page, '[data-testid="issue-body"]')

    await expect(editor.getByTestId('rich-image')).toHaveText('업로드 중…')
    await expect(dialog.getByRole('button', { name: /^생성$/ })).toBeDisabled()

    upload.release()
    await expect(editor.getByTestId('rich-image').locator('img')).toHaveAttribute('src', /^blob:/)

    await dialog.getByRole('button', { name: /^생성$/ }).click()
    // 보내는 본문은 다듬지 않은 원문 그대로(정확히 일치) — 이미지 줄과, 이미지 뒤에 커서가 놓이도록 본문 모드가 붙인 빈 줄의 줄바꿈 하나.
    await expect.poll(() => creates.lastBody<{ body: string }>()?.body).toBe(`![bug.png](${IMG_URL})\n`)
  })

  // 본문 모드 붙여넣기는 일반 글자를 줄 단위 그대로 넣는다 — 빈 줄이 사라지거나 한 줄로 합쳐지면 보내는 원문이 달라진다.
  test('여러 줄 글자 붙여넣기는 빈 줄까지 그대로 보낸다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubProjectList(page)
    const creates = trackRequests(page, 'POST', `/api/v1/projects/${KEY}/issues`)
    await page.route(`**/api/v1/projects/${KEY}/issues`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(createIssue({ number: 9 })) })
    })

    await page.goto(`/projects/${KEY}`)
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    const dialog = page.getByRole('dialog', { name: '새 이슈' })
    await dialog.getByLabel('제목').fill('여러 줄 본문')
    await page.getByTestId('issue-body').evaluate((el) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'a\n\nb')
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    })
    await expect(page.getByTestId('issue-body').locator('p')).toHaveCount(3)

    await dialog.getByRole('button', { name: /^생성$/ }).click()
    await expect.poll(() => creates.lastBody<{ body: string }>()?.body).toBe('a\n\nb')
  })

  test('엑셀처럼 텍스트와 이미지가 함께 붙여넣어지면 텍스트만 들어가고 업로드하지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubProjectList(page)
    const uploads = trackRequests(page, 'ANY', `/api/v1/projects/${KEY}/issue-images`)
    await page.route(`**/api/v1/projects/${KEY}/issue-images`, (r) => r.fulfill({ status: 500 }))
    await page.goto(`/projects/${KEY}`)
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    const editor = page.getByTestId('issue-body')
    await editor.evaluate((el) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'cells.png', { type: 'image/png' }))
      dt.setData('text/plain', 'A\tB')
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    })
    await expect(editor).toHaveText('A\tB')
    await expect(editor.getByTestId('rich-image')).toHaveCount(0)
    expect(uploads.count()).toBe(0)
  })
})

test.describe('이슈 본문 이미지 — 상세 편집', () => {
  test('편집 중 드롭한 이미지가 저장 요청 본문에 들어가고, 업로드 중엔 저장·단축키가 막힌다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await setupDetailStubs(page, '기존 본문')
    const upload = await stubUpload(page)
    const patches = trackRequests(page, 'PATCH', `/api/v1/projects/${KEY}/issues/1`)
    await page.route(
      (u) => u.pathname === `/api/v1/projects/${KEY}/issues/1`,
      async (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback()
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      },
    )
    await page.goto(`/projects/${KEY}/issues/1`)
    await page.getByRole('button', { name: '본문 편집' }).click()
    const ta = page.getByTestId('issue-body-textarea')
    await ta.evaluate((el) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'bug.png', { type: 'image/png' }))
      // 편집칸 안 좌표로 떨어뜨린다 — 편집기는 놓은 자리(좌표)를 찾지 못한 드롭은 처리하지 않는다(실제 드롭은 늘 좌표가 있다).
      const r = el.getBoundingClientRect()
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.top + 12 }))
    })
    // 떨어뜨린 자리에 업로드 중 자리표시가 들어간다.
    await expect(ta.getByTestId('rich-image')).toHaveText('업로드 중…')
    await expect(page.getByTestId('issue-body-save')).toBeDisabled()
    // 업로드 중 취소는 막혀야 한다 — 취소 버튼 비활성, Esc 는 편집창을 닫지 않는다(올리던 이미지 유실 방지).
    await expect(page.getByTestId('issue-body-cancel')).toBeDisabled()
    await ta.press('Escape')
    await expect(ta).toBeVisible()
    await ta.press('ControlOrMeta+Enter')
    expect(patches.count()).toBe(0)

    upload.release()
    await expect(ta.getByTestId('rich-image').locator('img')).toHaveAttribute('src', /^blob:/)
    await page.getByTestId('issue-body-save').click()
    await expect.poll(() => patches.lastBody<{ body: string }>()?.body).toContain(`![bug.png](${IMG_URL})`)
  })
})

test.describe('이슈 본문 이미지 — 편집 UX', () => {
  test('업로드가 실패하면 삽입했던 줄바꿈까지 되돌려 원문이 그대로 남는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await setupDetailStubs(page, '기존 본문')
    await page.route(`**/api/v1/projects/${KEY}/issue-images`, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    const patches = trackRequests(page, 'PATCH', `/api/v1/projects/${KEY}/issues/1`)
    await page.route(
      (u) => u.pathname === `/api/v1/projects/${KEY}/issues/1`,
      (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) : route.fallback()),
    )
    await page.goto(`/projects/${KEY}/issues/1`)
    await page.getByRole('button', { name: '본문 편집' }).click()
    const ta = page.getByTestId('issue-body-textarea')
    await ta.fill('재현 화면입니다')
    // 줄 가운데(「재현 」 뒤)에 커서를 두고 붙여넣는다.
    await page.keyboard.press('Home')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    await pasteImage(page, '[data-testid="issue-body-textarea"]')
    await expect(page.getByText('이미지를 올리지 못했습니다')).toBeVisible()
    await expect(ta.getByTestId('rich-image')).toHaveCount(0)
    await expect(ta.locator('p')).toHaveText(['재현 화면입니다'])
    await page.getByTestId('issue-body-save').click()
    await expect.poll(() => patches.lastBody<{ body: string }>()?.body).toBe('재현 화면입니다')
  })
})

test.describe('이슈 본문 이미지 — 표시', () => {
  test('본문 이미지가 인증 blob 으로 로드되고, 클릭하면 편집이 아니라 미리보기가 열린다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await setupDetailStubs(page, `재현 화면\n\n![bug.png](${IMG_URL})`)
    await page.route(`**${IMG_URL}`, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
    await page.goto(`/projects/${KEY}/issues/1`)

    const img = page.getByRole('img', { name: 'bug.png' })
    await expect(img).toHaveAttribute('src', /^blob:/)
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)

    await img.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByTestId('issue-body-textarea')).toHaveCount(0)
    // WP-277: 통합 뷰어의 단건 — ‹ › 없음.
    await expect(page.getByTestId('attachment-viewer')).toBeVisible()
    await expect(page.getByRole('button', { name: '이전 파일' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '다음 파일' })).toHaveCount(0)
    // 본문 이미지는 URL 에 열림 상태가 없어 링크 복사가 의미 없다 — 항목이 없는 ⋯ 도 그리지 않는다.
    await expect(page.getByRole('button', { name: '더 보기' })).toHaveCount(0)
  })

  test('미리보기를 닫기 버튼·Escape 로 닫거나 뷰어 안쪽을 눌러도 편집 모드로 들어가지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await setupDetailStubs(page, `![bug.png](${IMG_URL})`)
    await page.route(`**${IMG_URL}`, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
    await page.goto(`/projects/${KEY}/issues/1`)
    const img = page.getByRole('img', { name: 'bug.png' })
    const dialog = page.getByRole('dialog')
    const ta = page.getByTestId('issue-body-textarea')

    await img.click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /닫기|close/i }).first().click()
    await expect(dialog).toHaveCount(0)
    await expect(ta).toHaveCount(0)

    await img.click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(ta).toHaveCount(0)

    await img.click()
    await expect(dialog).toBeVisible()
    // WP-277: 통합 뷰어는 전체 화면이라 바깥(오버레이)이 없다. 대신 포털 안쪽 클릭이 React 트리로 번져
    // 본문 "클릭=편집 진입" 이 되지 않는지 본다 — 뷰어 본문·헤더를 눌러도 편집창이 열리지 않아야 한다.
    await page.getByTestId('preview-body').click({ position: { x: 5, y: 5 } })
    // 헤더 가운데는 AI 칩(z-[70])이 덮고 칩은 다이얼로그 위에서도 눌린다(WP-1261) — 칩과 겹치지 않는 왼쪽 끝을 누른다.
    await page.getByTestId('preview-meta').click({ position: { x: 5, y: 5 } })
    await expect(ta).toHaveCount(0)
    await expect(dialog).toBeVisible()
  })
  test('PDF 같은 비이미지 파일을 드롭하면 토스트로 거부하고 기본 동작을 막아 입력한 글이 유지된다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await setupDetailStubs(page, '기존 본문')
    await page.goto(`/projects/${KEY}/issues/1`)
    await page.getByRole('button', { name: '본문 편집' }).click()
    const ta = page.getByTestId('issue-body-textarea')
    await ta.fill('쓰던 내용')
    // 기본 동작(브라우저가 파일로 이동)이 막혔는지는 dispatchEvent 반환값(= !defaultPrevented)으로 확인한다.
    const notPrevented = await ta.evaluate((el) => {
      const dt = new DataTransfer()
      dt.items.add(new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }))
      const r = el.getBoundingClientRect()
      return el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.top + 12 }))
    })
    expect(notPrevented).toBe(false)
    await expect(page.getByText('PNG·JPEG·GIF·WebP 이미지만 10MB 까지 올릴 수 있습니다.')).toBeVisible()
    await expect(ta).toHaveText('쓰던 내용')
    await expect(ta.getByTestId('rich-image')).toHaveCount(0)
  })
})
