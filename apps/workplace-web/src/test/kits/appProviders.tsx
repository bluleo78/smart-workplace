// 화면 테스트(renderScreen) 앱 상태 Provider 감싸개(WP-1002) — AI 패널·모바일 헤더·인박스처럼 AppLayout 의 상태 Provider 를 읽는
// 화면을 앱 셸(레일·탭바·이벤트 스트림) 없이 띄운다. 네트워크를 부르지 않는 Provider 만 AppLayout 과 같은 순서로 감싼다.
import type { ReactElement } from 'react'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { AiScreenContextProvider } from '@/components/ai/screen-context/AiScreenContextProvider'
import { InboxProvider } from '@/components/layout/InboxContext'
import { MailComposeProvider } from '@/components/mail/MailComposeContext'
import { MobileChromeProvider } from '@/components/mobile/MobileChromeContext'
import { ChatSessionProvider } from '@/hooks/ChatSessionContext'

/** AppLayout 의 상태 Provider 로 ui 를 감싼다 — 단축키는 끈다(테스트 키 입력이 AI 패널을 열지 않게). */
export function withAppProviders(ui: ReactElement) {
  return (
    <MailComposeProvider>
      <MobileChromeProvider>
        <ChatSessionProvider>
          <AIAssistantProvider hotkeysEnabled={false}>
            <AiScreenContextProvider>
              <InboxProvider>{ui}</InboxProvider>
            </AiScreenContextProvider>
          </AIAssistantProvider>
        </ChatSessionProvider>
      </MobileChromeProvider>
    </MailComposeProvider>
  )
}
