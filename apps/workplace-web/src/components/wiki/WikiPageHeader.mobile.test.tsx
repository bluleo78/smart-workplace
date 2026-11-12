// 휴대폰 노트 머리 「AI 작성」 표지(WP-1483) — 좁은 폭에서 제목을 밀지 않게 칩에는 짧은 글만, 이름·시각이 붙은 전체 문구는 title·스크린리더 글로.
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MobileDetailCtx } from '@/components/mobile/MobileDetailContext'
import { renderWithProviders } from '@/test/renderWithProviders'

import { WikiPageHeader } from './WikiPageHeader'

// 휴대폰 상세(병합 헤더) 분기 — 레이아웃이 주는 상세 컨텍스트를 직접 세운다.
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => true }))
// 병합 헤더의 ✦ 단추는 AI 비서 컨텍스트가 필요하다 — 이 테스트는 제목 옆 표지만 보므로 빈 단추로 바꾼다.
vi.mock('@/components/mobile/DetailAiButton', () => ({ DetailAiButton: () => null }))

function renderMobileHeader(aiLabel: string | null) {
  return renderWithProviders(
    <MobileDetailCtx.Provider value={{ title: '노트', register: () => () => {} }}>
      <WikiPageHeader
        crumbs={[{ id: 1, title: '11월 3주차 주간 리포트' }]}
        syncStatus="live"
        aiState="ready"
        aiBusy={false}
        aiAttributed
        aiLabel={aiLabel}
        pagePath={(id: number) => `/wiki/spaces/1/pages/${id}`}
        onAiAction={() => {}}
        onDelete={() => {}}
        canDelete
        onViewSource={() => {}}
      />
    </MobileDetailCtx.Provider>,
  )
}

describe('WikiPageHeader 휴대폰 「AI 작성」 표지', () => {
  it('사람이 고친 리포트 — 칩에는 「AI 작성 · 수정됨」만 보이고, 전체 문구는 title·스크린리더 글', () => {
    renderMobileHeader('AI 작성 · 양동희 수정 오늘 10:12')
    const badge = screen.getByTestId('wiki-page-ai-attribution-badge')
    const visible = badge.querySelector('[aria-hidden="true"]')
    expect(visible).toHaveTextContent(/^AI 작성 · 수정됨$/)
    expect(badge).toHaveAttribute('title', 'AI 작성 · 양동희 수정 오늘 10:12')
    expect(badge.querySelector('.sr-only')).toHaveTextContent('AI 작성 · 양동희 수정 오늘 10:12')
  })

  it('고치지 않은 리포트 — 「AI 작성」', () => {
    renderMobileHeader('AI 작성')
    const badge = screen.getByTestId('wiki-page-ai-attribution-badge')
    expect(badge.querySelector('[aria-hidden="true"]')).toHaveTextContent(/^AI 작성$/)
  })

  it('리포트가 아니면 지금처럼 「AI 생성」', () => {
    renderMobileHeader(null)
    expect(screen.getByTestId('wiki-page-ai-attribution-badge')).toHaveTextContent('AI 생성')
  })
})
