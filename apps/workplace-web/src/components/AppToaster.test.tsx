// 앱 토스트 영역 AppToaster(WP-1428) — 토스트 컨테이너 section 의 접근성 이름이 sonner 영어 기본값
// 「Notifications」가 아니라 한국어 「알림 토스트」로 나오는지 본다.
// sonner 는 토스트가 없어도 section 을 늘 그리고, next-themes ThemeProvider 없이도 useTheme 이 기본값을 돌려준다.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AppToaster } from './AppToaster'

describe('AppToaster 접근성 이름', () => {
  it('토스트 영역 이름이 한국어 「알림 토스트」로 시작하고 영어 기본값은 없다', () => {
    render(<AppToaster />)
    // 스크린리더가 읽는 그대로 — 랜드마크(region)를 접근성 이름으로 찾는다.
    const region = screen.getByRole('region', { name: /^알림 토스트(\s|$)/ })
    const label = region.getAttribute('aria-label')
    // sonner 는 이름 뒤에 단축키 표기(alt+T)를 늘 덧붙이므로 앞부분으로 판정한다.
    expect(label).toMatch(/^알림 토스트(\s|$)/)
    expect(label).not.toContain('Notifications')
  })
})
