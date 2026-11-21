// IssueCommentComposer — 저장 안 한 입력 경고(hasDraft)가 입력칸 내용을 따라가는지(WP-1923).
import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { editorOf } from '@/test/kits/richEditor'
import { renderWithProviders } from '@/test/renderWithProviders'

import { IssueCommentComposer } from './IssueCommentComposer'

const warn = vi.hoisted(() => vi.fn())
const control = vi.hoisted(() => ({ resolve: () => {} }))

vi.mock('../../../hooks/useUnsavedChangesWarning', () => ({ useUnsavedChangesWarning: warn }))
vi.mock('../../../hooks/queries/useProjectMembers', () => ({ useProjectMembers: () => ({ data: [] }) }))
vi.mock('../../../hooks/queries/useIssueComments', () => ({
  useCreateComment: () => ({
    isPending: false,
    mutateAsync: () =>
      new Promise((res) => {
        control.resolve = () => res({ id: 1 })
      }),
  }),
}))

describe('IssueCommentComposer 초안 경고', () => {
  it('전송 중 이어 쓴 글자가 남으면 성공 뒤에도 초안으로 본다', async () => {
    renderWithProviders(<IssueCommentComposer projectKey="WP" issueNumber={1} issueId={1} />)
    const editor = editorOf(screen.getByTestId('issue-comment-input'))
    act(() => {
      editor.chain().focus('end').insertContent('안녕').run()
    })
    expect(warn).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByTestId('issue-comment-submit'))
    act(() => {
      editor.chain().focus('end').insertContent(' 더').run()
    })
    await act(async () => control.resolve())
    expect(screen.getByTestId('issue-comment-input').textContent).toBe(' 더')
    expect(warn).toHaveBeenLastCalledWith(true)
  })

  it('전부 보내고 비워지면 초안이 아니다', async () => {
    renderWithProviders(<IssueCommentComposer projectKey="WP" issueNumber={1} issueId={1} />)
    const editor = editorOf(screen.getByTestId('issue-comment-input'))
    act(() => {
      editor.chain().focus('end').insertContent('안녕').run()
    })
    fireEvent.click(screen.getByTestId('issue-comment-submit'))
    await act(async () => control.resolve())
    expect(screen.getByTestId('issue-comment-input').textContent).toBe('')
    expect(warn).toHaveBeenLastCalledWith(false)
  })
})
