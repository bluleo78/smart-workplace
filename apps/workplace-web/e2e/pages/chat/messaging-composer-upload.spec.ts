// MessageComposer 파일 업로드 중 전송 차단 회귀 테스트 (#152).
// 업로드 중 전송 버튼이 비활성화되는지, Enter 키도 차단되는지 검증한다.
// 백엔드 없이 page.route() 로 API 모킹 (업로드 API 지연 처리로 업로드 중 상태 재현).
import { Buffer } from 'buffer'

import { expect, test } from '../../fixtures/auth.fixture'
import {
  createChannel,
  createChannelMember,
} from '../../factories/messaging.factory'

const CHANNEL_ID = 800

// ── 공통 stub helpers ──────────────────────────────────────────────────────────

async function stubCommon(page: import('@playwright/test').Page) {
  const channel = createChannel({ id: CHANNEL_ID, name: '업로드테스트' })

  // 채널 목록
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([channel]) })
        : route.fallback(),
  )

  // DM 목록
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/dms',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        : route.fallback(),
  )

  // SSE 스트림 (빈 스트림)
  await page.route(
    (url) => url.pathname === '/api/v1/events',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: `:\n\n`,
      }),
  )

  // 채널 상세
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(channel) })
        : route.fallback(),
  )

  // 채널 멤버
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/members`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([createChannelMember({ userId: 1, name: '테스트 사용자', kind: 'HUMAN' })]),
          })
        : route.fallback(),
  )

  // 메시지 목록 (빈 목록)
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
          })
        : route.fallback(),
  )

  // 읽음 처리
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/read`,
    (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 204, contentType: 'application/json', body: '' })
        : route.fallback(),
  )

  // 멘션 후보(@에이전트 목록)
  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ content: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }),
          })
        : route.fallback(),
  )

  return channel
}

// ── tests ──────────────────────────────────────────────────────────────────────

test.describe('MessageComposer — 파일 업로드 중 전송 차단 (#152)', () => {
  test(
    '업로드 중 전송 버튼 비활성 — 텍스트 있어도 disabled 유지',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await stubCommon(page)

      // 업로드 API 를 지연(1 초)시켜 "업로드 중" 상태를 재현.
      // resolve 콜백을 외부로 노출해 테스트에서 타이밍을 제어한다.
      let resolveUpload!: () => void
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/attachments`,
        async (route) => {
          // 테스트가 명시적으로 resolve 할 때까지 대기.
          await new Promise<void>((res) => { resolveUpload = res })
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{ fileId: 9001, originalName: 'test.txt', mimeType: 'text/plain', sizeBytes: 5 }]),
          })
        },
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)
      await expect(page.getByTestId('message-composer')).toBeVisible()

      // 텍스트 입력 — 빈 입력 비활성 해제
      await page.getByTestId('message-composer-input').click()
      await page.keyboard.type('안녕하세요')

      // 텍스트만 있을 때 버튼은 활성 상태여야 한다 (정상 케이스)
      await expect(page.getByTestId('message-composer-submit')).toBeEnabled()

      // 파일 업로드 트리거 (UI 클릭 없이 hidden input 에 직접 setInputFiles)
      await page.locator('[data-testid="composer-file-input"]').setInputFiles({
        name: 'test.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello'),
      })

      // ── 업로드 중: 버튼이 비활성화되어야 한다 (#152 핵심 검증) ──
      await expect(page.getByTestId('message-composer-submit')).toBeDisabled()
      // 라벨도 '업로드 중…' 이어야 한다
      await expect(page.getByTestId('message-composer-submit')).toHaveText('업로드 중…')

      // 업로드 완료
      resolveUpload()

      // ── 업로드 완료 후: 버튼이 다시 활성화되어야 한다 ──
      await expect(page.getByTestId('message-composer-submit')).toBeEnabled()
      await expect(page.getByTestId('message-composer-submit')).toHaveText('보내기')
    },
  )

  test(
    '업로드 중 전송 시 메시지 전송 API 미호출 — 첨부 누락 전송 방지',
    async ({ authenticatedPage: page }) => {
      await stubCommon(page)

      // POST 전송 API 호출 감지용 (호출되면 안 됨)
      let messageSentCount = 0
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
        (route) => {
          if (route.request().method() === 'POST') {
            messageSentCount++
            return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
          }
          return route.fallback()
        },
      )

      // 업로드 API 지연 — 테스트에서 완료 시점 제어
      let resolveUpload!: () => void
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/attachments`,
        async (route) => {
          await new Promise<void>((res) => { resolveUpload = res })
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{ fileId: 9002, originalName: 'test.txt', mimeType: 'text/plain', sizeBytes: 5 }]),
          })
        },
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)
      await expect(page.getByTestId('message-composer')).toBeVisible()

      await page.getByTestId('message-composer-input').click()
      await page.keyboard.type('첨부 없이 전송 시도')

      // 파일 업로드 트리거
      await page.locator('[data-testid="composer-file-input"]').setInputFiles({
        name: 'test.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello'),
      })

      // 업로드 중 — 전송 버튼이 비활성이므로 클릭해도 POST 가 발생하지 않아야 한다.
      await expect(page.getByTestId('message-composer-submit')).toBeDisabled()

      // 비활성 버튼 강제 클릭 시도 (Playwright force 옵션) — 실제 click 은 막혀야 한다.
      // RichInput submit() 내 submitDisabledRef 가드가 Enter 경로도 차단.
      await page.getByTestId('message-composer-submit').click({ force: true })

      // 메시지 전송 API 미호출 확인 (100ms 후에도 0건)
      await page.waitForTimeout(100)
      expect(messageSentCount).toBe(0)

      // 업로드 완료 → 이후 정상 전송 가능
      resolveUpload()
      await expect(page.getByTestId('message-composer-submit')).toBeEnabled()
    },
  )
})
