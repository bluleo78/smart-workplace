// 설정 화면 테스트(WP-966 웨이브 3, b7) 공용 도우미 — 설정 가이드 시트·AI 묻기·Clipboard API 없는 환경을 화면 테스트에서 함께 쓴다.
// 가이드 본문의 「AI에게 묻기」는 AIAssistantProvider 를 요구하므로 실제 Provider 로 감싸고, 모드·채울 문구를 탐침으로 드러낸다.
import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { vi } from 'vitest'

import { AIAssistantProvider, useAssistant } from '@/components/ai/AIAssistantContext'
import { AiScreenContextProvider } from '@/components/ai/screen-context/AiScreenContextProvider'
import { useAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import type { AiScreenContext } from '@/types/aiScreenContext'

/** AI 모드·대기 문구를 글자로 드러낸다 — 「AI에게 묻기」가 패널을 열고 문구를 채웠는지 본다. */
// 테스트 도우미 파일이라 빠른 새로고침(react-refresh) 경계가 아니다.
// eslint-disable-next-line react-refresh/only-export-components
function AssistantProbe() {
  const { mode, promptSeed } = useAssistant()
  return <output data-testid="ai-probe" data-mode={mode} data-seed={promptSeed?.text ?? ''} />
}

/** 화면이 등록한 AI 화면 맥락(WP-54)을 JSON 글자로 드러낸다 — AI 패널이 전송 body 에 싣는 바로 그 값이다. */
// eslint-disable-next-line react-refresh/only-export-components
function ScreenContextProbe() {
  const ctx = useAiScreenContext()
  return <output data-testid="ctx-probe">{ctx ? JSON.stringify(ctx) : ''}</output>
}

/** 실제 AIAssistantProvider(단축키 끔)·화면 맥락 store 로 감싸고 탐침을 함께 그린다. */
export function withAssistant(ui: ReactElement) {
  return (
    <AiScreenContextProvider>
      <AIAssistantProvider hotkeysEnabled={false}>
        {ui}
        <AssistantProbe />
        <ScreenContextProbe />
      </AIAssistantProvider>
    </AiScreenContextProvider>
  )
}

/** 지금 등록된 화면 맥락(없으면 null) — withAssistant 로 감싼 화면에서 쓴다. */
export function screenContext() {
  const text = screen.getByTestId('ctx-probe').textContent
  return text ? (JSON.parse(text) as AiScreenContext) : null
}

/**
 * 헤더 「가이드」 버튼으로 설정 가이드 시트를 연다 — jsdom 은 본문 폭이 0 이라 늘 버튼(시트) 모드다.
 * 열 ↔ 버튼 전환·sticky 같은 폭 판정은 E2E(@layout)가 맡는다.
 */
export async function openGuideSheet(user: UserEvent) {
  await user.click(await screen.findByTestId('settings-guide-button'))
  return within(await screen.findByTestId('settings-guide-sheet'))
}

/**
 * Clipboard API 가 없는 환경(비보안 http 배포)을 흉내 낸다 — execCommand('copy') 대체 경로의 결과를 정하고,
 * 성공이면 숨긴 textarea 로 복사된 글자를 돌려준다(e2e/fixtures/clipboard.ts 와 같은 방식). 끝나면 restore 를 부른다.
 */
export function withoutClipboardApi(execOk: boolean) {
  const copied: string[] = []
  const prev = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => undefined })
  const exec = vi.fn(() => {
    // jsdom 의 select() 는 포커스를 옮기지 않아 activeElement 대신 copyText 가 붙인 숨긴 textarea(마지막 것)를 읽는다.
    const tas = document.querySelectorAll('textarea')
    if (execOk) copied.push(tas[tas.length - 1]?.value ?? '')
    return execOk
  })
  const prevExec = document.execCommand
  document.execCommand = exec as unknown as typeof document.execCommand
  return {
    copied,
    restore: () => {
      document.execCommand = prevExec
      if (prev) Object.defineProperty(navigator, 'clipboard', prev)
      else delete (navigator as { clipboard?: unknown }).clipboard
    },
  }
}
