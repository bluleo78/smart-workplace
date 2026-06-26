// src/components/layout/AppLayout.tsx
// 전역 셸 — 좌측 앱 런처 LNB + 모듈 콘텐츠 + AI 어시스턴트(칩/사이드/풀스크린). 상단 GNB 없음.
import { useMemo } from 'react'
import { Outlet } from 'react-router-dom'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { AIChip } from '@/components/ai/AIChip'
import { AIFullscreen } from '@/components/ai/AIFullscreen'
import { AISidePanel } from '@/components/ai/AISidePanel'
import { AppRail } from '@/components/layout/AppRail'
import { InboxProvider } from '@/components/layout/InboxContext'
import { MailComposeProvider } from '@/components/mail/MailComposeContext'
import { MailComposeDock } from '@/components/mail/MailComposeDock'
import { ChatSessionProvider } from '@/hooks/ChatSessionContext'
import { MessagingConnectionContext } from '@/hooks/MessagingConnectionContext'
import { useAuth } from '@/hooks/useAuth'
import { useChatStream } from '@/hooks/useChatStream'
import { useMessageStream } from '@/hooks/useMessageStream'
import { useNotificationStream } from '@/hooks/useNotificationStream'

export function AppLayout() {
  const { user } = useAuth()
  // 인증된 앱 셸에서 chat 실시간 SSE 를 1회 구독 (유저당 글로벌 스트림).
  useChatStream()
  // 알림 실시간 SSE 를 앱 셸에서 1회 구독.
  useNotificationStream()
  // 메시징 실시간 SSE 도 형제 스트림과 동일하게 앱 셸에서 1회 구독해 세션 내내 유지한다.
  // (과거 ChatModuleLayout 에 묶여 "대화" 모듈 진입마다 재연결 → "실시간 연결 중" 배너 깜빡임을 유발)
  const { isConnected } = useMessageStream(user?.id ?? 0)
  // 연결 상태를 하위 채팅 UI(끊김 배너)로 전달 — isConnected 변동 시에만 새 value.
  const messagingConn = useMemo(() => ({ isConnected }), [isConnected])

  return (
    <MailComposeProvider>
      <ChatSessionProvider>
        <AIAssistantProvider>
          {/* 인박스 패널 오픈 상태를 AppRail(InboxPanel)·본문이 공유 — 합성 레이어가 패널을 연다. */}
          <InboxProvider>
            {/* 메시징 SSE 연결 상태를 하위 채팅 UI(ChatModuleLayout 끊김 배너)로 전달 */}
            <MessagingConnectionContext.Provider value={messagingConn}>
              <div className="flex h-screen overflow-hidden bg-background text-foreground">
                <AppRail />
                <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden pt-12 lg:pt-0">
                  <Outlet />
                  {/* 풀스크린 — main 의 absolute inset-0 자식 → 콘텐츠 영역만 덮음(AppRail 미포함). */}
                  <AIFullscreen />
                </main>
                {/* 사이드 패널 — flex 형제로 본문을 밀어냄(reflow). mode!=='side' 면 null. */}
                <AISidePanel />
              </div>
            </MessagingConnectionContext.Provider>
          </InboxProvider>
          {/* AI 칩 — fixed 상단 중앙. */}
          <AIChip />
        </AIAssistantProvider>
      </ChatSessionProvider>
      {/* 메일 작성 도크 — fixed, 앱 전역. draft 없으면 null. */}
      <MailComposeDock />
    </MailComposeProvider>
  )
}
