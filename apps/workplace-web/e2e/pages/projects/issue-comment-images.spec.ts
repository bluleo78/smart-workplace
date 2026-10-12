// 이슈 코멘트 이미지(WP-362) E2E — 입력창 안 이미지(붙여넣기·버튼·업로드 실패), 목록 표시·뷰어, 수정 복원·삭제 안내.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { createComment, createIssueDetail } from '../../factories/issue.factory'
import { createProject } from '../../factories/project.factory'
import type { IssueCommentResponse, IssueDetailResponse } from '../../../src/types/issue'

const KEY = 'WP'
const ISSUE_NUMBER = 1
const ISSUE_ID = 100
const ME_ID = 1
const COMMENTS_PATH = /\/api\/v1\/issues\/\d+\/comments$/
const COMMENT_PATH = /\/api\/v1\/issues\/\d+\/comments\/\d+$/
const IMG_URL = `/api/v1/projects/${KEY}/issue-images/77`
// 1x1 투명 PNG — 실제 디코딩돼야 썸네일·뷰어가 그려진다.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

// 이슈 상세 공통 스텁 — issue-comments.spec.ts 와 같은 구성.
async function setupIssueStubs(page: Page, detailRef: { current: IssueDetailResponse }) {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  )
  await page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues/${ISSUE_NUMBER}`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detailRef.current) }),
  )
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
  }
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/labels`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route(`**${IMG_URL}`, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
}

// 업로드는 지연 응답 — "업로드 중 작성 비활성" 을 관찰할 시간을 준다. release() 로 응답을 흘려보낸다.
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
  return { release: () => release() }
}

// 클립보드 이미지 붙여넣기 — 텍스트 없는 순수 이미지(스크린샷 복사).
async function pasteImage(page: Page, testId: string) {
  await page.getByTestId(testId).evaluate((el) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'bug.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  })
}

// 작성 성공 시 보낸 본문 그대로의 코멘트를 목록에 돌려준다.
async function stubCreate(page: Page, detailRef: { current: IssueDetailResponse }) {
  await page.route(
    (url) => COMMENTS_PATH.test(url.pathname),
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const { body } = route.request().postDataJSON() as { body: string }
      const created = createComment({ id: 30, issueId: ISSUE_ID, authorId: ME_ID, body })
      detailRef.current = createIssueDetail({ comments: [created] })
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) })
    },
  )
}

test.describe('코멘트 작성창 — 입력창 안 이미지 (WP-362)', () => {
  test('글 중간에 붙여넣은 이미지가 그 자리에 들어가고, 업로드 중엔 작성이 막히며, 등록하면 그 자리에 보인다', async ({ authenticatedPage: page }) => {
    const detailRef = { current: createIssueDetail({ comments: [] }) }
    await setupIssueStubs(page, detailRef)
    const upload = await stubUpload(page)
    const posts = trackRequests(page, 'POST', COMMENTS_PATH)
    await stubCreate(page, detailRef)

    await page.goto(`/projects/${KEY}/issues/${ISSUE_NUMBER}`)
    const input = page.getByTestId('issue-comment-input')
    await input.click()
    await page.keyboard.type('버튼이 겹쳐요')
    await pasteImage(page, 'issue-comment-input')

    // 업로드 중: 자리표시 썸네일 + 작성 비활성(Enter 도 막힘).
    const thumb = input.getByTestId('rich-image')
    await expect(thumb).toHaveAttribute('data-pending', 'true')
    await expect(thumb).toContainText('업로드 중…')
    const submit = page.getByTestId('issue-comment-submit')
    await expect(submit).toBeDisabled()
    await page.keyboard.press('Enter')
    expect(posts.count()).toBe(0)

    // 업로드 완료 → 실제 이미지 썸네일, 이어서 다음 줄에 쓴다.
    upload.release()
    await expect(thumb).not.toHaveAttribute('data-pending', 'true')
    await expect(thumb.locator('img')).toHaveJSProperty('naturalWidth', 1)
    await page.keyboard.type('모바일에서는 잘려요')
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect.poll(posts.count).toBe(1)
    expect(posts.bodies<{ body: string }>()[0].body).toBe(`버튼이 겹쳐요\n![bug.png](${IMG_URL})\n모바일에서는 잘려요`)

    // 목록: 글 → 이미지 → 글 순서로, 이미지는 원래 렌더러(클릭 시 뷰어)로.
    const item = page.locator('section[aria-label="코멘트"] ul li').first()
    const img = item.getByRole('img', { name: 'bug.png' })
    await expect(img).toBeVisible()
    await expect(item).toContainText('버튼이 겹쳐요')
    await expect(item).toContainText('모바일에서는 잘려요')
    await expect(item).not.toContainText('issue-images')
  })

  test('이미지 버튼으로 고른 이미지만 있어도 작성할 수 있다', async ({ authenticatedPage: page }) => {
    const detailRef = { current: createIssueDetail({ comments: [] }) }
    await setupIssueStubs(page, detailRef)
    const upload = await stubUpload(page)
    upload.release()
    const posts = trackRequests(page, 'POST', COMMENTS_PATH)
    await stubCreate(page, detailRef)

    await page.goto(`/projects/${KEY}/issues/${ISSUE_NUMBER}`)
    await page.getByTestId('issue-comment-input-image-input').setInputFiles({ name: 'bug.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.getByTestId('issue-comment-input').getByTestId('rich-image').locator('img')).toBeVisible()
    await page.getByTestId('issue-comment-submit').click()

    await expect.poll(posts.count).toBe(1)
    expect(posts.bodies<{ body: string }>()[0].body).toBe(`![bug.png](${IMG_URL})`)
  })

  test('업로드에 실패하면 자리표시를 지우고 안내한다', async ({ authenticatedPage: page }) => {
    const detailRef = { current: createIssueDetail({ comments: [] }) }
    await setupIssueStubs(page, detailRef)
    await page.route(`**/api/v1/projects/${KEY}/issue-images`, (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'PNG·JPEG·GIF·WebP 이미지만 올릴 수 있습니다.' }) }),
    )

    await page.goto(`/projects/${KEY}/issues/${ISSUE_NUMBER}`)
    await page.getByTestId('issue-comment-input').click()
    await pasteImage(page, 'issue-comment-input')

    await expect(page.getByText('PNG·JPEG·GIF·WebP 이미지만 올릴 수 있습니다.')).toBeVisible()
    await expect(page.getByTestId('issue-comment-input').getByTestId('rich-image')).toHaveCount(0)
  })
})

