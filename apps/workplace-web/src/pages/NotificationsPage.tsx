// /notifications — 모바일 알림 전체 화면(WP-126). 데스크톱에서 직접 들어오면 홈 + 인박스 Popover 로 돌려보낸다.
// 탭바에 알림을 고정했으면 탭 루트(큰 제목 + 탭바), 아니면 🔔 로 여는 푸시 화면(‹ 뒤로 헤더, 탭바 숨김 — U1-5).
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useInboxPanel } from '@/components/layout/InboxContext'
import { ArchiveReadButton, InboxList, type InboxView, InboxViewTabs, MarkAllReadButton } from '@/components/layout/InboxList'
import { narrowHeaderTitleHiddenClass } from '@/components/mobile/headerClass'
import { useMobileChrome } from '@/components/mobile/MobileChromeContext'
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar'
import { MobileListHeader } from '@/components/mobile/MobileListHeader'
import { useIsMobile } from '@/hooks/useIsMobile'
import { isTabRoot } from '@/lib/mobile/routes'

export default function NotificationsPage() {
  const isMobile = useIsMobile()
  const { openInbox } = useInboxPanel()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const chrome = useMobileChrome()
  // 보기(알림|보관함, WP-1690) — 머리의 전환과 목록이 같은 값을 본다.
  const [view, setView] = useState<InboxView>('inbox')
  // 데스크톱엔 전용 화면이 없으므로 홈으로 보내고 레일 인박스를 연다.
  useEffect(() => {
    if (!isMobile) {
      navigate('/', { replace: true })
      openInbox()
    }
  }, [isMobile, navigate, openInbox])
  if (!isMobile) return null
  const tabRoot = isTabRoot(pathname, chrome?.slots)
  // 머리 액션: 모두 읽음 · 읽은 알림 보관(WP-1689) — 탭 루트·푸시 화면 두 머리에 같은 묶음.
  // 보관함에서는 대상이 없으므로 숨긴다(390px 한 줄에 제목+전환+액션이 넘치지 않게도).
  const headerActions =
    view === 'inbox' ? (
      <>
        <MarkAllReadButton />
        <ArchiveReadButton />
      </>
    ) : null
  // 360px 미만 제목 숨김(두 액션은 아이콘이 된다)은 액션이 있는 알림 보기에서만 — 보관함엔 액션이 없어 제목이 들어간다(WP-1731).
  const titleClassName = view === 'inbox' ? narrowHeaderTitleHiddenClass : undefined
  const viewTabs = <InboxViewTabs view={view} onChange={setView} />
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* '모두 읽음'·'읽은 알림 보관' 은 헤더 액션 자리에(별도 한 줄 없이, U1-7). 벨은 이 화면 자체이므로 숨긴다. */}
      {tabRoot ? (
        <MobileListHeader title="알림" titleAccessory={viewTabs} titleClassName={titleClassName} hideBell actions={headerActions} />
      ) : (
        // 뒤로가기: 히스토리가 있으면 이전 화면, 딥링크면 홈(moduleRootFor('/notifications') = '/').
        // showAi={false}: 알림 목록에는 AI 가 이어받을 화면 맥락이 없고, ✦(44px)을 빼야 390px 에서 제목+전환+두 액션이 한 줄에 들어간다(WP-1690).
        <MobileDetailBar data-testid="notifications-header" title="알림" titleAccessory={viewTabs} titleClassName={titleClassName} trailing={headerActions} showAi={false} />
      )}
      <InboxList enabled view={view} onViewChange={setView} hideHeader screenEmpty scrollClassName="min-h-0 flex-1 overflow-y-auto" />
    </div>
  )
}
