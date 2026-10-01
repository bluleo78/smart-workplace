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
  // 머리말 아이콘(＋·🔍)은 본문색 — 채팅(ghost 버튼) 기준에 드라이브·노트의 흐린 ＋ 를 맞춘다(U3-R5).
  '[&_.justify-between:has(>.uppercase)_:is(a,button)]:text-foreground',
)

// 노트 목록 전용(U3-R5) — 노트 사이드바는 "페이지" 머리말이 스크롤 래퍼(p-3) 없이 aside 바로 아래(px-3)라 채팅·드라이브(24px)보다
// 왼쪽(12px)에서 시작한다 → 24px 로 맞춘다. ＋ 는 글리프 문자라 아이콘(16px)보다 작아 보여 크기·폭을 채팅 ＋ 버튼(24px 칸)과 맞춘다.
export const mobileWikiListClass = cn(
  '[&>aside>.justify-between:has(>.uppercase)]:px-6',
  "[&_button[aria-label='새_페이지']]:flex [&_button[aria-label='새_페이지']]:h-6 [&_button[aria-label='새_페이지']]:w-6 [&_button[aria-label='새_페이지']]:items-center [&_button[aria-label='새_페이지']]:justify-center [&_button[aria-label='새_페이지']]:px-0 [&_button[aria-label='새_페이지']]:text-xl [&_button[aria-label='새_페이지']]:leading-none",
)

// 드라이브 목록 전용(U3-R5) — "첨부 모아보기"는 데스크톱 하단 보조 링크(12px)라 목록 행(14px)보다 작다 → 행 글자 크기로.
export const mobileDriveListClass = "[&_[data-testid='drive-nav-attachments']]:text-sm"

// 설정 목록 전용 — 각 행 끝에 › 셰브런(하위 화면으로 들어간다는 표시, iOS 설정 관례). 다른 모듈 목록엔 적용하지 않는다.
export const mobileSettingsListClass = "[&_nav_a]:after:ml-auto [&_nav_a]:after:text-lg [&_nav_a]:after:leading-none [&_nav_a]:after:text-muted-foreground [&_nav_a]:after:content-['›']"
