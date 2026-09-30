import { cn } from '@/lib/utils'

// 모바일 목록 모드에서 사이드바를 전체폭 목록처럼 보이게 하는 래퍼 클래스.
export const mobileSidebarListClass = cn(
  'min-h-0 flex-1 overflow-y-auto',
  '[&>aside]:w-full [&>aside]:border-r-0 [&>aside]:bg-background',
  '[&>aside>:first-child]:hidden',
  // 터치 영역 최소 44px(모바일 관례)
  '[&_a]:min-h-11 [&_button]:min-h-11',
)
