// 모바일 하단 고정 줄 자리(WP-1524) — 서식 줄 위에 쌓는 줄의 offset 이 서식 줄 높이를 이루는 항목(safe-area 여백 포함)을 모두 더하는지 본다.
import { describe, expect, it } from 'vitest'

import {
  MAIL_MOBILE_ABOVE_FORMAT_BAR_CLASS,
  MAIL_MOBILE_FORMAT_BAR_CLASS,
  MAIL_MOBILE_PANEL_CLASS,
  MAIL_MOBILE_PANEL_RESERVE_CLASS,
  scrollCaretAbovePanel,
} from './mailMobileBars'

/** 서식 줄 아래 여백(홈 바 safe-area) — 서식 줄 pb 와 위 줄 offset 이 같은 값이어야 한다. */
const SAFE_PAD = 'max(0.125rem,env(safe-area-inset-bottom))'

/** 클래스 목록에서 접두어로 시작하는 클래스 하나. */
function cls(list: string, prefix: string): string | undefined {
  return list.split(/\s+/).find((c) => c.startsWith(prefix))
}

describe('mailMobileBars', () => {
  it('서식 줄 높이는 고정(box-content h-11 · pt-0.5 · 위 테두리)이고 아래 여백이 safe-area 항목이다', () => {
    for (const c of ['box-content', 'h-11', 'pt-0.5', 'border-t', 'bottom-[var(--kb-inset,0px)]']) {
      expect(MAIL_MOBILE_FORMAT_BAR_CLASS.split(/\s+/)).toContain(c)
    }
    expect(cls(MAIL_MOBILE_FORMAT_BAR_CLASS, 'pb-')).toBe(`pb-[${SAFE_PAD}]`)
  })

  it('서식 줄은 44px 단추 여덟 칸이 360px 안에 들도록 사이 간격 없이 px-1 이다', () => {
    const list = MAIL_MOBILE_FORMAT_BAR_CLASS.split(/\s+/)
    expect(list).toContain('gap-0')
    expect(list).toContain('px-1')
  })

  it('위 줄 offset 은 키보드 높이 + 서식 줄 높이(1px + 0.125rem + 2.75rem + safe-area 여백)다', () => {
    expect(cls(MAIL_MOBILE_ABOVE_FORMAT_BAR_CLASS, 'bottom-')).toBe(
      `bottom-[calc(var(--kb-inset,0px)+1px+0.125rem+2.75rem+${SAFE_PAD})]`,
    )
  })

  it('패널은 서식 줄 바로 위 자리이고, 본문 아래 빈 자리 높이는 패널 최대 높이와 같다', () => {
    expect(cls(MAIL_MOBILE_PANEL_CLASS, 'bottom-')).toBe(cls(MAIL_MOBILE_ABOVE_FORMAT_BAR_CLASS, 'bottom-'))
    const maxH = cls(MAIL_MOBILE_PANEL_CLASS, 'max-h-')
    expect(maxH).toBe('max-h-[calc(var(--vvh,100dvh)*0.45)]')
    expect(cls(MAIL_MOBILE_PANEL_RESERVE_CLASS, 'h-')).toBe(maxH?.replace('max-h-', 'h-'))
  })

  it('커서가 패널 뒤에 가렸으면 그만큼(+틈 8px) 스크롤하고, 아니면 그대로 둔다', () => {
    const scroller = { scrollTop: 100 }
    expect(scrollCaretAbovePanel(scroller, 300, 500)).toBe(0)
    expect(scroller.scrollTop).toBe(100)
    expect(scrollCaretAbovePanel(scroller, 600, 500)).toBe(108)
    expect(scroller.scrollTop).toBe(208)
  })
})
