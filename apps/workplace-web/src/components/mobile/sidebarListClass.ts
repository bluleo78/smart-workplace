import { cn } from '@/lib/utils'

// 모바일 목록 모드에서 사이드바를 전체폭 목록처럼 보이게 하는 래퍼 클래스.
// 사이드바 DOM(데스크톱과 공유)은 건드리지 않고 래퍼 CSS 로만 모바일 목록 규격을 입힌다(U2-4).
// 구조 규약: 섹션 머리말 = `.justify-between` 줄에 `.uppercase` 라벨 + 아이콘 버튼(채팅·작업·드라이브·노트 공통).
// Tailwind 는 소스의 클래스 문자열을 정적으로 스캔하므로 선택자를 변수로 조립하지 않고 그대로 적는다.

export const mobileSidebarListClass = cn(
  'min-h-0 flex-1 overflow-y-auto',
  '[&>aside]:w-full [&>aside]:border-r-0 [&>aside]:bg-background',
  '[&>aside>:first-child]:hidden',
  // 행(링크·버튼) 터치 영역 최소 44px(모바일 관례) — 섹션 머리말 안의 아이콘 버튼은 아래에서 되돌린다.
  '[&_a]:min-h-11 [&_button]:min-h-11',
  // 행 글자는 본문색(데스크톱 사이드바의 흐린 muted 대신) — 목록이 화면의 주 콘텐츠이므로. 보조 글자·아이콘은 자체 클래스 유지.
  '[&_nav_a]:text-foreground [&_a.rounded-md]:text-foreground',
  // 미읽음 배지(bg-destructive)가 붙은 행은 굵게 — 사이드바가 이미 노출하는 미읽음 상태만 사용(새 데이터 없음).
  '[&_a:has(>.bg-destructive)]:font-semibold',
  // 섹션 머리말 ~32px: 아이콘 버튼은 min-h 를 풀고(머리말이 44px 로 부풀지 않게) 투명 ::after 로 사방 10px 터치 영역을 넓힌다.
  '[&_.justify-between:has(>.uppercase)]:min-h-8',
  '[&_.justify-between:has(>.uppercase)_:is(a,button)]:relative [&_.justify-between:has(>.uppercase)_:is(a,button)]:min-h-0',
  "[&_.justify-between:has(>.uppercase)_:is(a,button)]:after:absolute [&_.justify-between:has(>.uppercase)_:is(a,button)]:after:-inset-2.5 [&_.justify-between:has(>.uppercase)_:is(a,button)]:after:content-['']",
)

// 설정 목록 전용 — 각 행 끝에 › 셰브런(하위 화면으로 들어간다는 표시, iOS 설정 관례). 다른 모듈 목록엔 적용하지 않는다.
export const mobileSettingsListClass = "[&_nav_a]:after:ml-auto [&_nav_a]:after:text-lg [&_nav_a]:after:leading-none [&_nav_a]:after:text-muted-foreground [&_nav_a]:after:content-['›']"
