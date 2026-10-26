// 메인 AI 채팅 첨부 입력창 (WP-234) — 데스크톱 사이드 패널.
// 브라우저가 있어야 판정되는 것만 남긴다 — ＋ 파일 선택 → 업로드 → 칩 → payload 대표 배선(@wiring), 붙여넣기·드롭·업로드 중 Enter(@input),
// 캔버스 이미지 축소(@platform), 썸네일 크기·하단 고정·오른쪽 끝 정렬·뷰어 ⬇ 받기(@layout).
// × 제거·세션 상한·서버 거절(400)·대화 전환·보낸 직후 미리보기·4종 밖 이미지·세션 복원 렌더·글자 수 상한(WP-674)은
// 화면 테스트 src/components/ai/AIChatPanel.test.tsx 가 지킨다(WP-971).
import { Buffer } from 'buffer'

import type { Page } from '@playwright/test'

import type { HomeMessage, HomeSessionPage, HomeUploadedFile } from '../../src/types/home'
import { createHomeAttachment } from '../factories/homeAttachment.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { type HomeChatStartBody, mockHomeChatGeneration } from '../fixtures/home-chat-mock'
import { solidPng } from '../fixtures/png'
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

test.describe('메인 AI 채팅 첨부 입력창 (WP-234)', () => {
  test('＋ 메뉴는 파일 첨부만 → 업로드 → 칩 → 전송 payload 에 fileIds', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
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

  test('스크린샷 붙여넣기 → 첨부만 전송(query 빈 문자열)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  test('텍스트와 렌더링 이미지가 함께 오는 붙여넣기는 텍스트로 두고 올리지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const uploads = trackRequests(page, 'POST', UPLOAD)
    await openPanel(page)
    expect(await paste(page, { name: 'render.png', type: 'image/png' }, '표에서 복사한 글')).toBe(false)
    await expectStays(page, uploads.count, 0)
    await expect(page.getByTestId('ai-composer-attachments')).toHaveCount(0)
  })

  test('파일 드롭 → 오버레이 → 칩', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  test('업로드 중엔 진행 칩이 보이고 보내기 버튼도 Enter 도 막히며, 끝나면 첨부와 함께 전송된다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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
    // 동작 줄이기 설정에선 스피너가 돌지 않는다(디자인 시스템 08 — 점선 테두리·sr-only 「업로드 중」이 상태를 대신 알린다).
    const spinner = page.getByTestId('ai-composer-uploading-chip').locator('svg')
    await expect.poll(() => spinner.evaluate((el) => getComputedStyle(el).animationName)).not.toBe('none')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect.poll(() => spinner.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
    await input.press('Enter')
    await expectStays(page, starts.count, 0)

    upload.release()
    await expect(send).toHaveText('보내기')
    await expect(page.getByTestId('ai-composer-uploading-chip')).toHaveCount(0)
    await expect(page.getByTestId('ai-composer-attachments')).toContainText('shot.png')
    await input.press('Enter')
    await expect.poll(() => starts.lastBody<HomeChatStartBody>()).toMatchObject({ query: '같이 보내요', fileIds: [7000] })
  })

  test('큰 PNG 는 긴 변 2048 JPEG 로 줄여 올리고, GIF 는 그대로 올린다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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

  // 썸네일 원본 응답용 — 128px 스켈레톤보다 커지는(최대 256px) 실제 크기 PNG 라야 "늦게 커져도 하단 고정"(W15) 경로를 탄다.
  const PNG_TALL = solidPng(600, 900)

  // 첨부만 보낸 메시지(content "")의 썸네일이 늦게 커져도 하단에 붙어 있고, 카드는 뷰어 ⬇ 로 받는다(다운로드).
  // content null/"" 두 모양의 렌더(썸네일·카드·말풍선 없음)는 AIChatPanel.test.tsx 가 본다.
  test('세션 복원: 첨부만 보낸 메시지의 썸네일이 늦게 커져도 맨 아래에 붙어 있고, 카드는 뷰어로 열어 ⬇ 로 받는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/home/sessions', {
      items: [{ id: 's-r', title: '첨부 대화', lastMessageAt: '2026-10-06T00:00:00Z', widgetCount: 0 }],
      nextCursor: null,
    } satisfies HomeSessionPage)
    const messages: HomeMessage[] = [
      {
        id: 1, role: 'USER', content: '', widgets: null, toolCalls: null, createdAt: '2026-10-06T00:00:00Z',
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
        body: r.request().url().endsWith('/77/content') ? PNG_TALL : Buffer.from('%PDF-1.4'),
      }))
    await openPanel(page)
    await page.getByTestId('chat-session-switcher').click()
    await page.getByTestId('chat-session-select').first().click()

    const turns = page.getByTestId('chat-panel').getByTestId('chat-turn')
    await expect(turns).toHaveCount(2)
    const userTurn = turns.first()
    await expect(userTurn.getByTestId('attachment-image-77')).toHaveAttribute('src', /^blob:/)
    // 스켈레톤(128px)보다 크게 그려졌는지 — 아래 하단 고정 단언이 높이 증가 경로를 검증한다는 전제.
    await expect.poll(async () => (await userTurn.getByTestId('attachment-image-77').boundingBox())?.height ?? 0).toBeGreaterThan(200)
    await expect(userTurn.getByTestId('attachment-card-78')).toContainText('spec.pdf')
    // 첨부만 보낸 턴은 본문 말풍선이 없다.
    await expect(userTurn.getByTestId('chat-user-bubble')).toHaveCount(0)
    await expect(page.getByTestId('chat-panel')).toContainText('두 파일 모두 확인했어요')
    // 썸네일이 늦게 로드돼 높이가 커져도 맨 아래에 붙어 있다(useStickToBottom 의 ResizeObserver).
    await expect.poll(() => page.getByTestId('chat-scroll').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(2)

    // WP-279: 카드는 바로 받지 않고 통합 뷰어로 연다 — 받기는 뷰어 ⬇.
    await userTurn.getByTestId('attachment-card-78').click()
    await expect(page.getByTestId('attachment-viewer')).toHaveAccessibleName('spec.pdf 미리보기')
    const download = page.waitForEvent('download')
    await page.getByTestId('preview-download').click()
    expect((await download).suggestedFilename()).toBe('spec.pdf')
  })

  // 사용자 턴의 오른쪽 끝 정렬 — 썸네일이 말풍선·문서 카드와 같은 x 에서 끝나야 한다(인라인 래퍼 회귀 방지).
  for (const mode of ['side', 'fullscreen'] as const) {
    test(`세션 복원(${mode}): 이미지 썸네일의 오른쪽 끝이 말풍선·문서 카드와 같다`, { tag: '@layout' }, async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/home/sessions', {
        items: [{ id: 's-a', title: '자료 모음', lastMessageAt: '2026-10-06T00:00:00Z', widgetCount: 0 }],
        nextCursor: null,
      } satisfies HomeSessionPage)
      await mockApi(page, 'GET', '/api/v1/home/sessions/s-a/messages', [
        {
          id: 1, role: 'USER', content: '자료 모음', widgets: null, toolCalls: null, createdAt: '2026-10-06T00:00:00Z',
          attachments: [
            createHomeAttachment({ fileId: 77, originalName: 'board.png', mimeType: 'image/png', sizeBytes: 68 }),
            createHomeAttachment({ fileId: 78, originalName: 'spec.pdf' }),
          ],
        },
      ] satisfies HomeMessage[])
      await page.route((u) => u.pathname === '/api/v1/home/sessions/s-a/attachments/77/content', (r) =>
        r.fulfill({ status: 200, contentType: 'image/png', body: solidPng(480, 320) }))
      await openPanel(page)
      if (mode === 'fullscreen') {
        await page.getByTestId('chat-launcher').click()
        await expect(page.getByTestId('ai-fullscreen')).toBeVisible()
        // 전체 화면은 좌측 목록에서 바로 고른다(스위처 드롭다운 없음).
        await page.getByTestId('chat-session-select').first().click()
        await expect(page.getByTestId('chat-turn').first()).toContainText('자료 모음')
      } else {
        await restoreFirstSession(page)
      }
      const turn = page.getByTestId('chat-turn').first()
      await expect(turn.getByTestId('attachment-image-77')).toHaveAttribute('src', /^blob:/)
      // 원본 비율 폭(256px 높이 기준 384px)이 20rem 상한(320px)보다 넓은 이미지라야 래퍼 폭 회귀를 잡는다.
      await expect.poll(async () => (await turn.getByTestId('attachment-image-77').boundingBox())?.width ?? 0).toBeGreaterThan(200)
      const right = async (id: string) => {
        const b = (await turn.getByTestId(id).boundingBox())!
        return b.x + b.width
      }
      const imgRight = await right('attachment-image-77')
      expect(Math.abs(imgRight - (await right('chat-user-bubble')))).toBeLessThanOrEqual(1)
      expect(Math.abs(imgRight - (await right('attachment-card-78')))).toBeLessThanOrEqual(1)
    })
  }
})
