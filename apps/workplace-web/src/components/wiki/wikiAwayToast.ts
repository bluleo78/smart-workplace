import { toast } from 'sonner'

import { getIsMobile } from '@/hooks/useIsMobile'

/** 복귀 토스트 문구(스펙 §7.2) — "· 변경 보기" 는 액션 버튼으로 따로 붙는다. */
export function awayToastMessage(editors: number): string {
  return `자리를 비운 동안 ${editors}명이 수정했어요`
}

/**
 * 2분 넘게 비운 사이 남의 수정이 있었을 때의 토스트(WP-293). 같은 id 라 연달아 와도 하나만 보인다.
 * onViewChanges 가 있을 때만 "변경 보기"(버전 기록 비교로 이동) 액션을 단다 — TODO(WP-282): 버전 기록 비교가 생기면 WikiPageView 가 넘긴다.
 */
export function showAwayToast(editors: number, onViewChanges?: () => void): void {
  toast(awayToastMessage(editors), {
    id: 'wiki-away-changes',
    // 모바일(lg 미만)에서만 이 토스트를 화면 아래에 둔다 — 디자인시스템 06 §D "호출부에서 position 지정 안 함" 의 승인된 예외(사용자 결정 2026-10-09).
    // 위쪽 전체 폭 토스트가 짧은 노트의 첫 블록(알리는 바로 그 따라잡기 하이라이트)을 하이라이트가 사는 내내 가렸다. 데스크톱은 본문 칼럼 밖 top-right 라 그대로.
    // 아래 여백(safe-area·키보드)은 main.tsx Toaster 의 bottom 오프셋이 맡는다.
    ...(getIsMobile() ? { position: 'bottom-center' as const } : {}),
    ...(onViewChanges ? { action: { label: '변경 보기', onClick: onViewChanges } } : {}),
  })
}
