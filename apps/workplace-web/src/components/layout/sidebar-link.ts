// 모듈 2차 사이드바 공통 NavLink 클래스 — 활성/비활성 스타일.
import { cn } from '@/lib/utils'

export const sidebarLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
    isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
  )

// 앱 타이틀 텍스트 스타일 — 섹션 라벨이 아닌 "앱 타이틀"의 무게(볼드).
// 사이드바 헤더(작업 관리/설정)와 홈 상단 헤더(Smart Workplace)가 공유한다.
export const appTitleTextClass = 'text-[15px] font-bold tracking-tight text-foreground'

// 2차 사이드바 최상단 앱 타이틀 헤더 — "지금 어느 앱인가"를 명시(Slack 모델).
// 레일 앱 마크 헤더(h-14, border-b)와 높이를 맞춰 가로로 정렬된다.
export const sidebarTitleClass =
  'flex h-14 shrink-0 items-center gap-2 border-b px-4 ' + appTitleTextClass

// 인-플로우 페이지 제목(헤더 바 없는 문서/설정형) — 단일 토큰으로 통일.
// 헤더 바를 쓰지 않는 페이지(설정 등)의 <h1> 에 적용. 바 제목은 appTitleTextClass 사용.
export const pageTitleClass = 'text-[28px] leading-[36px] font-semibold tracking-tight'
