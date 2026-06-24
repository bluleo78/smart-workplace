import { describe, expect, it } from 'vitest'

import {
  AI_CONTENT_CONTAINER_CLASS,
  AI_LABEL_CLASS,
  aiSignalBadgeClass,
} from './aiMarker'

// AI 마커 클래스-빌더 — 시맨틱 토큰만 쓰는지, variant별 스타일이 의도대로인지 검증.
describe('aiSignalBadgeClass', () => {
  it('action variant = 솔리드 ai-accent 배경', () => {
    const cls = aiSignalBadgeClass('action')
    expect(cls).toContain('bg-ai-accent')
    expect(cls).toContain('text-ai-accent-foreground')
  })
  it('info variant = 연한 ai-accent-subtle 배경', () => {
    const cls = aiSignalBadgeClass('info')
    expect(cls).toContain('bg-ai-accent-subtle')
    expect(cls).toContain('text-ai-accent')
  })
  it('어떤 variant도 하드코딩 색(violet-/red-/indigo-/primary)을 쓰지 않는다', () => {
    for (const v of ['action', 'info'] as const) {
      const cls = aiSignalBadgeClass(v)
      expect(cls).not.toMatch(/\b(violet|red|indigo|purple|primary)-/)
    }
  })
})

describe('컨테이너/라벨 클래스', () => {
  it('아우라 컨테이너 = 좌측 보더 + 연한 배경(ai-accent 토큰)', () => {
    expect(AI_CONTENT_CONTAINER_CLASS).toContain('border-l')
    expect(AI_CONTENT_CONTAINER_CLASS).toContain('border-ai-accent')
    expect(AI_CONTENT_CONTAINER_CLASS).toContain('bg-ai-accent-subtle')
  })
  it('라벨 = ai-accent 텍스트', () => {
    expect(AI_LABEL_CLASS).toContain('text-ai-accent')
  })
})
