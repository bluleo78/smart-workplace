// 설정 화면 테스트(WP-966 웨이브 3, b7) 공용 도우미 — AI Provider 감싸개·Clipboard API 없는 환경을 화면 테스트에서 함께 쓴다.
// 화면 맥락 단언은 @/test/kits/ai/ScreenContextProbe 를 쓴다(설정 가이드의 「AI에게 묻기」 탐침은 가이드와 함께 지웠다, WP-1508).
import type { ReactElement } from 'react'
import { vi } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { AiScreenContextProvider } from '@/components/ai/screen-context/AiScreenContextProvider'

/** 실제 AIAssistantProvider(단축키 끔)·화면 맥락 store 로 감싼다 — 화면 안 AI 진입점이 Provider 를 요구한다. */
export function withAssistant(ui: ReactElement) {
  return (
    <AiScreenContextProvider>
      <AIAssistantProvider hotkeysEnabled={false}>
        {ui}
      </AIAssistantProvider>
    </AiScreenContextProvider>
  )
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
