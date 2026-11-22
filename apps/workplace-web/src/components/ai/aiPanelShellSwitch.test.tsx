// @vitest-environment jsdom
// 셸 전환 틈의 inert 회귀 테스트 — WP-1966.
// 왜: Chromium 은 창 폭이 경계를 넘을 때 mql.matches 를 change 이벤트보다 먼저 바꾼다(새 matches → resize → change).
// 그 틈에 다이얼로그만 다시 그려지면 useIsMobile 이 live 값을 읽어 "새 폭"을 보고, 아직 옛 셸인 DOM 에 inert 를 건다.
// 이후 change 로 셸이 새로 그려져도 다이얼로그의 isMobile 은 이미 같은 값이라 effect 가 다시 돌지 않아 새 셸은 inert 가 아니었다.
// 훅이 change 때만 바뀌는 렌더 스냅샷을 읽으면 틈 동안 모든 컴포넌트가 같은(옛) 값을 본다.
// 실제 useIsMobile·useAiPanelAwareDialog 를 쓰고 AI 패널 모드(assistant)만 side 로 고정한다.
import { act, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useAiPanelAwareDialog } from '@/components/ai/useAiPanelAwareDialog'
import { useIsMobile } from '@/hooks/useIsMobile'
import { MOBILE_MEDIA_QUERY } from '@/lib/mobile/breakpoint'
import { installFakeMatchMedia } from '@/test/fakeMatchMedia'

vi.mock('@/components/ai/AIAssistantContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOptionalAssistant: () => ({ mode: 'side', close: () => {} }),
}))

// 스토어가 MediaQueryList 를 첫 사용 시 한 번만 만들어 캐시하므로 파일 안에서 하나만 설치한다.
const fake = installFakeMatchMedia()
/** 브라우저처럼 matches 를 먼저 바꾼다 — change 는 아직 안 나간 틈. */
const flipMatches = (v: boolean) => fake.setMatches(MOBILE_MEDIA_QUERY, v)
/** change 이벤트 발사. */
const fireChange = () => act(() => fake.fire(MOBILE_MEDIA_QUERY))
/** 스토어를 주어진 폭으로 맞춘다(matches 변경 + change) — 테스트 시작 상태 정리. */
const settle = (v: boolean) => {
  flipMatches(v)
  fireChange()
}

// 다이얼로그를 밖에서 다시 그리게 하는 핸들 — 다이얼로그가 마운트 뒤 채운다.
const dialogHandle: { rerender: () => void } = { rerender: () => {} }

/** 폭에 따라 key 가 바뀌어 DOM 이 새로 그려지는 셸 — 앱의 데스크톱↔모바일 셸 교체를 흉내낸다. */
function Shell() {
  const isMobile = useIsMobile()
  return (
    <div data-ai-page-root>
      <div key={isMobile ? 'mobile' : 'desktop'} data-testid="shell-child" data-shell={isMobile ? 'mobile' : 'desktop'} />
    </div>
  )
}

/** side 모드 다이얼로그 — 셸과 별개로 다시 그려질 수 있게 강제 리렌더 핸들을 밖으로 낸다. */
function Dialog() {
  const [, setN] = useState(0)
  useEffect(() => {
    dialogHandle.rerender = () => setN((n) => n + 1)
  }, [])
  useAiPanelAwareDialog({ open: true, size: 'default' })
  return null
}

/** 셸과 다이얼로그를 형제로 띄운다 — 다이얼로그만 다시 그려도 셸은 그대로 남는다. */
function Harness() {
  return (
    <>
      <Shell />
      <Dialog />
    </>
  )
}

/** 틈 안에서 새로 마운트되는 소비자 — 자기가 본 폭을 글자로 낸다. */
function Consumer() {
  return <span data-testid="consumer">{useIsMobile() ? 'mobile' : 'desktop'}</span>
}

describe('셸 전환 틈의 inert (WP-1966)', () => {
  it.each([
    ['데스크톱 → 모바일', false, true],
    ['모바일 → 데스크톱', true, false],
  ])('change 전에 다이얼로그만 다시 그려져도 새 셸이 inert 다 — %s', (_name, from, to) => {
    settle(from)
    render(<Harness />)
    expect(screen.getByTestId('shell-child').dataset.shell).toBe(from ? 'mobile' : 'desktop')

    flipMatches(to)
    act(() => dialogHandle.rerender())
    fireChange()

    const child = screen.getByTestId('shell-child')
    expect(child.dataset.shell).toBe(to ? 'mobile' : 'desktop')
    expect((child as HTMLElement & { inert: boolean }).inert).toBe(true)
  })

  it('change 전에 새로 마운트해도 같은 폭을 본다', () => {
    settle(false)
    render(<Shell />)
    flipMatches(true)

    render(<Consumer />)
    // 틈 동안은 셸과 새 소비자가 같은(옛) 값이다.
    expect(screen.getByTestId('consumer').textContent).toBe('desktop')
    expect(screen.getByTestId('shell-child').dataset.shell).toBe('desktop')

    fireChange()
    expect(screen.getByTestId('consumer').textContent).toBe('mobile')
    expect(screen.getByTestId('shell-child').dataset.shell).toBe('mobile')
  })
})
