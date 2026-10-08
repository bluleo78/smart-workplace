// 페이지 틀 — 헤더(Page.Header)와 본문(Page.Body)이 같은 여백(16px)·폭 기준을 공유한다.
// 왜: 헤더·본문 여백/폭을 화면마다 따로 정해 넓은 화면·읽기 폭 화면에서 좌우 축이 어긋났다(이슈 상세 372px 등).
import { Menu } from 'lucide-react'
import { createContext, type ReactNode, type Ref, useContext } from 'react'
import { useLocation } from 'react-router-dom'

import { appTitleTextClass } from '@/components/layout/sidebar-link'
import { mobileRootHeaderClass, mobileRootTitleClass } from '@/components/mobile/headerClass'
import { useMobileChrome } from '@/components/mobile/MobileChromeContext'
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar'
import { useMobileDetailHeader } from '@/components/mobile/MobileDetailContext'
import { MobileHeaderMore } from '@/components/mobile/MobileHeaderMore'
import { useMobileSidebarSheet } from '@/components/mobile/MobileSidebarSheetContext'
import { NotificationBell } from '@/components/mobile/NotificationBell'
import { useAiAvailable } from '@/hooks/useAiAvailable'
import { useIsMobile } from '@/hooks/useIsMobile'
import { isTabRoot } from '@/lib/mobile/routes'
import { cn } from '@/lib/utils'

export type PageWidth = 'full' | 'reading'

/** 페이지 좌우 여백 — 헤더·본문·자체 레이아웃 본문의 행이 공유하는 유일한 값. */
export const pageGutterClass = 'px-4'

/** 본문 안 보조 칸(스레드·개인 작업 패널) 상단 소제목 줄 — 페이지 헤더가 아니므로 낮고 옅은 선. */
export const subPaneHeaderClass =
  'flex h-[34px] shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4 text-xs font-semibold'

/** AI 칩(뷰포트 중앙 고정, 반폭 70px) 좌측 경계를 넘지 않도록 헤더 좌측 그룹 최대 폭(#830 위키 클램프 일반화). */
export const aiChipSafeLeftMaxW = 'max-w-[max(120px,calc(50vw-360px))]'

/** 페이지 폭 기준 — Page 가 정하고 Page.Body 가 읽는다(reading = 왼쪽 정렬 768px 제한). */
const PageWidthContext = createContext<PageWidth>('full')

/**
 * 페이지 루트 — 헤더 + 본문을 세로로 쌓는 전체 높이 틀. 폭 기준(width)을 본문에 내려준다.
 */
function PageRoot({
  width = 'full',
  className,
  children,
  ...rest
}: {
  width?: PageWidth
  className?: string
  children: ReactNode
  'data-testid'?: string
}) {
  return (
    <PageWidthContext.Provider value={width}>
      <div data-testid={rest['data-testid']} className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
        {children}
      </div>
    </PageWidthContext.Provider>
  )
}