test.describe('코멘트 이미지 — 목록·수정·삭제 (WP-362)', () => {
  const withImage = (): IssueCommentResponse =>
    createComment({ id: 40, issueId: ISSUE_ID, authorId: ME_ID, body: `재현 화면\n![bug.png](${IMG_URL})\n확인 부탁` })

  test('이미지를 누르면 뷰어로 크게 열린다', async ({ authenticatedPage: page }) => {
    const detailRef = { current: createIssueDetail({ comments: [withImage()] }) }
    await setupIssueStubs(page, detailRef)

    await page.goto(`/projects/${KEY}/issues/${ISSUE_NUMBER}`)
    const item = page.locator('section[aria-label="코멘트"] ul li').first()
    await item.getByRole('img', { name: 'bug.png' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('수정하면 이미지가 원래 자리에 썸네일로 돌아오고, 지우고 저장하면 본문에서 빠진다', async ({ authenticatedPage: page }) => {
    const mine = withImage()
    const detailRef = { current: createIssueDetail({ comments: [mine] }) }
    await setupIssueStubs(page, detailRef)
    const patches = trackRequests(page, 'PATCH', COMMENT_PATH)
    await page.route(
      (url) => COMMENT_PATH.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback()
        const { body } = route.request().postDataJSON() as { body: string }
        const updated = { ...mine, body }
        detailRef.current = createIssueDetail({ comments: [updated] })
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) })
      },
    )

    await page.goto(`/projects/${KEY}/issues/${ISSUE_NUMBER}`)
    const item = page.locator('section[aria-label="코멘트"] ul li').first()
    await item.hover()
    await item.getByRole('button', { name: '코멘트 수정' }).click()

    const edit = page.getByTestId('issue-comment-edit-input')
    const thumb = edit.getByTestId('rich-image')
    await expect(thumb.locator('img')).toHaveJSProperty('naturalWidth', 1)
    // 두 번째 줄(이미지) 위치 확인 — 앞뒤 글 사이.
    await expect(edit.locator('p').nth(1).getByTestId('rich-image')).toBeVisible()

    // 썸네일 클릭(선택) → Backspace 로 삭제 → 저장.
    await thumb.click()
    await page.keyboard.press('Backspace')
    await expect(thumb).toHaveCount(0)
    await page.getByTestId('issue-comment-edit-save').click()

    await expect.poll(patches.count).toBe(1)
    expect(patches.bodies<{ body: string }>()[0].body).toBe('재현 화면\n\n확인 부탁')
  })

  test('삭제 확인창이 함께 지워질 이미지 수를 알려 준다', async ({ authenticatedPage: page }) => {
    const detailRef = { current: createIssueDetail({ comments: [withImage()] }) }
    await setupIssueStubs(page, detailRef)

    await page.goto(`/projects/${KEY}/issues/${ISSUE_NUMBER}`)
    const item = page.locator('section[aria-label="코멘트"] ul li').first()
    await item.hover()
    await item.getByRole('button', { name: '코멘트 삭제' }).click()

    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('이미지 1개도 함께 삭제됩니다')
    // 미리보기는 이미지 URL 대신 [이미지] 로 줄여 보여 준다.
    await expect(dialog).toContainText('[이미지]')
    await expect(dialog).not.toContainText('issue-images')
  })
})
