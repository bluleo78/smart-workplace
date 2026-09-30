// /notifications — 모바일 알림 전체 화면(WP-126). 데스크톱에서 직접 들어오면 홈 + 인박스 Popover 로 돌려보낸다.
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { useInboxPanel } from '@/components/layout/InboxContext'
import { InboxList } from '@/components/layout/InboxList'
import { MobileListHeader } from '@/components/mobile/MobileListHeader'
import { useIsMobile } from '@/hooks/useIsMobile'

export default function NotificationsPage() {
  const isMobile = useIsMobile()
  const { openInbox } = useInboxPanel()
  const navigate = useNavigate()
  // 데스크톱엔 전용 화면이 없으므로 홈으로 보내고 레일 인박스를 연다.
  useEffect(() => {
    if (!isMobile) {
      navigate('/', { replace: true })
      openInbox()
    }
  }, [isMobile, navigate, openInbox])
  if (!isMobile) return null
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 벨은 이 화면 자체이므로 숨긴다. */}
      <MobileListHeader title="알림" hideBell />
      <InboxList enabled onNavigate={() => {}} scrollClassName="min-h-0 flex-1 overflow-y-auto" />
    </div>
  )
}
