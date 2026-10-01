// 모바일 홈 위젯 카드(WP-142) — 같은 위젯 정의를 좁은 화면 모양으로 그린다(시안 v1).
//  - 본문형 + 펼침: 머리(아이콘·제목·⌃) + 본문
//  - 본문형 + 접힘: 머리(아이콘·제목·건수·⌄) + 요약 한 줄
//  - 타일형: 접힘과 같은 틀, 오른쪽만 › — 카드 전체가 앱으로 가는 링크
// 편집 모드(edit)는 같은 모양을 유지하되 ⌃/› 자리를 편집 컨트롤로 바꾸고, 타일도 링크로 만들지 않는다(드래그 중 이동 방지).
import { ChevronDown, ChevronRight, ChevronUp, type LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { DashboardWidgetConfig } from '@/types/dashboard'

import type { MobileSummaryData, MobileWidgetDef } from './types'

// 카드 크롬 — 데스크톱 Card 와 같은 둥근 모서리·테두리·그림자 + 좌측 ai-accent 줄. 여백만 16px(px-4)로 줄인다.
const FRAME = 'block rounded-xl border border-l-2 border-l-ai-accent bg-card text-card-foreground shadow-sm'
// 머리 — 시안 .hd(위 14px·좌우 16px·아래 6px, 접힘·타일은 아래 4px), 아이콘 h-4 + text-sm font-medium muted.
const HEAD = 'flex items-center gap-2 px-4 pt-3.5 text-sm font-medium text-muted-foreground'
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

/** 편집 모드 전용 — dnd-kit 정렬·포커스 복원·숨김/강조 표시를 카드 바깥 틀에 붙인다. */
export interface MobileCardEdit {
  /** ⌃ 자리에 들어갈 컨트롤(핸들·숨김·설정·삭제). */
  controls: ReactNode
  /** 머리 아래 보조 줄(항목 수 선택). */
  extra?: ReactNode
  frameRef: (el: HTMLDivElement | null) => void
  style: CSSProperties
  className?: string
  hidden: boolean
  justAdded: boolean
}

interface MobileWidgetCardProps {
  cfg: DashboardWidgetConfig
  title: string
  icon: LucideIcon
  mobile: MobileWidgetDef
  /** 펼친 본문(Suspense 포함) — 본문형 펼침일 때만 그린다. */
  body: ReactNode
  /** 앱 경로 — 본문형 머리 링크, 타일 전체 링크. */
  headerLink?: string
  /** 경로 없는 위젯(알림)의 머리 동작 — 인박스 열기. */
  onHeaderClick?: () => void
  /** 보기 모드 접기 토글. 편집 모드에서는 넘기지 않는다. */
  onToggleCollapsed?: () => void
  edit?: MobileCardEdit
}

/** 머리 건수 배지 — 0 이하·미정이면 그리지 않는다(빈 배지로 주의를 끌지 않게). */
function CountBadge({ count }: { count?: number }) {
  if (count == null || count <= 0) return null
  return (
    <span
      data-testid="mobile-widget-count"
      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-ai-accent-subtle px-1.5 text-xs font-semibold text-ai-accent"
    >
      {count}
    </span>
  )
}

/** 요약 한 줄 — 로딩은 스켈레톤 1줄, 오류는 muted 문구(카드 전체를 깨뜨리지 않음). 본문은 넘치면 말줄임. */
function SummaryLine({ data }: { data: MobileSummaryData }) {
  if (data.status === 'loading')
    return <Skeleton className="h-5 w-3/4" data-testid="mobile-widget-summary-loading" />
  if (data.status === 'error')
    return (
      <p className="text-sm text-muted-foreground" data-testid="mobile-widget-summary">
        불러오지 못했습니다
      </p>
    )
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-sm" data-testid="mobile-widget-summary">
      {data.prefix && <span className="shrink-0">{data.prefix}</span>}
      <span className="min-w-0 truncate" data-testid="mobile-widget-summary-text">
        {data.text}
      </span>
      {data.meta && <span className="ml-auto shrink-0">{data.meta}</span>}
    </div>
  )
}

