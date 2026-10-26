// 모바일 셸(WP-123) — 페이지 테스트(WP-971, WP-981).
// 탭바 배지·탭 이동·활성 표시, AI 탭 시트 열고 닫기, AI 미사용 6칸, 탭 편집 안내 문구는 조건부 렌더·주소라
// 브라우저 없이 판정되므로 e2e/pages/mobile/shell.spec.ts 에서 옮겼다.
// 칸 크기·돌출·겹침(@layout)과 실제 뷰포트 리사이즈(1024 경계·375↔402 폭 전환, @layout)는 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { renderMobile } from '@/test/kits/mobile/shell'
import { PAGE_LOAD_TIMEOUT } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { createUser } from '../../../e2e/factories/auth.factory'

// iPhone 13(390px)·터치 — 7칸 탭바.
mockViewport()

/** 탭바의 칸 testid 를 순서대로 — 배지·AI 캡슐 같은 부속 요소는 뺀다(E2E 의 같은 선택자). */
function tabIds() {
  return [...within(screen.getByTestId('mobile-tabbar')).queryAllByTestId(/^mobile-tab-/)]
    .map((el) => el.getAttribute('data-testid'))
    .filter((id) => !id!.startsWith('mobile-tab-badge') && id !== 'mobile-tab-ai-capsule')
}

describe('탭바', () => {
  // 칸 구성·순서와 활성 표시 — 레일·햄버거·데스크톱 AI 런처는 모바일 셸에 없어야 한다.
  test('홈: 7칸(홈·채팅·메일 | AI | 캘린더·드라이브·앱), 홈이 aria-current, 레일·햄버거·런처 없음', async () => {
    renderMobile('/')
    await screen.findByTestId('mobile-tabbar', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(tabIds()).toEqual([
      'mobile-tab-home', 'mobile-tab-chat', 'mobile-tab-mail', 'mobile-tab-ai', 'mobile-tab-calendar', 'mobile-tab-drive', 'mobile-tab-apps',
    ])
    expect(screen.getByTestId('mobile-tab-home')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByTestId('app-rail')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rail-mobile-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-launcher')).not.toBeInTheDocument()
  })

  // 채널 미읽음 합계가 채팅 칸 배지로 보이고, 칸을 누르면 그 탭 루트로 가며 활성 표시가 옮겨 간다.
  test('채팅 미읽음 배지 3 → 채팅 탭 이동, aria-current 이동', async () => {
    const { user, location } = renderMobile('/', {}, { unread: 3 })
    expect(await screen.findByTestId('mobile-tab-badge-chat', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('3')
    await user.click(screen.getByTestId('mobile-tab-chat'))
    await waitFor(() => expect(location()).toBe('/chat'))
    await waitFor(() => expect(screen.getByTestId('mobile-tab-chat')).toHaveAttribute('aria-current', 'page'))
  })

  // WP-191: AI 는 탭이 아니라 시트 — 열림은 aria-expanded 로 알리고 데스크톱 side 패널은 없다. 다른 탭을 누르면 시트를 닫고 그 탭으로 간다.
  test('AI 탭은 시트를 열고(aria-expanded, side 패널 없음) 다른 탭을 누르면 닫히며 이동한다', async () => {
    const { user, location } = renderMobile('/')
    await user.click(await screen.findByTestId('mobile-tab-ai', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    expect(await screen.findByTestId('ai-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-tab-ai')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByTestId('ai-side-panel')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('mobile-tab-chat'))
    await waitFor(() => expect(screen.queryByTestId('ai-sheet')).not.toBeInTheDocument())
    expect(location()).toBe('/chat')
  })

  // AI 를 못 쓰는 사용자는 가운데 AI 칸이 빠져 6칸이 된다.
  test('AI 미사용이면 AI 칸 없이 6칸', async () => {
    renderMobile('/', { user: createUser({ aiAvailable: false }), roles: [] })
    await screen.findByTestId('mobile-tabbar', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(screen.queryByTestId('mobile-tab-ai')).not.toBeInTheDocument()
    expect(tabIds()).toHaveLength(6)
  })
})

describe('탭바 순서 편집 안내(WP-880)', () => {
  // AI 칸이 없는 탭바인데 「가운데 AI 와 끝의 앱은 고정」이라고 안내하던 문제 — 안내는 AI 칸 유무를 따른다.
  test('AI 사용 가능: 「가운데 AI 와 끝의 앱은 고정」', async () => {
    renderMobile('/apps/tabs')
    expect(await screen.findByTestId('tab-edit-intro', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent(
      '가운데 AI 와 끝의 앱은 고정입니다. 나머지 5칸을 고르세요.',
    )
  })

  test('AI 미사용: 「끝의 앱은 고정」', async () => {
    renderMobile('/apps/tabs', { user: createUser({ aiAvailable: false }), roles: [] })
    expect(await screen.findByTestId('tab-edit-intro', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent(
      /^끝의 앱은 고정입니다\. 나머지 5칸을 고르세요\.$/,
    )
  })
})
