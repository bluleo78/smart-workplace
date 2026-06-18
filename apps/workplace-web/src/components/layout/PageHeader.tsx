import type { ReactNode } from 'react'

import { appTitleTextClass } from '@/components/layout/sidebar-link'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  /** 좌측 제목 — 사이드바 타이틀과 동일한 무게(appTitleTextClass). */
  title: ReactNode
  /** 선택: 제목 앞 아이콘/컨트롤(사이드바 타이틀 아이콘과 대칭). */
  icon?: ReactNode
  /** 선택: 제목 옆 보조 메타(키·멤버수·뱃지 등). */
  meta?: ReactNode
  /** 선택: 우측 액션 슬롯(버튼·검색 등). */
  actions?: ReactNode
  className?: string
  /** 기존 테스트 호환용 testid override(기본 'page-header'). */
  'data-testid'?: string
}

/**
 * 컨텐츠 영역 표준 헤더 바 — h-14·border-b 고정 바로 사이드바 헤더(sidebarTitleClass)와
 * 한 선 정렬. 페이지가 필요할 때만 둔다(옵션). 홈 canvas-header 패턴을 컴포넌트화한 것.
 */
export function PageHeader({ title, icon, meta, actions, className, ...rest }: PageHeaderProps) {
  return (
    <header
      data-testid={rest['data-testid'] ?? 'page-header'}
      className={cn(
        'flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <h1 className={cn(appTitleTextClass, 'truncate')}>{title}</h1>
        {meta}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
