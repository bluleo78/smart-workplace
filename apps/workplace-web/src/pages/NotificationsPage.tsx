// /notifications — 모바일 알림 전체 화면(WP-126). 데스크톱에서 직접 들어오면 홈 + 인박스 Popover 로 돌려보낸다.
// 탭바에 알림을 고정했으면 탭 루트(큰 제목 + 탭바), 아니면 🔔 로 여는 푸시 화면(‹ 뒤로 헤더, 탭바 숨김 — U1-5).
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useInboxPanel } from '@/components/layout/InboxContext'
import { InboxList, MarkAllReadButton } from '@/components/layout/InboxList'
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
  // 데스크톱엔 전용 화면이 없으므로 홈으로 보내고 레일 인박스를 연다.
  useEffect(() => {
    if (!isMobile) {
      navigate('/', { replace: true })
      openInbox()
    }
  }, [isMobile, navigate, openInbox])
  if (!isMobile) return null
  const tabRoot = isTabRoot(pathname, chrome?.slots)
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* '모두 읽음' 은 헤더 액션 자리에(별도 한 줄 없이, U1-7). 벨은 이 화면 자체이므로 숨긴다. */}
      {tabRoot ? (
        <MobileListHeader title="알림" hideBell actions={<MarkAllReadButton />} />
      ) : (
        // 뒤로가기: 히스토리가 있으면 이전 화면, 딥링크면 홈(moduleRootFor('/notifications') = '/').
        <MobileDetailBar data-testid="notifications-header" title="알림" trailing={<MarkAllReadButton />} />
      )}
      <InboxList enabled hideHeader scrollClassName="min-h-0 flex-1 overflow-y-auto" />
    </div>
  )
}