/** 모바일 위젯 카드. */
export function MobileWidgetCard({
  cfg,
  title,
  icon: Icon,
  mobile,
  body,
  headerLink,
  onHeaderClick,
  onToggleCollapsed,
  edit,
}: MobileWidgetCardProps) {
  const isTile = !mobile.body
  // 타일은 항상 한 줄. 본문형은 collapsed 가 true 일 때만 접힘(null/미지정 = 펼침).
  const collapsed = isTile || cfg.collapsed === true
  const Summary = mobile.Summary
  const frameAttrs = {
    'data-testid': 'dashboard-widget',
    'data-widget': cfg.type,
    'data-widget-id': cfg.id,
    'data-mobile-kind': isTile ? 'tile' : 'body',
    'data-collapsed': collapsed,
  }

  // 머리 왼쪽(아이콘·제목) — 보기 모드 본문형만 데스크톱처럼 앱 링크/인박스 버튼. 타일은 카드 전체가 링크라 중첩을 피한다.
  const label = (
    <>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{title}</span>
    </>
  )
  const labelClass = cn('flex min-w-0 items-center gap-2 rounded-sm hover:text-ai-accent', FOCUS)
  const interactiveHead = !edit && !isTile
  const headLabel =
    interactiveHead && headerLink ? (
      <Link to={headerLink} className={labelClass}>
        {label}
      </Link>
    ) : interactiveHead && onHeaderClick ? (
      <button type="button" onClick={onHeaderClick} className={labelClass}>
        {label}
      </button>
    ) : (
      <span className="flex min-w-0 items-center gap-2">{label}</span>
    )

  // ⌃/⌄ — 44px 터치 영역. 음수 여백으로 머리 높이는 시안대로 유지한다.
  const collapseButton =
    onToggleCollapsed && !isTile ? (
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={`${title} ${collapsed ? '펼치기' : '접기'}`}
        data-testid="mobile-widget-collapse"
        className={cn(
          '-my-2.5 -mr-2.5 flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted',
          FOCUS,
        )}
      >
        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>
    ) : null

  const head = (badge: ReactNode, trailing: ReactNode) => (
    <div className={cn(HEAD, collapsed ? 'pb-1' : 'pb-1.5')}>
      {headLabel}
      {badge}
      <span className="flex-1" />
      {trailing}
    </div>
  )
  const extra = edit?.extra ? <div className="px-4 pb-2">{edit.extra}</div> : null

  // 바깥 틀 — 편집: 정렬 가능한 div / 보기 타일: 앱 링크 / 그 외: div.
  const frame = (children: ReactNode, to?: string) => {
    if (edit)
      return (
        <div
          ref={edit.frameRef}
          style={edit.style}
          tabIndex={-1}
          className={cn(FRAME, FOCUS, edit.className)}
          {...frameAttrs}
          data-hidden={edit.hidden}
          data-just-added={edit.justAdded ? 'true' : undefined}
        >
          {children}
        </div>
      )
    if (to)
      return (
        <Link to={to} className={cn(FRAME, 'hover:bg-muted/50', FOCUS)} {...frameAttrs}>
          {children}
        </Link>
      )
    return (
      <div className={FRAME} {...frameAttrs}>
        {children}
      </div>
    )
  }

  if (!collapsed) {
    return frame(
      <>
        {head(null, edit ? edit.controls : collapseButton)}
        {extra}
        <div className="px-4 pt-1 pb-3.5">{body}</div>
      </>,
    )
  }

  // 접힘·타일 — 머리 배지와 한 줄이 같은 요약 데이터를 쓴다. 펼친 동안엔 Summary 를 마운트하지 않는다.
  return (
    <Summary
      params={cfg.params}
      render={(data) => {
        // 위젯 deepLink 가 없으면(AI 우선순위) 요약이 준 항목 경로로, 그것도 없으면 링크 없는 카드.
        const to = !edit && isTile ? (data.to ?? headerLink) : undefined
        const trailing = edit
          ? edit.controls
          : isTile
            ? // mr-1: ⌄ 버튼(44px, -mr-2.5) 아이콘 중심과 › 중심을 같은 세로선에 맞춘다.
              to && <ChevronRight className="mr-1 h-4 w-4 shrink-0" aria-hidden />
            : collapseButton
        return frame(
          <>
            {head(<CountBadge count={data.count} />, trailing)}
            {extra}
            <div className="px-4 pb-3.5">
              <SummaryLine data={data} />
            </div>
          </>,
          to,
        )
      }}
    />
  )
}
