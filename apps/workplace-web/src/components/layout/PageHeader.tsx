import { Menu } from 'lucide-react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import { appTitleTextClass } from '@/components/layout/sidebar-link'
import { mobileRootHeaderClass, mobileRootTitleClass } from '@/components/mobile/headerClass'
import { useMobileChrome } from '@/components/mobile/MobileChromeContext'
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar'
import { useMobileDetailHeader } from '@/components/mobile/MobileDetailContext'
import { MobileHeaderMore } from '@/components/mobile/MobileHeaderMore'
import { useMobileSidebarSheet } from '@/components/mobile/MobileSidebarSheetContext'
import { NotificationBell } from '@/components/mobile/NotificationBell'
import { useIsMobile } from '@/hooks/useIsMobile'
import { isTabRoot } from '@/lib/mobile/routes'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  /** 좌측 제목 — 사이드바 타이틀과 동일한 무게(appTitleTextClass). 생략 시 제목 영역 미렌더(다른 위치 표시자로 대체 가능 — 예: 드라이브의 브레드크럼). */
  title?: ReactNode
  /** 선택: 제목 앞 아이콘/컨트롤(사이드바 타이틀 아이콘과 대칭). 데스크톱 전용 — 모바일 헤더는 제목 폭을 위해 그리지 않는다. */
  icon?: ReactNode
  /** 선택: 제목 옆 보조 메타(키·멤버수·뱃지 등). */
  meta?: ReactNode
  /** 선택: 우측 액션 슬롯(버튼·검색 등). */
  actions?: ReactNode
  className?: string
  /**
   * 본문이 `container mx-auto p-6` 로 센터링되는 페이지(프로젝트 목록 등)에서 true.
   * 헤더 테두리(border-b)는 전체폭을 유지하되, 내부 제목·액션을 본문과 동일한
   * `container mx-auto px-6` 축에 정렬시켜 헤더-본문 좌/우 정렬을 맞춘다.
   * 기본 false(전체폭 px-4) — 메일/드라이브·프로젝트 상세·타임라인처럼 전체폭 본문 페이지와의 정렬을 보존한다.
   */
  contained?: boolean
  /** 기존 테스트 호환용 testid override(기본 'page-header'). */
  'data-testid'?: string
  /** 모바일 전용: ⋯ 메뉴 밖에 인라인으로 둘 주 액션 하나(보통 ＋ 아이콘 버튼). */
  mobilePrimaryAction?: ReactNode
  /**
   * 모바일 전용: ⋯ 메뉴에 담을 내용. 생략하면 actions 전체를 담는다. null 이면 ⋯ 를 두지 않는다
   * (주 액션이 actions 와 같은 버튼일 때 — 같은 testid 가 두 번 렌더되지 않게 페이지가 나눠서 넘긴다).
   */
  mobileActions?: ReactNode
  /** 모바일 전용: ⋯ 트리거 아이콘·라벨 교체(메뉴가 검색 하나뿐인 메일 → 🔍). */
  mobileMenuIcon?: ReactNode
  mobileMenuLabel?: string
}

/** 모바일 헤더 전용 — 탭 루트에서만 🔔 를 보인다. useLocation 구독을 모바일 분기에 가둬 데스크톱 헤더가 경로 변경마다 재렌더되지 않게 분리. */
function MobileTabRootBell() {
  const { pathname } = useLocation()
  const chrome = useMobileChrome()
  return isTabRoot(pathname, chrome?.slots) ? <NotificationBell /> : null
}

/**
 * 컨텐츠 영역 표준 헤더 바 — h-14·border-b 고정 바로 사이드바 헤더(sidebarTitleClass)와
 * 한 선 정렬. 페이지가 필요할 때만 둔다(옵션). 홈 canvas-header 패턴을 컴포넌트화한 것.
 */
export function PageHeader({
  title,
  icon,
  meta,
  actions,
  className,
  contained = false,
  mobilePrimaryAction,
  mobileActions,
  mobileMenuIcon,
  mobileMenuLabel,
  ...rest
}: PageHeaderProps) {
  const isMobile = useIsMobile()
  const sheet = useMobileSidebarSheet()
  // 모바일 상세(ResponsiveModuleLayout 상세 분기) 안이면 등록 → 레이아웃의 뒤로가기 바 대신 이 헤더가 ‹·✦ 를 품는다(U1-1).
  const detail = useMobileDetailHeader(isMobile)
  if (isMobile) {
    // 모바일 우측 클러스터 — [주 액션] [⋯ 메뉴(나머지 actions)] [☰ 사이드바 시트]. meta 는 모바일에서 렌더하지 않음.
    // 액션을 가로 스크롤 줄로 늘어놓지 않고 ⋯ 로 접어 제목 폭을 지킨다(U1-2).
    const menu = mobileActions === undefined ? actions : mobileActions
    const cluster = (
      <>
        {mobilePrimaryAction}
        {menu != null && menu !== false && (
          <MobileHeaderMore icon={mobileMenuIcon} label={mobileMenuLabel}>{menu}</MobileHeaderMore>
        )}
        {sheet && (
          <button type="button" data-testid="mobile-sidebar-trigger" aria-label="목록 열기" onClick={sheet.openSheet}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground">
            <Menu className="h-5 w-5" />
          </button>
        )}
      </>
    )
    if (detail) {
      // 병합 상세 헤더: ‹ + 제목(17px) + 클러스터 + ✦. 페이지 icon(프로젝트로 돌아가기 등)은 ‹ 가 대신하므로 그리지 않는다.
      return (
        <MobileDetailBar
          data-testid={rest['data-testid'] ?? 'page-header'}
          className={className}
          title={title ?? detail.title}
          trailing={cluster}
        />
      )
    }
    // 탭 루트 헤더: MobileListHeader 와 같은 규격(h-14·좌16·22px bold) + 우측 [클러스터] [🔔] (U1-3).
    return (
      <header data-testid={rest['data-testid'] ?? 'page-header'} className={cn('relative z-[45] border-b bg-background', mobileRootHeaderClass, className)}>
        {/* icon 은 모바일에서 생략 — 장식 아이콘은 제목 폭을 위해, 인터랙티브 컨트롤(캘린더 이동)은 페이지가 헤더 아래 도구 줄로 옮긴다. */}
        {title != null ? <h1 className={mobileRootTitleClass}>{title}</h1> : <div className="flex-1" />}
        {cluster}
        <MobileTabRootBell />
      </header>
    )
  }
  return (
    <header
      data-testid={rest['data-testid'] ?? 'page-header'}
      // relative z-45 — Sonner 토스트(index.css 에서 z-index:40 으로 하향)보다 위에 오도록 해
      // 헤더 우측 액션 버튼(검색/업로드 등)이 토스트에 클릭을 뺏기지 않게 함 (#715).
      // Dialog/Popover/Select 등 오버레이(z-50)보다는 낮게 유지해 모달이 헤더에 가리지 않게 함.
      className={cn('relative z-[45] flex h-14 shrink-0 items-center border-b bg-background', className)}
    >
      {/* 내부 정렬 래퍼 — contained 면 본문과 동일한 컨테이너 축(px-6), 아니면 기존 전체폭 px-4. */}
      <div
        className={cn(
          'flex w-full min-w-0 items-center justify-between gap-2',
          contained ? 'container mx-auto px-6' : 'px-4',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          {title != null && <h1 className={cn(appTitleTextClass, 'truncate')}>{title}</h1>}
          {meta}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
