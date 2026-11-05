// 모바일 탭 첫 화면 헤더의 전체 검색 버튼(WP-1354) — 알림 벨 왼쪽. 누르면 통합 검색을 전체 화면으로 연다.
// 버튼은 스토어(openSearchPalette)로 열기만 하고, 그리는 곳은 휴대폰 셸의 SearchPaletteHost 하나다(시작 탭 = 지금 앱).
// 데스크톱(lg 이상)은 상단 가운데 SearchTrigger 가 맡는다 — 이 버튼이 놓이는 헤더(MobileListHeader·모바일 PageHeader)는 휴대폰에서만 그려진다.
import { Search } from 'lucide-react'

import { openSearchPalette } from '@/components/search/searchPaletteStore'

export function MobileSearchButton() {
  return (
    <button
      type="button"
      aria-label="검색"
      data-testid="mobile-search-button"
      onClick={() => openSearchPalette()}
      // 크기·색은 옆 알림 벨(NotificationBell)과 맞춘다(44px 터치 영역).
      className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"
    >
      <Search className="h-5 w-5" aria-hidden />
    </button>
  )
}
