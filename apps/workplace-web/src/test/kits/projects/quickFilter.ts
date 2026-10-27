// 빠른 필터 칩 줄(WP-1020) 테스트 도우미 — 이슈 목록 필터 바의 facet 값 목록을 연다.
// 칩으로 보이는 facet 은 칩을 누르고, 아니면 「더 보기 ＋」 → 그 facet 을 누른다(사람이 하는 그대로).
import { screen } from '@testing-library/react'

import type { ScreenUser } from '@/test/renderScreen'

/** 데스크톱 칩 줄에서 facet 의 값 목록 팝오버를 연다. */
export async function openQuickFacet(user: ScreenUser, key: string) {
  // 칩 줄이 그려질 때까지 기다린다.
  await screen.findByTestId('quick-filter-bar')
  const chip = screen.queryByTestId(`quick-filter-${key}-trigger`)
  if (chip) {
    await user.click(chip)
  } else {
    await user.click(screen.getByTestId('quick-filter-more'))
    await user.click(await screen.findByTestId(`quick-filter-more-facet-${key}`))
  }
  await screen.findByTestId(`quick-filter-panel-${key}`)
}

/** 모바일 칩 줄에서 facet 의 값 시트를 연다. */
export async function openMobileQuickFacet(user: ScreenUser, key: string) {
  await screen.findByTestId('mobile-quick-filter-row')
  const chip = screen.queryByTestId(`mobile-quick-filter-${key}`)
  if (chip) {
    // 걸린 칩은 본문 버튼(첫 버튼)이 값 시트를 연다.
    await user.click(chip.tagName === 'BUTTON' ? chip : chip.querySelector('button')!)
  } else {
    await user.click(screen.getByTestId('mobile-quick-filter-more'))
    await user.click(await screen.findByTestId(`mobile-quick-filter-more-facet-${key}`))
  }
  return screen.findByTestId('mobile-quick-filter-sheet')
}
