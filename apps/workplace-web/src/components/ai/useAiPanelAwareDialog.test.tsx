// AI 옆 패널과 함께 쓰는 대화상자 배치(WP-54) — 오른쪽 도킹 칸 전체(AI 옆 패널 + 도움말 패널, WP-1505)를 피하는지.
// 도움말이 열린 채(AI 닫힘) 메일 작성 크게 보기가 도움말을 120px 가리고, 비모달 대화상자가 도움말 위에 겹쳤다 — AI 폭만 뺐기 때문이다.
// 실제 상자 위치는 jsdom 이 잴 수 없으므로 식을 본다: 칸을 피하는 자리는 칸 전체 폭 변수(--right-dock-width, index.css :root) 하나를 읽고,
// AI 폭(--ai-side-width)·도움말 폭(--help-side-width)을 따로 빼지 않아야 한다(상수를 쓰지 않는 소비처까지는 rightDockWidth.test.ts 가 소스를 훑어 본다).
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AI_SIDE_CENTER_CLASS, AI_SIDE_OVERLAY_CLASS, useAiPanelAwareDialog } from './useAiPanelAwareDialog'

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false, getIsMobile: () => false }))
// side 모드 — 비모달 배치 클래스가 붙는 경우.
vi.mock('@/components/ai/AIAssistantContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOptionalAssistant: () => ({ mode: 'side', close: () => {} }),
}))

const RIGHT_DOCK = 'var(--right-dock-width)'

describe('AI 옆 패널과 함께 쓰는 대화상자 배치', () => {
  it('가운데 축·dim 은 도킹 칸 전체 폭을 뺀 페이지 영역 기준이다', () => {
    expect(AI_SIDE_CENTER_CLASS).toContain(RIGHT_DOCK)
    expect(AI_SIDE_OVERLAY_CLASS).toContain(RIGHT_DOCK)
  })

  it.each(['default', 'form', 'wide', 'lightbox', 'drawer'] as const)('side 모드 %s 대화상자는 도움말 패널도 피한다', (size) => {
    const { result } = renderHook(() => useAiPanelAwareDialog({ open: true, size }))
    expect(result.current.modal).toBe(false)
    expect(result.current.contentClassName).toContain(RIGHT_DOCK)
  })
})
