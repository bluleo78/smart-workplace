// 메인 AI 채팅 첨부 입력창 (WP-234) — 데스크톱 사이드 패널.
// ＋(드라이브 없음)·붙여넣기·드롭 → 사전 업로드(이미지 축소 포함) → 칩 → 전송 payload 의 fileIds 까지,
// 첨부만 전송·업로드 중 전송 차단(Enter 포함)·상한 사전 안내·서버 400 문구·대화 전환 시 초안 비움을 검증한다.
import { Buffer } from 'buffer'

import type { Page } from '@playwright/test'

import { PER_MESSAGE_LIMIT_MSG, PER_SESSION_LIMIT_MSG } from '../../src/lib/homeChatAttachments'
import type { ErrorResponse } from '../../src/types/auth'
import type { HomeMessage, HomeSessionPage, HomeUploadedFile } from '../../src/types/home'
import { createHomeAttachment } from '../factories/homeAttachment.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { type HomeChatStartBody, mockHomeChatGeneration } from '../fixtures/home-chat-mock'
import { trackRequests } from '../fixtures/requests'
import { expectStays } from '../fixtures/wait'

const UPLOAD = '/api/v1/home/attachments'

type UploadedPart = { name: string; type: string }

/** multipart 본문에서 파일 파트의 이름·Content-Type 을 뽑는다(파서 없이 단언용). */
function partsOf(body: Buffer | null): UploadedPart[] {
  const text = body?.toString('utf8') ?? ''
  return [...text.matchAll(/filename="([^"]+)"\r\nContent-Type: ([^\r\n]+)/g)].map(([, name, type]) => ({ name, type }))
}

/** 업로드 스텁 — 요청마다 올라온 파트를 기록하고 fileId 를 7000번부터 돌려준다. hold=true 면 release() 까지 응답을 붙잡는다. */
async function stubUpload(page: Page, opts: { hold?: boolean } = {}) {
  const parts: UploadedPart[] = []
  let next = 7000
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  await page.route((u) => u.pathname === UPLOAD, async (r) => {
    const got = partsOf(r.request().postDataBuffer())
    parts.push(...got)
    if (opts.hold) await gate
    const files = got.map((p) => ({ fileId: next++, originalName: p.name, mimeType: p.type, sizeBytes: 3 })) satisfies HomeUploadedFile[]
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(files) })
  })
  return { parts, release }
}

/** 첨부가 이미 붙은 대화 하나를 세션 목록·메시지로 모킹한다(세션 30개 상한 판정용). */
async function mockSessionWithAttachments(page: Page, sessionId: string, count: number) {
  await mockApi(page, 'GET', '/api/v1/home/sessions', {
    items: [{ id: sessionId, title: '첨부 많은 대화', lastMessageAt: '2026-10-06T00:00:00Z', widgetCount: 0 }],
    nextCursor: null,
  } satisfies HomeSessionPage)
  const messages: HomeMessage[] = [
    {
      id: 1, role: 'USER', content: '자료 모음', widgets: null, toolCalls: null, createdAt: '2026-10-06T00:00:00Z',
      attachments: Array.from({ length: count }, (_, i) => createHomeAttachment({ fileId: 8000 + i, originalName: `doc-${i}.pdf` })),
    },
  ]
  await mockApi(page, 'GET', `/api/v1/home/sessions/${sessionId}/messages`, messages)
}

/** 홈에서 AI 사이드 패널을 연다. */
async function openPanel(page: Page) {
  await page.goto('/')
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('chat-panel')).toBeVisible()
}

/** 세션 스위처에서 첫 대화를 복원하고 그 사용자 턴이 그려질 때까지 기다린다. */
async function restoreFirstSession(page: Page) {
  await page.getByTestId('chat-session-switcher').click()
  await page.getByTestId('chat-session-select').first().click()
  await expect(page.getByTestId('chat-turn').first()).toContainText('자료 모음')
}

