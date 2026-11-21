import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChatEmptyState } from './ChatEmptyState'

// 공용 빈 상태(WP-1924) — 디자인 시스템 06 빈 상태 규격(제목 text-sm·font-medium, 본문 text-xs·muted)을 따른다.
// 섹션 제목(600)·본문(text-sm)과 구분되는 규격이라 크기·굵기가 섞이면 안 된다.
describe('ChatEmptyState', () => {
  it('제목은 빈 상태 규격(text-sm · font-medium) — 섹션 제목 600 이 아니다', () => {
    render(<ChatEmptyState title="별표한 항목 없음" description="파일이나 폴더의 메뉴에서 「별표」를 누르면 여기에 모입니다." />)
    const title = screen.getByText('별표한 항목 없음')
    expect(title.className).toContain('text-sm')
    expect(title.className).toContain('font-medium')
    expect(title.className).not.toContain('font-semibold')
    // WP-1553 회귀 — 공백 없는 긴 채널 이름이 칸 밖으로 넘치지 않게 접는 클래스는 그대로 남는다.
    expect(title.className).toContain('max-w-full')
    expect(title.className).toContain('wrap-anywhere')
  })

  it('설명은 규격 본문(text-xs · muted)', () => {
    render(<ChatEmptyState title="대화의 시작" description="첫 메시지를 남겨 보세요." />)
    const description = screen.getByText('첫 메시지를 남겨 보세요.')
    expect(description.tagName).toBe('P')
    expect(description.className).toContain('text-xs')
    expect(description.className).toContain('text-muted-foreground')
  })
})
