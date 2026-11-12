// src/components/layout/AppLayout.tsx
// 전역 셸 — 좌측 앱 런처 LNB + 모듈 콘텐츠 + AI 어시스턴트(칩/사이드/풀스크린). 상단 GNB 없음.
import { useEffect, useMemo } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { AiChatDeepLink } from '@/components/ai/AiChatDeepLink'
import { AIChip } from '@/components/ai/AIChip'
import { LazyAIFullscreen, LazyMobileAiSheet } from '@/components/ai/LazyAiSurfaces'
import { AiScreenContextProvider } from '@/components/ai/screen-context/AiScreenContextProvider'
import { HelpPanelProvider } from '@/components/help/HelpPanelContext'
import { HelpTrigger } from '@/components/help/HelpTrigger'
import { MobileHelpSheet } from '@/components/help/MobileHelpSheet'
import { DashboardEditDraftProvider } from '@/components/home/dashboard/DashboardEditDraftContext'
import { AppRail } from '@/components/layout/AppRail'
import { HeaderDensityProvider } from '@/components/layout/HeaderDensityContext'
import { InboxProvider } from '@/components/layout/InboxContext'
import { NodeSlot, PageHost } from '@/components/layout/NodeSlot'
import { RightDock } from '@/components/layout/RightDock'
import { MAIN_CONTENT_ID, SkipToMainLink } from '@/components/layout/SkipToMainLink'
import { TopCenterSlot } from '@/components/layout/TopCenterSlot'
import { useNodeBridge } from '@/components/layout/useNodeBridge'
import { LazyMailComposeDock } from '@/components/mail/LazyMailComposeDock'
import { MailComposeProvider } from '@/components/mail/MailComposeContext'
import { MailComposeWindowSync } from '@/components/mail/MailComposeWindowSync'
import { MobileChromeProvider } from '@/components/mobile/MobileChromeContext'
import { MobileShell } from '@/components/mobile/MobileShell'
import { SearchPaletteHost } from '@/components/search/SearchPaletteHost'
import { SearchTrigger } from '@/components/search/SearchTrigger'
import { SendToChatHost } from '@/components/share/SendToChatHost'
import { useShareHotkeys } from '@/components/share/useShareHotkeys'
import { ChatSessionProvider } from '@/hooks/ChatSessionContext'
import { MessagingConnectionContext } from '@/hooks/MessagingConnectionContext'
import { useAppLinkConfig } from '@/hooks/queries/useAppLinks'
import { useAiAvailable } from '@/hooks/useAiAvailable'
import { useAuth } from '@/hooks/useAuth'
import { useEventStream } from '@/hooks/useEventStream'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useIssueOriginTracker } from '@/hooks/useIssueOrigin'
import { openPushTarget, takePendingPushTarget } from '@/lib/push/openTarget'
import { syncPushOnLogin } from '@/lib/push/subscription'

