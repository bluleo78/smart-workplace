// src/components/layout/AppLayout.tsx
// 전역 셸 — 좌측 앱 런처 LNB + 모듈 콘텐츠 + 전역 챗 도크. 상단 GNB 없음.
import { Outlet } from 'react-router-dom'

import { AppRail } from '@/components/layout/AppRail'
import { GlobalChatDock } from '@/components/layout/GlobalChatDock'
import { MailComposeDock } from '@/components/mail/MailComposeDock'
import { MailComposeProvider } from '@/components/mail/MailComposeContext'
import { HomeSessionProvider } from '@/hooks/HomeSessionContext'
import { useChatStream } from '@/hooks/useChatStream'
import { useNotificationStream } from '@/hooks/useNotificationStream'

export function AppLayout() {
  // 인증된 앱 셸에서 chat 실시간 SSE 를 1회 구독 (유저당 글로벌 스트림).
  useChatStream()

  // 알림 실시간 SSE 를 앱 셸에서 1회 구독.
  useNotificationStream()

  return (
    // MailComposeProvider 를 AppLayout 수준에 두어 메일 모듈 이탈 시에도 draft 상태를 유지한다.
    <MailComposeProvider>
      <HomeSessionProvider>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          <AppRail />
          <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden pt-12 lg:pt-0">
            <Outlet />
            <GlobalChatDock />
          </main>
        </div>
        {/* 메일 작성 도크 — fixed 포지셔닝으로 앱 전역에서 렌더. draft 없으면 null. */}
        <MailComposeDock />
      </HomeSessionProvider>
    </MailComposeProvider>
  )
}
