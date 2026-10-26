// 모바일 AI 시트(WP-191) — 페이지 테스트(WP-981).
// 탭바 ✦ 칸의 열림 상태(aria-expanded·토글)와 보던 탭 강조 유지, 탭 루트 목록에서 연 시트의 화면 참고 칩 문구(없는 화면 포함)는
// 브라우저 없이 판정되므로 e2e/pages/mobile/ai-sheet.spec.ts 에서 옮겼다. 생성 중·완료 표시(스트리밍 @platform), 시트 위치·키보드·
// 애니메이션·겹침(@layout), 끌어 닫기·터치 스크롤(@input)은 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { wikiPageSummary, wikiSpace } from '../../../e2e/factories/wiki.factory'

mockViewport()

/** path 를 열고 탭바 ✦ 로 AI 시트를 연다. */
async function openSheetAt(path: string, handlers: RequestHandler[] = []) {
  const view = renderPage(path, { handlers })
  await view.user.click(await screen.findByTestId('mobile-tab-ai', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  return { ...view, sheet: await screen.findByTestId('ai-sheet') }
}

// AI 칸은 화면이 아니라 시트 — 보던 탭의 aria-current 를 빼앗지 않고, 열림은 aria-expanded 로만 알린다. 다시 누르면 닫힌다.
test('AI 를 열어도 보던 탭 강조가 유지되고 AI 칸은 열림 상태만 갖는다', async () => {
  const { user } = await openSheetAt('/chat')
  const ai = screen.getByTestId('mobile-tab-ai')
  expect(screen.getByTestId('mobile-tab-chat')).toHaveAttribute('aria-current', 'page')
  expect(ai).toHaveAttribute('aria-expanded', 'true')
  expect(ai).not.toHaveAttribute('aria-current')
  await user.click(ai)
  await waitFor(() => expect(ai).toHaveAttribute('aria-expanded', 'false'))
})

// 탭 루트 목록에서 연 시트도 「지금 보는 목록」을 화면 참고 칩으로 보인다(WP-191).
describe('목록 화면 컨텍스트 칩', () => {
  for (const [path, label] of [
    ['/chat', '채팅 목록'],
    ['/tasks', '작업 목록'],
    ['/drive', '드라이브 공간 목록'],
  ] as const) {
    test(`${path} 목록에서 연 시트에 화면 참고 칩: ${label}`, async () => {
      const { sheet } = await openSheetAt(path, [
        // 드라이브는 공간 목록 화면에서 쿼터를 부른다.
        http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 })),
      ])
      expect(await within(sheet).findByTestId('chat-context-chip')).toHaveTextContent(label)
    })
  }

  // 위젯 본문은 비워 둔 최소 레이아웃 — 칩은 레이아웃 해석만으로 등록된다.
  test('홈에서 연 시트에 화면 참고 칩: 홈 대시보드', async () => {
    const { sheet } = await openSheetAt('/', [
      http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
    ])
    expect(await within(sheet).findByTestId('chat-context-chip')).toHaveTextContent('홈 대시보드')
  })

  test('노트 공간 목록에서 연 시트에 화면 참고 칩: 위키 스페이스 이름', async () => {
    const { sheet } = await openSheetAt('/wiki/spaces/1', [
      http.get('/api/v1/wiki/spaces', () => HttpResponse.json([wikiSpace({ id: 1, type: 'PERSONAL', name: '내 위키', role: 'OWNER' })])),
      http.get('/api/v1/wiki/spaces/1/pages', () => HttpResponse.json([wikiPageSummary({ id: 101, title: '개인 메모' })])),
    ])
    expect(await within(sheet).findByTestId('chat-context-chip')).toHaveTextContent('위키 스페이스 내 위키')
  })

  // 앱 목록은 참고할 데이터가 없는 런처 화면 — 칩을 등록하지 않는다.
  test('앱 목록에서 연 시트엔 칩이 없다', async () => {
    await openSheetAt('/apps')
    expect(await screen.findByTestId('chat-input')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-context-chip')).not.toBeInTheDocument()
  })
})