export interface PageHeaderProps {
  /** 좌측 제목 — 사이드바 타이틀과 동일한 무게(appTitleTextClass). 생략 시 제목 영역 미렌더(다른 위치 표시자로 대체 가능 — 예: 드라이브의 브레드크럼). */
  title?: ReactNode
  /** 선택: 제목 앞 아이콘/컨트롤(사이드바 타이틀 아이콘과 대칭). 데스크톱 전용 — 모바일 헤더는 제목 폭을 위해 그리지 않는다. */
  icon?: ReactNode
  /** 선택: 제목 옆 보조 메타(키·멤버수·뱃지 등). */
  meta?: ReactNode
  /** 선택: 우측 액션 슬롯(버튼·검색 등). */
  actions?: ReactNode
  className?: string
  /** 선택: 제목 앞/대신 오는 위치 표시(이슈 ←+브레드크럼, 위키 경로). 데스크톱 전용 — 모바일은 title 사용. */
  leading?: ReactNode
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
  /** 모바일 전용: ☰(사이드바 시트) 트리거 숨김 — 시트에 볼 것이 없는 화면(메일 계정 없음, U3-R12). */
  mobileHideSheetTrigger?: boolean
  /** 모바일 병합 상세 헤더의 ‹ 동작 재정의(이슈 상세의 출발 화면 복귀 등). */
  mobileOnBack?: () => void
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
function PageHeaderImpl({
  title,
  icon,
  leading,
  meta,
  actions,
  className,
  mobilePrimaryAction,
  mobileActions,
  mobileMenuIcon,
  mobileMenuLabel,
  mobileHideSheetTrigger = false,
  mobileOnBack,
  ...rest
}: PageHeaderProps) {
  const isMobile = useIsMobile()
  const sheet = useMobileSidebarSheet()
  // 모바일 상세(ResponsiveModuleLayout 상세 분기) 안이면 등록 → 레이아웃의 뒤로가기 바 대신 이 헤더가 ‹·✦ 를 품는다(U1-1).
  const detail = useMobileDetailHeader(isMobile)
  // AI 칩 노출 여부 — 칩이 있을 때만 데스크톱 좌측 그룹을 칩 경계 앞에서 자른다.
  const aiAvailable = useAiAvailable()
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
        {sheet && !mobileHideSheetTrigger && (
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
          onBack={mobileOnBack}
        />
      )
    }
    // 탭 루트 헤더: MobileListHeader 와 같은 규격(h-14·좌16·22px bold) + 우측 [클러스터] [🔔] (U1-3).
    // 하단 구분선 없음 — MobileListHeader(채팅·작업)와 같게, 큰 제목 헤더는 본문과 한 면으로 보인다(U3-R3).
    return (
      <header data-testid={rest['data-testid'] ?? 'page-header'} className={cn('relative z-[45] bg-background', mobileRootHeaderClass, className)}>
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
      {/* 내부 정렬 래퍼 — 본문과 같은 페이지 여백(pageGutterClass) 축. 넓은 화면에서도 가운데로 몰리지 않는다(#880). */}
      <div className={cn('flex w-full min-w-0 items-center justify-between gap-2', pageGutterClass)}>
        {/* AI 칩은 뷰포트 중앙 fixed — 좌측 그룹이 칩 좌측 경계를 넘지 않게 클램프(#830 위키 처리 일반화). */}
        <div className={cn('flex min-w-0 items-center gap-2', aiAvailable && aiChipSafeLeftMaxW)}>
          {icon}
          {leading}
          {title != null && <h1 className={cn(appTitleTextClass, 'truncate')}>{title}</h1>}
          {meta}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

/**
 * 페이지 본문 — padded(기본)면 스크롤 영역 + pageGutterClass 여백, reading 폭이면 왼쪽 정렬 max-w-3xl.
 * padded=false 는 자체 레이아웃 본문(마스터-디테일·그리드·채팅) — 스크롤·여백은 화면이 소유하고 행은 pageGutterClass 를 쓴다.
 */
function PageBody({
  padded = true,
  scrollRef,
  className,
  children,
  ...rest
}: {
  padded?: boolean
  scrollRef?: Ref<HTMLDivElement>
  className?: string
  children: ReactNode
  'data-testid'?: string
}) {
  const width = useContext(PageWidthContext)
  if (!padded) {
    return <div data-testid={rest['data-testid']} className={cn('flex min-h-0 flex-1', className)}>{children}</div>
  }
  return (
    <div ref={scrollRef} data-testid={rest['data-testid'] ?? 'page-body'} className="min-h-0 flex-1 overflow-y-auto">
      {/* reading: 왼쪽 정렬 + 768px 제한(mx-auto 금지 — 헤더 시작선과 맞추기 위해). */}
      <div data-testid="page-body-content" className={cn(pageGutterClass, 'py-4', width === 'reading' && 'max-w-3xl', className)}>
        {children}
      </div>
    </div>
  )
}

/** 페이지 틀 — `<Page width>` + `Page.Header` + `Page.Body`. */
export const Page = Object.assign(PageRoot, { Header: PageHeaderImpl, Body: PageBody })