/** 입력칸에 합성 paste — 파일과 (선택) text/plain. 반환값: 기본 동작이 막혔는지(첨부로 가로챘는지). */
async function paste(page: Page, file: { name: string; type: string }, text?: string): Promise<boolean> {
  return page.getByTestId('chat-input').evaluate((el, { file, text }) => {
    const dt = new DataTransfer()
    if (text) dt.setData('text/plain', text)
    dt.items.add(new File([new Uint8Array([1, 2, 3])], file.name, { type: file.type }))
    return !el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, { file, text })
}

/** 입력창 폼에 파일 드롭(dragenter → drop). size 는 파일별 바이트 수. */
async function drop(page: Page, files: { name: string; type: string; size?: number }[]) {
  const dt = await page.evaluateHandle((files) => {
    const d = new DataTransfer()
    for (const f of files) d.items.add(new File([new Uint8Array(f.size ?? 3)], f.name, { type: f.type }))
    return d
  }, files)
  const form = page.getByTestId('ai-composer')
  await form.dispatchEvent('dragenter', { dataTransfer: dt })
  await form.dispatchEvent('drop', { dataTransfer: dt })
}

/** 오류 토스트(문구 일치). */
const toast = (page: Page, text: string) => page.locator('[data-sonner-toast]', { hasText: text })

test.describe('메인 AI 채팅 첨부 입력창 (WP-234)', () => {
  test('＋ 메뉴는 파일 첨부만 → 업로드 → 칩 → 전송 payload 에 fileIds', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    const upload = await stubUpload(page)
    // 드라이브 링크를 받지 않으므로 AI 채팅은 드라이브 스페이스를 조회하지 않는다.
    const spaces = trackRequests(page, 'GET', '/api/v1/drive/spaces')
    const starts = await mockHomeChatGeneration(page, {
      frames: [{ event: 'delta', data: { text: '요약했어요' } }, { event: 'done', data: { sessionId: 's-att' } }],
    })
    await openPanel(page)

    await page.getByTestId('ai-composer-attach-button').click()
    const menu = page.getByTestId('ai-composer-attach-menu')
    await expect(menu.getByRole('menuitem')).toHaveText(['파일 첨부'])
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('ai-composer-attach-file').click()
    await (await chooser).setFiles({ name: 'roadmap.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })

    await expect(page.getByTestId('ai-composer-attachments')).toContainText('roadmap.pdf')
    await expect.poll(() => upload.parts).toEqual([{ name: 'roadmap.pdf', type: 'application/pdf' }])

    await page.getByTestId('chat-input').fill('이 문서 요약해줘')
    await page.getByTestId('chat-send').click()
    await expect.poll(() => starts.lastBody<HomeChatStartBody>()).toMatchObject({ sessionId: null, query: '이 문서 요약해줘', fileIds: [7000] })
    const userTurn = page.getByTestId('chat-turn').filter({ hasText: '이 문서 요약해줘' })
    await expect(userTurn.getByTestId('attachment-card-7000')).toContainText('roadmap.pdf')

    // 서버가 받아들인 뒤 초안은 비워진다.
    await expect(page.getByTestId('ai-composer-attachments')).toHaveCount(0)
    await expect(page.getByTestId('chat-panel')).toContainText('요약했어요')
    expect(spaces.count()).toBe(0)
  })

  test('스크린샷 붙여넣기 → 첨부만 전송(query 빈 문자열)', async ({ authenticatedPage: page }) => {
    const upload = await stubUpload(page)
    const starts = await mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-only' } }] })
    await openPanel(page)
    const send = page.getByTestId('chat-send')
    await expect(send).toBeDisabled()

    // 파일만 든 붙여넣기는 가로채 첨부로 올린다. 가짜 PNG 라 디코딩에 실패 → 원본 그대로 올라간다.
    expect(await paste(page, { name: 'image.png', type: 'image/png' })).toBe(true)
    await expect(page.getByTestId('ai-composer-attachments')).toContainText('image.png')
    await expect.poll(() => upload.parts).toEqual([{ name: 'image.png', type: 'image/png' }])
    await expect(page.getByTestId('chat-input')).toHaveValue('')

    await expect(send).toBeEnabled()
    await send.click()
    await expect.poll(() => starts.lastBody<HomeChatStartBody>()).toMatchObject({ query: '', fileIds: [7000] })
  })

  test('텍스트와 렌더링 이미지가 함께 오는 붙여넣기는 텍스트로 두고 올리지 않는다', async ({ authenticatedPage: page }) => {
    const uploads = trackRequests(page, 'POST', UPLOAD)
    await openPanel(page)
    expect(await paste(page, { name: 'render.png', type: 'image/png' }, '표에서 복사한 글')).toBe(false)
    await expectStays(page, uploads.count, 0)
    await expect(page.getByTestId('ai-composer-attachments')).toHaveCount(0)
  })

  test('파일 드롭 → 오버레이 → 칩', async ({ authenticatedPage: page }) => {
    await stubUpload(page)
    await openPanel(page)
    const dt = await page.evaluateHandle(() => {
      const d = new DataTransfer()
      d.items.add(new File(['메모'], 'notes.txt', { type: 'text/plain' }))
      return d
    })
    const form = page.getByTestId('ai-composer')
    await form.dispatchEvent('dragenter', { dataTransfer: dt })
    await expect(page.getByTestId('composer-drop-overlay')).toBeVisible()
    await form.dispatchEvent('drop', { dataTransfer: dt })
    await expect(page.getByTestId('composer-drop-overlay')).toHaveCount(0)
    await expect(page.getByTestId('ai-composer-attachments')).toContainText('notes.txt')
  })

  test('업로드 중엔 진행 칩이 보이고 보내기 버튼도 Enter 도 막히며, 끝나면 첨부와 함께 전송된다', async ({ authenticatedPage: page }) => {
    const upload = await stubUpload(page, { hold: true })
    const starts = await mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-hold' } }] })
    await openPanel(page)
    const input = page.getByTestId('chat-input')
    await input.fill('같이 보내요')
    await paste(page, { name: 'shot.png', type: 'image/png' })
    const send = page.getByTestId('chat-send')
    await expect(send).toHaveText('업로드 중…')
    await expect(send).toBeDisabled()
    // 시안 1-3: 올라가는 중인 파일은 스피너 칩으로 보인다(아직 초안 칩은 아니다).
    await expect(page.getByTestId('ai-composer-uploading-chip')).toContainText('shot.png')
    await input.press('Enter')
    await expectStays(page, starts.count, 0)

    upload.release()
    await expect(send).toHaveText('보내기')
    await expect(page.getByTestId('ai-composer-uploading-chip')).toHaveCount(0)
    await expect(page.getByTestId('ai-composer-attachments')).toContainText('shot.png')
    await input.press('Enter')
    await expect.poll(() => starts.lastBody<HomeChatStartBody>()).toMatchObject({ query: '같이 보내요', fileIds: [7000] })
  })

  test('큰 PNG 는 긴 변 2048 JPEG 로 줄여 올리고, GIF 는 그대로 올린다', async ({ authenticatedPage: page }) => {
    const upload = await stubUpload(page)
    await openPanel(page)
    // 3000×1500 PNG 를 브라우저 canvas 로 만든다(단색이라 용량은 작지만 긴 변이 2048 을 넘는다).
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 3000
      c.height = 1500
      const ctx = c.getContext('2d')!
      ctx.fillStyle = 'rgb(40, 120, 200)'
      ctx.fillRect(0, 0, 3000, 1500)
      return c.toDataURL('image/png')
    })
    const png = Buffer.from(dataUrl.split(',')[1], 'base64')
    await page.getByTestId('ai-composer-attach-button').click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('ai-composer-attach-file').click()
    await (await chooser).setFiles([
      { name: 'wide.png', mimeType: 'image/png', buffer: png },
      { name: 'anim.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') },
    ])
    await expect(page.getByTestId('ai-composer-attachments')).toContainText('anim.gif')
    await expect.poll(() => upload.parts).toEqual([
      { name: 'wide.jpg', type: 'image/jpeg' },
      { name: 'anim.gif', type: 'image/gif' },
    ])
  })

  test('칩 × 로 뺀 파일은 보내지 않고, 그 미리보기 URL 은 해제한다', async ({ authenticatedPage: page }) => {
    // 미리보기 해제를 관측한다 — 앱 코드가 부르는 URL.revokeObjectURL 을 감싸 인자를 기록한다.
    await page.addInitScript(() => {
      const w = window as unknown as { __revoked: string[] }
      w.__revoked = []
      const orig = URL.revokeObjectURL.bind(URL)
      URL.revokeObjectURL = (u: string) => {
        w.__revoked.push(u)
        orig(u)
      }
    })
    const revokedCount = () => page.evaluate(() => (window as unknown as { __revoked: string[] }).__revoked.length)
    await stubUpload(page)
    const starts = await mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-rm' } }] })
    await openPanel(page)
    await paste(page, { name: 'a.png', type: 'image/png' })
    await expect(page.getByTestId('ai-composer-attachments')).toContainText('a.png')
    await paste(page, { name: 'b.png', type: 'image/png' })
    await expect(page.getByTestId('ai-composer-attachments')).toContainText('b.png')

    // 다른 코드의 해제와 섞이지 않게 × 전후 증가분만 본다.
    const before = await revokedCount()
    await page.getByTestId('ai-composer-attachments').getByRole('listitem').filter({ hasText: 'a.png' })
      .getByRole('button', { name: '첨부 제거' }).click()
    await expect(page.getByTestId('ai-composer-attachments')).not.toContainText('a.png')
    await expect.poll(revokedCount).toBe(before + 1)

    await page.getByTestId('chat-send').click()
    await expect.poll(() => starts.lastBody<HomeChatStartBody>()).toMatchObject({ query: '', fileIds: [7001] })
  })

  test('메시지당 10개를 넘기면 안내하고 올리지 않는다', async ({ authenticatedPage: page }) => {
    const uploads = trackRequests(page, 'POST', UPLOAD)
    await openPanel(page)
    await drop(page, Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.txt`, type: 'text/plain' })))
    await expect(toast(page, PER_MESSAGE_LIMIT_MSG)).toBeVisible()
    await expectStays(page, uploads.count, 0)
  })

  test('25MB 를 넘는 파일은 안내하고 올리지 않는다', async ({ authenticatedPage: page }) => {
    const uploads = trackRequests(page, 'POST', UPLOAD)
    await openPanel(page)
    await drop(page, [{ name: 'huge.zip', type: 'application/zip', size: 25 * 1024 * 1024 + 1 }])
    await expect(toast(page, '25MB를 넘는 파일은 첨부할 수 없어요: huge.zip')).toBeVisible()
    await expectStays(page, uploads.count, 0)
  })

  test('세션에 이미 29개가 있으면 2개 추가는 안내하고 올리지 않는다', async ({ authenticatedPage: page }) => {
    const uploads = trackRequests(page, 'POST', UPLOAD)
    await mockSessionWithAttachments(page, 's-full', 29)
    await openPanel(page)
    await restoreFirstSession(page)
    // 복원된 사용자 말풍선 아래에 세션 첨부(마지막 29번째) 카드가 다시 그려진다(PF-C2).
    await expect(page.getByTestId('chat-turn').first().getByTestId('attachment-card-8028')).toContainText('doc-28.pdf')

    await drop(page, [{ name: 'a.txt', type: 'text/plain' }, { name: 'b.txt', type: 'text/plain' }])
    await expect(toast(page, PER_SESSION_LIMIT_MSG)).toBeVisible()
    await expectStays(page, uploads.count, 0)
  })

  test('서버가 전송을 거절(400)하면 message 를 그대로 보여 주고 칩은 남긴다', async ({ authenticatedPage: page }) => {
    await stubUpload(page)
    const reason = '첨부 파일이 만료되었어요. 다시 올려 주세요.'
    await page.route((u) => u.pathname === '/api/v1/ai/chat', (r) =>
      r.request().method() === 'POST'
        ? r.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ status: 400, error: 'Bad Request', message: reason } satisfies ErrorResponse),
        })
        : r.fallback())
    await openPanel(page)
    await paste(page, { name: 'old.png', type: 'image/png' })
    await expect(page.getByTestId('ai-composer-attachments')).toContainText('old.png')
    await page.getByTestId('chat-send').click()
    await expect(toast(page, reason)).toBeVisible()
    await expect(page.getByTestId('ai-composer-attachments')).toContainText('old.png')
    // 거절된 낙관적 사용자 턴에는 첨부가 남지 않는다(Task 15 의 첨부 떼기 — 말풍선에서 확인).
    await expect(page.getByTestId('chat-panel').getByTestId('message-attachments')).toHaveCount(0)
  })

  test('거절(400)된 전송의 첨부는 대화에 남지 않고, 남은 칩으로 같은 fileIds 를 다시 보낸다', async ({ authenticatedPage: page }) => {
    await stubUpload(page)
    await mockSessionWithAttachments(page, 's-retry', 24)
    // 나중에 등록한 라우트가 먼저 돈다 — 첫 POST 만 400, 이후는 정상 생성 모킹으로 넘긴다.
    const starts = await mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-retry' } }] })
    let rejected = false
    await page.route((u) => u.pathname === '/api/v1/ai/chat', (r) => {
      if (r.request().method() !== 'POST' || rejected) return r.fallback()
      rejected = true
      return r.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ status: 400, error: 'Bad Request', message: '잠시 후 다시 보내 주세요.' } satisfies ErrorResponse),
      })
    })
    await openPanel(page)
    await restoreFirstSession(page)

    await drop(page, Array.from({ length: 5 }, (_, i) => ({ name: `r${i}.txt`, type: 'text/plain' })))
    await expect(page.getByTestId('ai-composer-attachments').getByRole('listitem')).toHaveCount(5)
    await page.getByTestId('chat-send').click()
    await expect(toast(page, '잠시 후 다시 보내 주세요.')).toBeVisible()
    // 거절된 턴의 말풍선엔 첨부가 없다 — 복원된 첫 턴의 첨부 목록 하나만 있고 r0.txt 카드는 없다.
    await expect(page.getByTestId('chat-panel').getByTestId('message-attachments')).toHaveCount(1)
    await expect(page.getByTestId('chat-panel').getByTestId('attachment-card-7000')).toHaveCount(0)
    // 칩은 그대로 남는다.
    await expect(page.getByTestId('ai-composer-attachments').getByRole('listitem')).toHaveCount(5)

    // 거절된 턴에서 첨부가 떨어졌는지 — 세션 수(24)에 거절분 5개가 잡혀 있으면 1개 추가가 30개를 넘어 막힌다.
    // 떨어졌다면 24 + 초안 5 + 1 = 30 이라 올라간다.
    await paste(page, { name: 'extra.png', type: 'image/png' })
    await expect(page.getByTestId('ai-composer-attachments')).toContainText('extra.png')
    await expect(toast(page, PER_SESSION_LIMIT_MSG)).toHaveCount(0)
    await page.getByTestId('ai-composer-attachments').getByRole('listitem').filter({ hasText: 'extra.png' })
      .getByRole('button', { name: '첨부 제거' }).click()
    await expect(page.getByTestId('ai-composer-attachments').getByRole('listitem')).toHaveCount(5)

    // 다시 보내면 처음과 같은 fileIds 가 실린다.
    await page.getByTestId('chat-send').click()
    await starts.waitFor(2)
    const [first, second] = starts.bodies<HomeChatStartBody>()
    expect(first.fileIds).toEqual([7000, 7001, 7002, 7003, 7004])
    expect(second).toMatchObject({ sessionId: 's-retry', query: '', fileIds: first.fileIds })
    await expect(page.getByTestId('ai-composer-attachments')).toHaveCount(0)
  })

  test('새 대화로 옮기면 첨부 초안이 비고, 첫 응답으로 세션 id 가 정해질 땐 비지 않는다', async ({ authenticatedPage: page }) => {
    await stubUpload(page)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    await mockHomeChatGeneration(page, {
      gate,
      frames: [{ event: 'delta', data: { text: '답했어요' } }, { event: 'done', data: { sessionId: 's-first' } }],
    })
    await openPanel(page)
    await page.getByTestId('chat-input').fill('첫 질문')
    await page.getByTestId('chat-send').click()
    // 생성 중에 다음 질문용 첨부를 붙인다.
    await paste(page, { name: 'next.png', type: 'image/png' })
    await expect(page.getByTestId('ai-composer-attachments')).toContainText('next.png')
    release()
    await expect(page.getByTestId('chat-panel')).toContainText('답했어요')
    await expect(page.getByTestId('ai-composer-attachments')).toContainText('next.png')

    await page.getByTestId('chat-new-session').click()
    await expect(page.getByTestId('ai-composer-attachments')).toHaveCount(0)
  })

  test('업로드 도중 새 대화로 옮기면 늦게 끝난 파일은 새 대화 초안에 들어오지 않는다', async ({ authenticatedPage: page }) => {
    const upload = await stubUpload(page, { hold: true })
    await openPanel(page)
    await paste(page, { name: 'late.png', type: 'image/png' })
    await expect(page.getByTestId('ai-composer-uploading-chip')).toContainText('late.png')

    await page.getByTestId('chat-new-session').click()
    upload.release()
    // 업로드가 끝나 진행 칩이 사라진 뒤에도 초안 칩은 생기지 않고, 보낼 것이 없어 보내기는 비활성이다.
    await expect(page.getByTestId('ai-composer-attachments')).toHaveCount(0)
    await expect(page.getByTestId('chat-send')).toHaveText('보내기')
    await expect(page.getByTestId('chat-send')).toBeDisabled()
  })
  // 1×1 PNG — 썸네일 원본 응답용.
  const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  )

  test('보낸 직후(세션 id 없음)에도 이미지는 로컬 미리보기로 보인다', async ({ authenticatedPage: page }) => {
    await stubUpload(page)
    const contents = trackRequests(page, 'GET', /\/api\/v1\/home\/sessions\/[^/]+\/attachments\/\d+\/content$/)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    await mockHomeChatGeneration(page, { gate, frames: [{ event: 'done', data: { sessionId: 's-new' } }] })
    await openPanel(page)
    await paste(page, { name: 'shot.png', type: 'image/png' })
    await expect(page.getByTestId('ai-composer-attachments')).toContainText('shot.png')
    await page.getByTestId('chat-send').click()
    const img = page.getByTestId('chat-turn').first().getByTestId('attachment-image-7000')
    await expect(img).toHaveAttribute('src', /^blob:/)
    await expect(img).toHaveAttribute('alt', 'shot.png')
    release()
    // 응답이 끝나 세션이 정해져도 미리보기를 그대로 쓰고 서버 원본을 다시 받지 않는다.
    await expect(img).toHaveAttribute('src', /^blob:/)
    await expectStays(page, contents.count, 0)
  })

  // 첨부만 보낸 메시지의 content — api 는 "" 로 저장·응답하지만 타입상 null 도 올 수 있어 둘 다 고정한다.
  for (const emptyContent of [null, ''] as const) {
    test(`세션 복원: 첨부만 보낸 메시지(content ${JSON.stringify(emptyContent)})도 썸네일·문서 카드로 다시 그리고, 카드는 내려받는다`, async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/home/sessions', {
        items: [{ id: 's-r', title: '첨부 대화', lastMessageAt: '2026-10-06T00:00:00Z', widgetCount: 0 }],
        nextCursor: null,
      } satisfies HomeSessionPage)
      const messages: HomeMessage[] = [
        {
          id: 1, role: 'USER', content: emptyContent, widgets: null, toolCalls: null, createdAt: '2026-10-06T00:00:00Z',
          attachments: [
            createHomeAttachment({ fileId: 77, originalName: 'board.png', mimeType: 'image/png', sizeBytes: 68 }),
            createHomeAttachment({ fileId: 78, originalName: 'spec.pdf' }),
          ],
        },
        { id: 2, role: 'ASSISTANT', content: '두 파일 모두 확인했어요', widgets: null, toolCalls: null, createdAt: '2026-10-06T00:00:01Z' },
      ]
      await mockApi(page, 'GET', '/api/v1/home/sessions/s-r/messages', messages)
      await page.route((u) => /^\/api\/v1\/home\/sessions\/s-r\/attachments\/(77|78)\/content$/.test(u.pathname), (r) =>
        r.fulfill({
          status: 200,
          contentType: r.request().url().endsWith('/77/content') ? 'image/png' : 'application/pdf',
          body: r.request().url().endsWith('/77/content') ? PNG_1X1 : Buffer.from('%PDF-1.4'),
        }))
      await openPanel(page)
      await page.getByTestId('chat-session-switcher').click()
      await page.getByTestId('chat-session-select').first().click()

      const turns = page.getByTestId('chat-panel').getByTestId('chat-turn')
      await expect(turns).toHaveCount(2)
      const userTurn = turns.first()
      await expect(userTurn.getByTestId('attachment-image-77')).toHaveAttribute('src', /^blob:/)
      await expect(userTurn.getByTestId('attachment-card-78')).toContainText('spec.pdf')
      // 첨부만 보낸 턴은 본문 말풍선이 없다.
      await expect(userTurn.getByTestId('chat-user-bubble')).toHaveCount(0)
      await expect(page.getByTestId('chat-panel')).toContainText('두 파일 모두 확인했어요')
      // 썸네일이 늦게 로드돼 높이가 커져도 맨 아래에 붙어 있다(useStickToBottom 의 ResizeObserver).
      await expect.poll(() => page.getByTestId('chat-scroll').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(2)

      const download = page.waitForEvent('download')
      await userTurn.getByTestId('attachment-card-78').click()
      expect((await download).suggestedFilename()).toBe('spec.pdf')
    })
  }

  test('세션 복원: 원본을 받지 못하면 썸네일 자리에 안내 문구', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/home/sessions', {
      items: [{ id: 's-e', title: '깨진 이미지', lastMessageAt: '2026-10-06T00:00:00Z', widgetCount: 0 }],
      nextCursor: null,
    } satisfies HomeSessionPage)
    await mockApi(page, 'GET', '/api/v1/home/sessions/s-e/messages', [
      {
        id: 1, role: 'USER', content: '이거 봐줘', widgets: null, toolCalls: null, createdAt: '2026-10-06T00:00:00Z',
        attachments: [createHomeAttachment({ fileId: 90, originalName: 'gone.png', mimeType: 'image/png' })],
      },
    ] satisfies HomeMessage[])
    await page.route((u) => u.pathname === '/api/v1/home/sessions/s-e/attachments/90/content', (r) =>
      r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ status: 404, error: 'Not Found', message: '없음' } satisfies ErrorResponse) }))
    await openPanel(page)
    await page.getByTestId('chat-session-switcher').click()
    await page.getByTestId('chat-session-select').first().click()
    const userTurn = page.getByTestId('chat-turn').first()
    await expect(userTurn).toContainText('이미지를 불러올 수 없습니다')
    await expect(userTurn).toContainText('이거 봐줘')
    // 본문 말풍선이 위, 첨부가 아래(시안 5-1).
    const bubble = await userTurn.getByTestId('chat-user-bubble').boundingBox()
    const atts = await userTurn.getByTestId('message-attachments').boundingBox()
    expect(bubble!.y + bubble!.height).toBeLessThanOrEqual(atts!.y)
  })
})
