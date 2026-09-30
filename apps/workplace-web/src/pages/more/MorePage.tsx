// /more — 탭바에 없는 앱 그리드 + 탭바 편집 + 설정 + 워크스페이스·계정(Teams 더보기 패턴). 모바일 전용(WP-126).
import { Settings } from 'lucide-react'
import { Link, Navigate } from 'react-router-dom'

import { AppRailUserMenu } from '@/components/layout/AppRailUserMenu'
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { useTabSlots } from '@/components/mobile/MobileChromeContext'
import { MobileListHeader } from '@/components/mobile/MobileListHeader'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/useIsMobile'
import { ALL_TAB_IDS, MOBILE_TABS } from '@/lib/mobile/tabs'

export default function MorePage() {
  const isMobile = useIsMobile()
  const [slots] = useTabSlots()
  // 데스크톱엔 더보기 화면이 없다.
  if (!isMobile) return <Navigate to="/" replace />
  // 탭바에 이미 있는 앱과 알림(헤더 벨로 접근)은 그리드에서 제외한다.
  const rest = ALL_TAB_IDS.filter((id) => !slots.includes(id) && id !== 'notifications')
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <MobileListHeader title="더보기" />
      <div className="grid grid-cols-4 gap-3 px-4 py-2">
        {rest.map((id) => {
          const t = MOBILE_TABS[id]
          const Icon = t.icon
          return (
            <Link key={id} to={t.path} data-testid={`more-app-${id}`} className="flex flex-col items-center gap-1 text-xs">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border bg-card"><Icon className="h-5 w-5" /></span>
              {t.label}
            </Link>
          )
        })}
        <Link to="/settings" data-testid="more-app-settings" className="flex flex-col items-center gap-1 text-xs">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border bg-card"><Settings className="h-5 w-5" /></span>설정
        </Link>
      </div>
      <Link to="/more/tabs" data-testid="more-edit-tabs" className="mx-4 my-3 rounded-lg bg-primary/10 py-3 text-center text-sm font-semibold text-primary">탭바 편집</Link>
      <div className="space-y-1 border-t px-2 py-2">
        {/* 하단 배치라 드롭다운은 위로 연다(오른쪽은 390px 에서 잘림). */}
        {/* 두 컴포넌트가 Tooltip 을 쓰는데 모바일 셸엔 레일의 TooltipProvider 가 없어 여기서 감싼다. */}
        <TooltipProvider>
          <WorkspaceSwitcher expanded side="top" />
          <AppRailUserMenu expanded side="top" />
        </TooltipProvider>
      </div>
    </div>
  )
}
