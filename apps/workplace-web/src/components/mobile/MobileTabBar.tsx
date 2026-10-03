// 모바일 하단 탭바 — [slot0, slot1, AI, slot2, 앱]. AI 는 가운데 칸의 그라데이션 캡슐(다른 탭과 같은 선상, AI 미사용이면 제외).
// Slack(탭바 회귀)·Teams(앱 1급 노출)·Linear(구성 변경) 패턴을 따른다.
import { LayoutGrid } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAssistant } from '@/components/ai/AIAssistantContext'
import { AiSparkle } from '@/components/ai/AiSparkle'
import { CountBadge } from '@/components/CountBadge'
import { useUnreadSummary } from '@/hooks/queries/useMailMessages'
import { useMyChannels } from '@/hooks/queries/useMyChannels'
import { useMyDms } from '@/hooks/queries/useMyDms'
import { useUnreadCount } from '@/hooks/queries/useUnreadCount'
import { useAiAvailable } from '@/hooks/useAiAvailable'
import { aiTriggerLabel } from '@/lib/ai/aiActivity'
import { DEFAULT_TAB_SLOTS } from '@/lib/mobile/tabConfig'
import { MOBILE_TABS, type MobileTabId, under } from '@/lib/mobile/tabs'
import { cn } from '@/lib/utils'

import { useMobileChrome } from './MobileChromeContext'

// 탭별 배지 수 — 채팅 = 채널+DM 미읽음 합, 알림 = 인박스 미읽음, 메일 = 모든 계정 업무 안 읽은 수(WP-186).
// 메일 계정이 없으면 서버가 0 을 돌려주므로 배지가 숨는다.
function useTabBadges(): Partial<Record<MobileTabId, number>> {
  const { data: channels = [] } = useMyChannels()
  const { data: dms = [] } = useMyDms()
  const { data: inbox = 0 } = useUnreadCount()
  const { data: mail = 0 } = useUnreadSummary(true)
  const chat = [...channels, ...dms].reduce((s, c) => s + (c.unreadCount ?? 0), 0)
  return { chat, notifications: inbox, mail }
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

// 탭 배지 — 공용 CountBadge 를 탭 아이콘 우상단에 겹치도록 작게(16px·9px 글꼴) 줄여 절대 배치한다.
const TAB_BADGE_CLASS = 'absolute right-[calc(50%-18px)] top-0.5 h-4 min-w-4 text-[9px] font-normal leading-4'

/**
 * 실제 탭바 높이(안전영역 포함)를 :root 의 --mobile-tabbar-h 로 공개한다 — 메일 작성 도크 등 fixed 부품이
 * 탭바 위로 뜨게 하되, 탭바가 숨으면(언마운트) 변수를 지워 폴백 0 으로 화면 하단에 붙는다.
 * 고정 px 를 복제하지 않도록 렌더된 높이를 ResizeObserver 로 관측한다.
 */
function useTabBarHeightVar() {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const bar = ref.current
    if (!bar) return
    const root = document.documentElement
    const sync = () => root.style.setProperty('--mobile-tabbar-h', `${bar.offsetHeight}px`)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(bar)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--mobile-tabbar-h')
    }
  }, [])
  return ref
}

/** 하단 탭바 — 슬롯 탭·AI 캡슐 버튼·앱 목록. */
export function MobileTabBar() {
  const navRef = useTabBarHeightVar()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { mode, open, close, triggerActivity } = useAssistant()
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
    // WP-191: AI 는 탭이 아닌 시트라 열려도 보던 탭 강조를 유지한다.
    const active = t.match(pathname)
    const count = badges[id] ?? 0
    return (
      <button
        key={id}
        type="button"
        data-testid={`mobile-tab-${id}`}
        aria-current={active ? 'page' : undefined}
        // 메일 탭 배지는 받은편지함 전체가 아니라 업무 보기 안 읽음 수라 이름에 그 범위를 밝힌다.
        aria-label={count > 0 ? (id === 'mail' ? `${t.label}, 업무 메일 안 읽음 ${count}` : `${t.label}, 읽지 않음 ${count}`) : t.label}
        onClick={() => go(t.path)}
        className={cn(
          'relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]',
          active ? 'font-semibold text-primary' : 'text-muted-foreground',
        )}
      >
        <Icon className="h-5 w-5" />
        {t.label}
        <CountBadge count={count} data-testid={`mobile-tab-badge-${id}`} className={TAB_BADGE_CLASS} />
      </button>
    )
  }

  // 앱 목록(/apps)과 그 하위(탭바 순서 편집)에서 활성. 어느 슬롯 탭에도 속하지 않는 화면(앱 목록에서 연 캘린더·설정 등)도
  // 앱에서 들어온 것이므로 앱을 활성으로 둔다 — 활성 탭이 하나도 없는 탭바를 만들지 않는다(U1-5).
  const appsActive = under('/apps')(pathname) || !slots.some((id) => MOBILE_TABS[id].match(pathname))

  return (
    <nav
      ref={navRef}
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
          data-ai-activity={triggerActivity}
          aria-label={aiTriggerLabel('AI 비서', triggerActivity)}
          // WP-191: 탭(목적지)이 아니라 시트를 여닫는 동작 — aria-current 대신 aria-expanded.
          aria-expanded={aiOpen}
          onClick={() => (aiOpen ? close() : open('fullscreen'))}
          className={cn(
            'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]',
            aiOpen ? 'font-semibold text-primary' : 'text-muted-foreground',
          )}
        >
          {/* 다른 탭과 같은 선상 — 위로 돌출시키면 탭 루트 화면 본문 하단(목록 끝·입력창)을 가리므로,
              높이는 아이콘(20px)과 같게 두고(-my-0.5 로 24px 캡슐의 여분 상쇄) 그라데이션 캡슐로만 1급 액션을 강조한다. */}
          {/* 비활성 = 옅은 AI 틴트(다른 탭과 무게를 맞춤), 활성(AI 열림) = 그라데이션으로 "지금 여기"를 강조(U2-3).
              ai-accent 토큰이라 다크 모드에서도 대응 색으로 바뀐다. */}
          <span
            data-testid="mobile-tab-ai-capsule"
            data-active={aiOpen ? 'true' : undefined}
            className={cn(
              'relative -my-0.5 flex h-6 w-11 items-center justify-center rounded-full',
              aiOpen ? 'bg-gradient-to-br from-violet-600 to-primary text-white shadow-sm' : 'bg-ai-accent-subtle text-ai-accent',
              triggerActivity === 'pending' && 'ai-ring',
            )}
          >
            <AiSparkle activity={triggerActivity} className="h-4 w-4" dotClassName="-right-0.5 -top-0.5" />
          </span>
          AI
        </button>
      )}
      {renderSlot(slots[2])}
      <button
        type="button"
        data-testid="mobile-tab-apps"
        aria-label="앱"
        aria-current={appsActive ? 'page' : undefined}
        onClick={() => go('/apps')}
        className={cn(
          'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[10px]',
          appsActive ? 'font-semibold text-primary' : 'text-muted-foreground',
        )}
      >
        <LayoutGrid className="h-5 w-5" />
        앱
      </button>
    </nav>
  )
}