export function AppLayout() {
  const { user, activeTenant, selectTenant } = useAuth()
  // AI 가용성 — 비서 없으면 AIChip·AISidePanel·AIFullscreen·MobileAiSheet 미렌더.
  const aiAvailable = useAiAvailable()
  // WP-121: 모바일(<lg) 여부 — 탭바 셸 / 데스크톱 레일 레이아웃 분기.
  const isMobile = useIsMobile()
  // WP-1468: 페이지(Outlet) DOM 을 담는 분리된 호스트 — 셸이 바뀌어도 같은 노드를 새 셸의 슬롯으로 옮겨 붙인다.
  const pageBridge = useNodeBridge()
  // 인증된 앱 셸에서 통합 실시간 SSE 를 1회 구독(유저당 단일 커넥션). chat·messaging·notify 이벤트를
  // 이름 prefix 로 fan-out 한다. 과거 3개 스트림(커넥션 3개)을 단일 /api/v1/events 로 통합(#506).
  const { isConnected } = useEventStream(user?.id ?? 0)
  // 연결 상태를 하위 채팅 UI(끊김 배너)로 전달 — isConnected 변동 시에만 새 value.
  const messagingConn = useMemo(() => ({ isConnected }), [isConnected])
  // WP-1234 링크 단축키(⇧⌘, 링크 복사·⌘. 키 복사) — AI 사용 여부와 무관하게 앱 셸에서 한 번 건다.
  useShareHotkeys()

  // 앱 진입(로그인·새로고침·테넌트 전환) 시 이 기기 구독을 서버에 재등록 — 계정 전환 시 소유자 이전·VAPID 키 변경 재구독.
  useEffect(() => {
    void syncPushOnLogin()
  }, [user?.id])

  // 이슈 상세의 "이전 화면으로 돌아가기"가 출발 화면을 찾도록 히스토리 위치를 기록(#885).
  useIssueOriginTracker()
  // 채팅·노트의 앱 링크 판정에 쓸 공개 웹 주소 호스트(WP-1165) — 내부 주소로 접속해도 공개 주소 링크가 카드로 나오게.
  useAppLinkConfig()

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
          {/* WP-1505: 도움말 패널 상태(열림·폭·이동·? 단축키) — 아래 셸 분기 바깥이라 데스크톱·모바일 셸이 같은 상태를 본다. */}
          <HelpPanelProvider>
          {/* WP-54: 화면 컨텍스트 store — 페이지(Outlet)가 등록하고 AI 패널이 읽는다. */}
          <AiScreenContextProvider>
            <HeaderDensityProvider>
            {/* WP-384: /?aiChat=<id> 딥링크 — 패널을 열고 그 대화를 복원한다(비서가 있을 때만). */}
            {aiAvailable && <AiChatDeepLink />}
            {/* 인박스 패널 오픈 상태를 AppRail(InboxPanel)·본문이 공유 — 합성 레이어가 패널을 연다. */}
            <InboxProvider>
              {/* WP-162: 홈 편집 초안 저장소 — 아래 셸 분기(isMobile)보다 바깥에 둬야 lg 경계 리사이즈로 셸이 바뀌어
                  Dashboard 가 다시 마운트돼도 미저장 초안·편집 모드가 유지된다. */}
              <DashboardEditDraftProvider>
              {/* 메시징 SSE 연결 상태를 하위 채팅 UI(ChatModuleLayout 끊김 배너)로 전달 */}
              <MessagingConnectionContext.Provider value={messagingConn}>
                {/* WP-121: 모바일(<lg)은 탭바 셸, 데스크톱은 기존 레일 레이아웃(DOM 불변). */}
                {isMobile ? (
                  // WP-54 표식 유지 — display:contents 로 레이아웃 영향 없이 페이지 영역 컨테이너 역할.
                  <div data-ai-page-root className="contents">
                    {/* WP-1505: 도움말 시트 — AI 시트와 한 번에 하나(MobileHelpSheet 가 조정). 비서가 없어도 도움말은 연다. */}
                    <MobileShell
                      overlay={
                        <>
                          {aiAvailable && <LazyMobileAiSheet />}
                          <MobileHelpSheet />
                        </>
                      }
                    >
                      <NodeSlot bridge={pageBridge} />
                    </MobileShell>
                  </div>
                ) : (
                  /* WP-54: 페이지 영역 컨테이너 표식 — side 모드 엔티티 다이얼로그가 열리면 AI 패널 외 자식(AppRail·main)을 inert. */
                  <div data-ai-page-root className="flex h-screen overflow-hidden bg-background text-foreground">
                    {/* WP-815: 첫 Tab 위치 — 레일을 건너뛰고 본문으로. */}
                    <SkipToMainLink />
                    <AppRail />
                    {/* tabIndex=-1 — 「본문 바로가기」가 포커스를 줄 수 있게(Tab 순서에는 들지 않음). 포커스 링은 그리지 않는다. */}
                    <main
                      id={MAIN_CONTENT_ID}
                      tabIndex={-1}
                      className="relative flex min-w-0 flex-1 flex-col overflow-hidden pt-12 outline-none lg:pt-0"
                    >
                      <NodeSlot bridge={pageBridge} />
                      {/* 풀스크린 — main 의 absolute inset-0 자식 → 콘텐츠 영역만 덮음(AppRail 미포함). 비서 있을 때만. */}
                      {aiAvailable && <LazyAIFullscreen />}
                    </main>
                    {/* 오른쪽 도킹 — 도움말 패널(WP-1505)·AI 사이드 패널을 flex 형제로 붙여 본문을 밀어냄(reflow).
                        둘 다 열리면 나란히, 본문이 좁아지면 한 칸에 위아래. AI 패널은 비서 있을 때만. */}
                    <RightDock aiAvailable={aiAvailable} />
                  </div>
                )}
                {/* WP-1468: 페이지는 셸 분기 뒤 형제 자리에서 한 번만 렌더 — 셸이 바뀌어도 다시 마운트되지 않고 각 셸의 NodeSlot 이 호스트 DOM 을 옮겨 붙인다(이유는 NodeSlot.tsx·useNodeBridge.ts). */}
                <PageHost bridge={pageBridge}><Outlet /></PageHost>
              </MessagingConnectionContext.Provider>
              </DashboardEditDraftProvider>
            </InboxProvider>
            {/* AI 칩 — fixed 상단 중앙, 데스크톱 전용(모바일은 탭바 가운데 AI 가 대신한다). 비서 있을 때만.
                WP-1353: 칩 오른쪽에 통합 검색 트리거(가운데 팔레트). 비서가 없으면 검색이 칩 자리에 선다.
                WP-1505: 검색 오른쪽에 도움말 「?」 — 비서가 있든 없든 검색 → 도움말 순서. */}
            {!isMobile && (
              <TopCenterSlot trailing={aiAvailable ? <><SearchTrigger /><HelpTrigger /></> : <HelpTrigger />}>
                {aiAvailable ? <AIChip /> : <SearchTrigger />}
              </TopCenterSlot>
            )}
            {/* WP-1356·WP-1354: 모바일은 상단 🔍 트리거 대신 탭 첫 화면 헤더 🔍·다른 화면이 openSearchPalette 로 열고, 전체 화면 검색은 이 호스트 하나가 그린다(뒤로 가기로 닫힘). */}
            {isMobile && <SearchPaletteHost />}
            {/* 메일 작성 도크 — fixed, 앱 전역. 처음 작성을 열 때 불러온다(WP-970). draft 없으면 null. AI 모드(전체화면이면 크게 보기를 접는다)를 읽으므로 AI 공급자 안. */}
            <LazyMailComposeDock />
            {/* WP-1535: 메일 작성 새 창이 보내거나 닫으면 이 창의 보낸편지함·임시보관함을 다시 받는다. */}
            <MailComposeWindowSync />
            {/* WP-1235 「채팅·이슈로 보내기」 — 🔗 토스트·⋯·⬆︎ 시트가 openSendToChat 으로 연다. 셸 분기(isMobile) 밖에 둬 어느 화면에서나 뜬다. */}
            <SendToChatHost />
            </HeaderDensityProvider>
          </AiScreenContextProvider>
          </HelpPanelProvider>
        </AIAssistantProvider>
      </ChatSessionProvider>
      </MobileChromeProvider>
    </MailComposeProvider>
  )
}
