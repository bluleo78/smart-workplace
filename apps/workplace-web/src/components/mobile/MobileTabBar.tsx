// 모바일 하단 탭바 — [slot0, slot1, AI, slot2, 더보기]. AI 는 가운데 돌출 원형 버튼(AI 미사용이면 제외).
// Slack(탭바 회귀)·Teams(앱 1급 노출)·Linear(구성 변경) 패턴을 따른다.
import { Menu, Sparkles } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAssistant } from '@/components/ai/AIAssistantContext'
import { useMyChannels } from '@/hooks/queries/useMyChannels'
import { useMyDms } from '@/hooks/queries/useMyDms'
import { useUnreadCount } from '@/hooks/queries/useUnreadCount'
import { useAiAvailable } from '@/hooks/useAiAvailable'
import { DEFAULT_TAB_SLOTS } from '@/lib/mobile/tabConfig'
import { MOBILE_TABS, type MobileTabId } from '@/lib/mobile/tabs'
import { cn } from '@/lib/utils'

import { CountBadge } from './CountBadge'
import { useMobileChrome } from './MobileChromeContext'

// 탭별 배지 수 — 채팅 = 채널+DM 미읽음 합, 알림 = 인박스 미읽음. 메일은 합계 API 가 없어 1차 미표시.
function useTabBadges(): Partial<Record<MobileTabId, number>> {
  const { data: channels = [] } = useMyChannels()
  const { data: dms = [] } = useMyDms()
  const { data: inbox = 0 } = useUnreadCount()
  const chat = [...channels, ...dms].reduce((s, c) => s + (c.unreadCount ?? 0), 0)
  return { chat, notifications: inbox }
}

/**
 * 본문을 맨 위로 — [data-mobile-scroll-root] 자체는 overflow-hidden 이라 스크롤되지 않고, 실제 스크롤은
 * 화면마다 다른 하위 컨테이너(목록 래퍼·페이지 자체 overflow-y-auto 등)에서 일어난다.
 * 어느 것이 스크롤 중인지 화면별로 알 수 없으므로 루트 아래에서 스크롤된(scrollTop>0) 요소를 모두 0 으로 되돌린다.
 * 재탭 시점에만 1회 순회하므로 비용은 무시할 만하다.
 */
function scrollBodyToTop() {
  const root = document.querySelector<HTMLElement>('[data-mobile-scroll-root]')
  if (!root) return
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    if (el.scrollTop > 0) el.scrollTo({ top: 0 })
  }
}

/** 하단 탭바 — 슬롯 탭·AI 돌출 버튼·더보기. */
export function MobileTabBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { mode, open, close } = useAssistant()
  const aiAvailable = useAiAvailable()
  const chrome = useMobileChrome()
  const badges = useTabBadges()
  // Provider 는 AppLayout 이 항상 감싸지만, 혹시 밖에서 렌더돼도 빈 슬롯(undefined 탭) 대신 기본 구성을 쓴다.
  const slots = chrome?.slots ?? DEFAULT_TAB_SLOTS
  const aiOpen = mode !== 'closed'

  // 슬롯 탭: AI 가 열려 있으면 닫고 이동. 이미 그 탭 루트면 본문을 맨 위로(모바일 관례).
  const go = (path: string) => {
    if (aiOpen) close()
    if (pathname === path) {
      scrollBodyToTop()
      return
    }
    navigate(path)
  }

  const renderSlot = (id: MobileTabId) => {
    const t = MOBILE_TABS[id]
    const Icon = t.icon
    const active = !aiOpen && t.match(pathname)
    const count = badges[id] ?? 0
    return (
      <button
        key={id}
        type="button"
        data-testid={`mobile-tab-${id}`}
        aria-current={active ? 'page' : undefined}
        aria-label={count > 0 ? `${t.label}, 읽지 않음 ${count}` : t.label}
        onClick={() => go(t.path)}
        className={cn(
          'relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]',
          active ? 'font-semibold text-primary' : 'text-muted-foreground',
        )}
      >
        <Icon className="h-5 w-5" />
        {t.label}
        <CountBadge count={count} data-testid={`mobile-tab-badge-${id}`} className="right-[calc(50%-18px)] top-0.5" />
      </button>
    )
  }

  const moreActive = !aiOpen && (pathname === '/more' || pathname.startsWith('/more/'))

  return (
    <nav
      aria-label="하단 탭"
      data-testid="mobile-tabbar"
      className="flex shrink-0 items-stretch border-t bg-background px-1 pb-[env(safe-area-inset-bottom)] pt-1"
    >
      {renderSlot(slots[0])}
      {renderSlot(slots[1])}
      {aiAvailable && (
        <button
          type="button"
          data-testid="mobile-tab-ai"
          aria-label="AI 비서"
          aria-current={aiOpen ? 'page' : undefined}
          onClick={() => open('fullscreen')}
          className="flex flex-1 flex-col items-center justify-start text-[10px] text-muted-foreground"
        >
          {/* 가운데 돌출 원형 — 1급 액션임을 시각적으로 강조 */}
          <span className="-mt-4 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-primary text-white shadow-lg">
            <Sparkles className="h-5 w-5" />
          </span>
          <span className={cn(aiOpen && 'font-semibold text-primary')}>AI</span>
        </button>
      )}
      {renderSlot(slots[2])}
      <button
        type="button"
        data-testid="mobile-tab-more"
        aria-label="더보기"
        aria-current={moreActive ? 'page' : undefined}
        onClick={() => go('/more')}
        className={cn(
          'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]',
          moreActive ? 'font-semibold text-primary' : 'text-muted-foreground',
        )}
      >
        <Menu className="h-5 w-5" />
        더보기
      </button>
    </nav>
  )
}
