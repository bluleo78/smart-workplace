// SettingsSection 제목 크기 — 본문 섹션 제목(h2)이 헤더 바 페이지 제목(h1, 15px/700)보다 작은 14px/600 인지 본다(WP-1881).
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SettingsSection } from './SettingsSection'

describe('SettingsSection 제목', () => {
  it('섹션 제목은 헤더 바 h1(15px)보다 작은 14px/600 이다', () => {
    render(<SettingsSection title="서명">x</SettingsSection>)
    const h = screen.getByRole('heading', { level: 2, name: '서명' })
    expect(h).toHaveClass('text-sm', 'leading-5', 'font-semibold')
    expect(h).not.toHaveClass('text-base')
    expect(screen.getByRole('region', { name: '서명' })).toBeInTheDocument()
  })

  it('위험 톤은 14px 에 파괴 색을 유지한다', () => {
    render(<SettingsSection title="삭제" tone="danger">x</SettingsSection>)
    const h = screen.getByRole('heading', { level: 2, name: '삭제' })
    expect(h).toHaveClass('text-sm', 'text-destructive')
  })
})
