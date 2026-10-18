// InlineEditableTitle 컴포넌트 테스트 — 모바일(textarea) 경로의 200자 제한과 저장 실패 뒤 재포커스(WP-459).
// 데스크톱(Input) 경로와 Esc 동작은 e2e/pages/projects/issue-title-body-edit.spec.ts 가 지킨다.
import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { InlineEditableTitle } from './InlineEditableTitle'

describe('InlineEditableTitle 모바일(commitOnBlur=false)', () => {
  it('입력은 200자로 제한되고, 저장 중 비활성이 풀리면 다시 포커스된다', async () => {
    const { rerender } = renderWithProviders(
      <InlineEditableTitle title="원본" onSave={() => {}} disabled={false} commitOnBlur={false} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    const textarea = screen.getByRole('textbox', { name: '이슈 제목' })
    expect(textarea).toHaveAttribute('maxLength', '200')

    // 저장 중(disabled) 다시 열린 상황 — 포커스가 빠져 있다가 비활성이 풀리면 돌아와야 한다.
    textarea.blur()
    rerender(<InlineEditableTitle title="원본" onSave={() => {}} disabled commitOnBlur={false} />)
    expect(textarea).not.toHaveFocus()
    await act(async () => {
      rerender(<InlineEditableTitle title="원본" onSave={() => {}} disabled={false} commitOnBlur={false} />)
    })
    expect(textarea).toHaveFocus()
  })
})
