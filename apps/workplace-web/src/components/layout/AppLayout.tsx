// src/components/layout/AppLayout.tsx
// 전역 셸 — 좌측 앱 런처 LNB + 모듈 콘텐츠 + AI 어시스턴트(칩/사이드/풀스크린). 상단 GNB 없음.
import { useEffect, useMemo } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { AIChip } from '@/components/ai/AIChip'
import { AIFullscreen } from '@/components/ai/AIFullscreen'
import { AISidePanel } from '@/components/ai/AISidePanel'
import { AiScreenContextProvider } from '@/components/ai/screen-context/AiScreenContextProvider'
import { AppRail } from '@/components/layout/AppRail'
import { InboxProvider } from '@/components/layout/InboxContext'
import { MailComposeProvider } from '@/components/mail/MailComposeContext'
import { MailComposeDock } from '@/components/mail/MailComposeDock'
import { MobileChromeProvider } from '@/components/mobile/MobileChromeContext'
import { MobileShell } from '@/components/mobile/MobileShell'
import { ChatSessionProvider } from '@/hooks/ChatSessionContext'
import { MessagingConnectionContext } from '@/hooks/MessagingConnectionContext'
import { useAiAvailable } from '@/hooks/useAiAvailable'
import { useAuth } from '@/hooks/useAuth'
import { useEventStream } from '@/hooks/useEventStream'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useIssueOriginTracker } from '@/hooks/useIssueOrigin'
import { openPushTarget, takePendingPushTarget } from '@/lib/push/openTarget'
import { syncPushOnLogin } from '@/lib/push/subscription'

export function AppLayout() {
  const { user, activeTenant, selectTenant } = useAuth()
  // AI 가용성 — 비서 없으면 AIChip·AISidePanel·AIFullscreen 미렌더.
  const aiAvailable = useAiAvailable()
  // WP-121: 모바일(<lg) 여부 — 탭바 셸 / 데스크톱 레일 레이아웃 분기.
  const isMobile = useIsMobile()
  // 인증된 앱 셸에서 통합 실시간 SSE 를 1회 구독(유저당 단일 커넥션). chat·messaging·notify 이벤트를
  // 이름 prefix 로 fan-out 한다. 과거 3개 스트림(커넥션 3개)을 단일 /api/v1/events 로 통합(#506).
  const { isConnected } = useEventStream(user?.id ?? 0)
  // 연결 상태를 하위 채팅 UI(끊김 배너)로 전달 — isConnected 변동 시에만 새 value.
  const messagingConn = useMemo(() => ({ isConnected }), [isConnected])

  // 앱 진입(로그인·새로고침·테넌트 전환) 시 이 기기 구독을 서버에 재등록 — 계정 전환 시 소유자 이전·VAPID 키 변경 재구독.
  useEffect(() => {
    void syncPushOnLogin()
  }, [user?.id])

  // 이슈 상세의 "이전 화면으로 돌아가기"가 출발 화면을 찾도록 히스토리 위치를 기록(#885).
  useIssueOriginTracker()

  const navigate = useNavigate()
  // 로그인 전에 알림을 탭했다면 저장된 목적지로 1회 이동.
  useEffect(() => {
    const pending = takePendingPushTarget()
    if (pending) void openPushTarget(pending, { activeTenantId: activeTenant?.tenantId ?? null, selectTenant, navigate })
    // 최초 진입 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 열린 창에서 알림을 탭하면 SW 가 보내는 이동 요청.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== 'push-navigate') return
      void openPushTarget(
        { tenantId: typeof e.data.tenantId === 'number' ? e.data.tenantId : null, url: e.data.url },
        { activeTenantId: activeTenant?.tenantId ?? null, selectTenant, navigate },
      )
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [activeTenant, selectTenant, navigate])

  return (
    <MailComposeProvider>
      <MobileChromeProvider>
      <ChatSessionProvider>
        <AIAssistantProvider hotkeysEnabled={aiAvailable}>
          {/* WP-54: 화면 컨텍스트 store — 페이지(Outlet)가 등록하고 AI 패널이 읽는다. */}
          <AiScreenContextProvider>
            {/* 인박스 패널 오픈 상태를 AppRail(InboxPanel)·본문이 공유 — 합성 레이어가 패널을 연다. */}
            <InboxProvider>
              {/* 메시징 SSE 연결 상태를 하위 채팅 UI(ChatModuleLayout 끊김 배너)로 전달 */}
              <MessagingConnectionContext.Provider value={messagingConn}>
                {/* WP-121: 모바일(<lg)은 탭바 셸, 데스크톱은 기존 레일 레이아웃(DOM 불변). */}
                {isMobile ? (
                  // WP-54 표식 유지 — display:contents 로 레이아웃 영향 없이 페이지 영역 컨테이너 역할.
                  <div data-ai-page-root className="contents">
                    <MobileShell overlay={aiAvailable ? <AIFullscreen /> : null}>
                      <Outlet />
                    </MobileShell>
                  </div>
                ) : (
                  /* WP-54: 페이지 영역 컨테이너 표식 — side 모드 엔티티 다이얼로그가 열리면 AI 패널 외 자식(AppRail·main)을 inert. */
                  <div data-ai-page-root className="flex h-screen overflow-hidden bg-background text-foreground">
                    <AppRail />
                    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden pt-12 lg:pt-0">
                      <Outlet />
                      {/* 풀스크린 — main 의 absolute inset-0 자식 → 콘텐츠 영역만 덮음(AppRail 미포함). 비서 있을 때만. */}
                      {aiAvailable && <AIFullscreen />}
                    </main>
                    {/* 사이드 패널 — flex 형제로 본문을 밀어냄(reflow). mode!=='side' 면 null. 비서 있을 때만. */}
                    {aiAvailable && <AISidePanel />}
                  </div>
                )}
              </MessagingConnectionContext.Provider>
            </InboxProvider>
            {/* AI 칩 — fixed 상단 중앙, 데스크톱 전용(모바일은 탭바 가운데 AI 가 대신한다). 비서 있을 때만. */}
            {aiAvailable && !isMobile && <AIChip />}
          </AiScreenContextProvider>
        </AIAssistantProvider>
      </ChatSessionProvider>
      </MobileChromeProvider>
      {/* 메일 작성 도크 — fixed, 앱 전역. draft 없으면 null. */}
      <MailComposeDock />
    </MailComposeProvider>
  )
}
