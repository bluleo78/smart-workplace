// IssueEditConflictBanner 컴포넌트 테스트(WP-2095) — 문구·단추·펼침/접기·덮어쓰기 확인 창.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { IssueEditConflictBanner, IssueEditNotice } from './IssueEditConflictBanner'

describe('IssueEditConflictBanner', () => {
  it('본문 충돌 — 문구와 세 단추, 최신 값은 접혀 있다', () => {
    render(<IssueEditConflictBanner field="body" mode="conflict" latest="남의 본문" onTakeLatest={vi.fn()} onOverwrite={vi.fn()} />)
    expect(screen.getByTestId('issue-edit-conflict-body')).toHaveTextContent(
      '다른 사람이 방금 본문을 먼저 저장했습니다. 내 글은 아직 저장되지 않았습니다.',
    )
    expect(screen.getByRole('button', { name: '최신 본문 보기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '최신 본문으로 다시 쓰기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '내 글로 덮어쓰기…' })).toBeInTheDocument()
    expect(screen.queryByTestId('issue-edit-latest-body')).not.toBeInTheDocument()
  })

  it('제목 충돌 — 제목 문구, 펼치면 원문 그대로 보이고 접기로 다시 접힌다', async () => {
    render(<IssueEditConflictBanner field="title" mode="conflict" latest="남의 제목" onTakeLatest={vi.fn()} onOverwrite={vi.fn()} />)
    expect(screen.getByTestId('issue-edit-conflict-title')).toHaveTextContent('다른 사람이 방금 제목을 먼저 저장했습니다.')
    expect(screen.getByRole('button', { name: '최신 제목으로 다시 쓰기' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '최신 제목 보기' }))
    expect(screen.getByTestId('issue-edit-latest-title')).toHaveTextContent('남의 제목')
    await userEvent.click(screen.getByRole('button', { name: '최신 제목 접기' }))
    expect(screen.queryByTestId('issue-edit-latest-title')).not.toBeInTheDocument()
  })

  it('본문 최신 값은 마크다운을 렌더하지 않고 원문 그대로 보인다', async () => {
    render(<IssueEditConflictBanner field="body" mode="conflict" latest={'# 제목\n**굵게**'} />)
    await userEvent.click(screen.getByRole('button', { name: '최신 본문 보기' }))
    const box = screen.getByTestId('issue-edit-latest-body')
    expect(box.textContent).toBe('# 제목\n**굵게**')
    expect(box).toHaveClass('whitespace-pre-wrap')
  })

  it('stale 모양은 최신 보기 단추만 있다', () => {
    render(<IssueEditConflictBanner field="body" mode="stale" latest="남의 본문" onTakeLatest={vi.fn()} onOverwrite={vi.fn()} />)
    expect(screen.getByTestId('issue-edit-stale-body')).toHaveTextContent(
      '그사이 다른 사람이 본문을 저장했습니다. 저장하면 충돌 안내가 뜹니다.',
    )
    expect(screen.getByRole('button', { name: '최신 본문 보기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '최신 본문으로 다시 쓰기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '내 글로 덮어쓰기…' })).not.toBeInTheDocument()
  })

  it('덮어쓰기는 확인 창에서 「덮어쓰기」를 눌러야만 부른다 — 돌아가기는 부르지 않는다', async () => {
    const onOverwrite = vi.fn()
    render(<IssueEditConflictBanner field="body" mode="conflict" latest="x" onOverwrite={onOverwrite} />)
    await userEvent.click(screen.getByRole('button', { name: '내 글로 덮어쓰기…' }))
    expect(await screen.findByText('다른 사람의 본문을 덮어쓸까요?')).toBeInTheDocument()
    expect(screen.getByText('방금 저장된 다른 사람의 글이 내 글로 바뀝니다. 바뀐 뒤에는 되돌릴 수 없습니다.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '돌아가기' }))
    expect(onOverwrite).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '내 글로 덮어쓰기…' }))
    await userEvent.click(await screen.findByRole('button', { name: '덮어쓰기' }))
    expect(onOverwrite).toHaveBeenCalledTimes(1)
  })

  it('최신으로 다시 쓰기 단추가 콜백을 부른다', async () => {
    const onTakeLatest = vi.fn()
    render(<IssueEditConflictBanner field="body" mode="conflict" latest="x" onTakeLatest={onTakeLatest} />)
    await userEvent.click(screen.getByRole('button', { name: '최신 본문으로 다시 쓰기' }))
    expect(onTakeLatest).toHaveBeenCalledTimes(1)
  })

  it('stale 에서 펼친 뒤 conflict 로 바뀌면 접힌 채 시작하고, 같은 conflict 에서 latest 가 바뀌어도 접힌 채 시작한다', async () => {
    const { rerender } = render(<IssueEditNotice field="body" changedWhileEditing={{ latest: 'A' }} />)
    await userEvent.click(screen.getByRole('button', { name: '최신 본문 보기' }))
    expect(screen.getByTestId('issue-edit-latest-body')).toBeInTheDocument()
    rerender(<IssueEditNotice field="body" conflict={{ latest: 'A', latestVersion: 2 }} />)
    expect(screen.queryByTestId('issue-edit-latest-body')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '최신 본문 보기' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '최신 본문 보기' }))
    rerender(<IssueEditNotice field="body" conflict={{ latest: 'B', latestVersion: 3 }} />)
    expect(screen.queryByTestId('issue-edit-latest-body')).not.toBeInTheDocument()
  })
})
