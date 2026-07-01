import type { ReactNode } from 'react'

import { appTitleTextClass } from '@/components/layout/sidebar-link'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  /** 좌측 제목 — 사이드바 타이틀과 동일한 무게(appTitleTextClass). 생략 시 제목 영역 미렌더(다른 위치 표시자로 대체 가능 — 예: 드라이브의 브레드크럼). */
  title?: ReactNode
  /** 선택: 제목 앞 아이콘/컨트롤(사이드바 타이틀 아이콘과 대칭). */
  icon?: ReactNode
  /** 선택: 제목 옆 보조 메타(키·멤버수·뱃지 등). */
  meta?: ReactNode
  /** 선택: 우측 액션 슬롯(버튼·검색 등). */
  actions?: ReactNode
  className?: string
  /**
   * 본문이 `container mx-auto p-6` 로 센터링되는 페이지(이슈/프로젝트 상세)에서 true.
   * 헤더 테두리(border-b)는 전체폭을 유지하되, 내부 제목·액션을 본문과 동일한
   * `container mx-auto px-6` 축에 정렬시켜 헤더-본문 좌/우 정렬을 맞춘다.
   * 기본 false(전체폭 px-4) — 메일/드라이브처럼 p-4 전체폭 본문 페이지와의 정렬을 보존한다.
   */
  contained?: boolean
  /** 기존 테스트 호환용 testid override(기본 'page-header'). */
  'data-testid'?: string
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
  ...rest
}: PageHeaderProps) {
  return (
    <header
      data-testid={rest['data-testid'] ?? 'page-header'}
      className={cn('flex h-14 shrink-0 items-center border-b', className)}
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
