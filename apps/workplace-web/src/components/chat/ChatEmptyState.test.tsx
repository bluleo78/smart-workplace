import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChatEmptyState } from './ChatEmptyState'

// 공용 빈 상태(WP-1881 리뷰 후속) — 제목은 본문 섹션 제목 위계(14px/600)로 맞춘다.
// 손으로 만든 빈 상태(드라이브 「최근」 등)는 bodySectionTitleClass(14/20/600) 라 크기가 섞이면 안 된다.
describe('ChatEmptyState', () => {
  it('제목이 섹션 제목 위계(text-sm · 600) — 16px(text-base)이 아니다', () => {
    render(<ChatEmptyState title="별표한 항목 없음" description="파일이나 폴더의 메뉴에서 「별표」를 누르면 여기에 모입니다." />)
    const title = screen.getByText('별표한 항목 없음')
    expect(title.className).toContain('text-sm')
    expect(title.className).toContain('font-semibold')
    expect(title.className).not.toContain('text-base')
    // WP-1553 회귀 — 공백 없는 긴 채널 이름이 칸 밖으로 넘치지 않게 접는 클래스는 그대로 남는다.
    expect(title.className).toContain('max-w-full')
    expect(title.className).toContain('wrap-anywhere')
  })

  it('설명은 제목과 다른 굵기로 남아 구분된다', () => {
    render(<ChatEmptyState title="대화의 시작" description="첫 메시지를 남겨 보세요." />)
    const description = screen.getByText('첫 메시지를 남겨 보세요.')
    expect(description.tagName).toBe('P')
    expect(description.className).toContain('text-sm')
    expect(description.className).not.toContain('font-semibold')
  })
})