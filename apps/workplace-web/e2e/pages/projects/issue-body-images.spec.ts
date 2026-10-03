// 이슈 본문 이미지(WP-199) E2E — 붙여넣기·드롭·버튼 업로드와 본문 렌더.
import type { Page } from '@playwright/test'

import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
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
  test('붙여넣은 이미지가 업로드되어 본문에 들어가고, 업로드 중에는 등록이 막힌다', async ({ authenticatedPage: page }) => {
    await stubProjectList(page)
    const upload = await stubUpload(page)
    let createdBody: string | undefined
    await page.route(`**/api/v1/projects/${KEY}/issues`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      createdBody = route.request().postDataJSON().body
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(createIssue({ number: 9 })) })
    })

    await page.goto(`/projects/${KEY}`)
    // 기존 issue-create-validation.spec.ts 의 다이얼로그 여는 방식과 동일하게 연다.
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    const dialog = page.getByRole('dialog', { name: '새 이슈' })
    await dialog.getByLabel('제목').fill('로그인 버튼 깨짐')
    await pasteImage(page, '#issue-body')

    await expect(page.locator('#issue-body')).toHaveValue(/!\[업로드 중… #1\]\(\)/)
    await expect(dialog.getByRole('button', { name: /^생성$/ })).toBeDisabled()

    upload.release()
    await expect(page.locator('#issue-body')).toHaveValue(`![bug.png](${IMG_URL})\n`)

    await dialog.getByRole('button', { name: /^생성$/ }).click()
    await expect.poll(() => createdBody).toBe(`![bug.png](${IMG_URL})\n`)
  })

  test('엑셀처럼 텍스트와 이미지가 함께 붙여넣어지면 텍스트만 들어가고 업로드하지 않는다', async ({ authenticatedPage: page }) => {
    await stubProjectList(page)
    let uploads = 0
    await page.route(`**/api/v1/projects/${KEY}/issue-images`, (r) => {
      uploads++
      return r.fulfill({ status: 500 })
    })
    await page.goto(`/projects/${KEY}`)
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    await page.locator('#issue-body').evaluate((el) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'cells.png', { type: 'image/png' }))
      dt.setData('text/plain', 'A\tB')
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    })
    await expect(page.locator('#issue-body')).not.toHaveValue(/업로드 중/)
    expect(uploads).toBe(0)
  })

  test('10MB 초과·비이미지 파일은 버튼 선택 시 토스트로 거부된다', async ({ authenticatedPage: page }) => {
    await stubProjectList(page)
    await page.goto(`/projects/${KEY}`)
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    await page.getByTestId('issue-body-image-input').setInputFiles({
      name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4'),
    })
    await expect(page.getByText('PNG·JPEG·GIF·WebP 이미지만 10MB 까지 올릴 수 있습니다.')).toBeVisible()
  })
})

test.describe('이슈 본문 이미지 — 상세 편집', () => {
  test('편집 중 드롭한 이미지가 저장 요청 본문에 들어가고, 업로드 중엔 저장·단축키가 막힌다', async ({ authenticatedPage: page }) => {
    await setupDetailStubs(page, '기존 본문')
    const upload = await stubUpload(page)
    let patched: string | undefined
    await page.route(
      (u) => u.pathname === `/api/v1/projects/${KEY}/issues/1`,
      async (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback()
        patched = route.request().postDataJSON().body
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      },
    )
    await page.goto(`/projects/${KEY}/issues/1`)
    await page.getByRole('button', { name: '본문 편집' }).click()
    const ta = page.getByTestId('issue-body-textarea')
    await ta.evaluate((el) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'bug.png', { type: 'image/png' }))
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    await expect(page.getByTestId('issue-body-save')).toBeDisabled()
    await ta.press('ControlOrMeta+Enter')
    expect(patched).toBeUndefined()

    upload.release()
    await expect(ta).toHaveValue(new RegExp(`!\\[bug\\.png\\]\\(${IMG_URL.replace(/\//g, '\\/')}\\)`))
    await page.getByTestId('issue-body-save').click()
    await expect.poll(() => patched).toContain(`![bug.png](${IMG_URL})`)
  })
})
