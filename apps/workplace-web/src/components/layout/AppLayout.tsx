// src/components/layout/AppLayout.tsx
// 전역 셸 — 좌측 앱 런처 LNB + 모듈 콘텐츠 + AI 어시스턴트(칩/사이드/풀스크린). 상단 GNB 없음.
import { Outlet } from 'react-router-dom'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { AIChip } from '@/components/ai/AIChip'
import { AIFullscreen } from '@/components/ai/AIFullscreen'
import { AISidePanel } from '@/components/ai/AISidePanel'
import { AppRail } from '@/components/layout/AppRail'
import { MailComposeProvider } from '@/components/mail/MailComposeContext'
import { MailComposeDock } from '@/components/mail/MailComposeDock'
import { HomeSessionProvider } from '@/hooks/HomeSessionContext'
import { useChatStream } from '@/hooks/useChatStream'
import { useNotificationStream } from '@/hooks/useNotificationStream'

export function AppLayout() {
  // 인증된 앱 셸에서 chat 실시간 SSE 를 1회 구독 (유저당 글로벌 스트림).
  useChatStream()
  // 알림 실시간 SSE 를 앱 셸에서 1회 구독.
  useNotificationStream()

  return (
    <MailComposeProvider>
      <HomeSessionProvider>
        <AIAssistantProvider>
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
          {/* AI 칩 — fixed 상단 중앙. */}
          <AIChip />
        </AIAssistantProvider>
      </HomeSessionProvider>
      {/* 메일 작성 도크 — fixed, 앱 전역. draft 없으면 null. */}
      <MailComposeDock />
    </MailComposeProvider>
  )
}
