// InlineEditableTitle 컴포넌트 테스트 — 모바일(textarea) 경로의 200자 제한과 저장 실패 뒤 재포커스(WP-459).
// 데스크톱(Input) 경로와 Esc 동작은 e2e/pages/projects/issue-title-body-edit.spec.ts 가 지킨다.
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { InlineEditableTitle } from './InlineEditableTitle'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

describe('InlineEditableTitle 모바일(commitOnBlur=false)', () => {
  it('heading 을 넘기면 편집 중 textarea 도 heading 안에 있다(편집 중 h1 이 사라지지 않는다)', () => {
    renderWithProviders(
      <InlineEditableTitle title="원본" onSave={vi.fn(async () => true)} disabled={false} commitOnBlur={false} heading={(c) => <h1 aria-label="원본">{c}</h1>} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    expect(screen.getByRole('heading', { level: 1 })).toContainElement(screen.getByRole('textbox', { name: '이슈 제목' }))
  })


  it('컨테이너 밖으로 포커스가 나가도 onSave 를 부르지 않는다', async () => {
    const onSave = vi.fn(async () => true)
    renderWithProviders(
      <div>
        <InlineEditableTitle title="원본" onSave={onSave} disabled={false} commitOnBlur={false} />
        <button type="button">바깥</button>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    fireEvent.change(screen.getByRole('textbox', { name: '이슈 제목' }), { target: { value: '내 제목' } })
    await userEvent.click(screen.getByRole('button', { name: '바깥' }))
    expect(onSave).not.toHaveBeenCalled()
  })

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

describe('InlineEditableTitle 충돌 안내(WP-2095)', () => {
  const conflict = { latest: '남의 제목', latestVersion: 9 }

  it('충돌 중 안내 단추를 누르면 입력칸이 blur 돼도 저장을 부르지 않는다', async () => {
    const onSave = vi.fn(async () => true)
    renderWithProviders(<InlineEditableTitle title="원본" onSave={onSave} disabled={false} conflict={conflict} onTakeLatest={() => '남의 제목'} />)
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    const input = screen.getByTestId('issue-title-input')
    fireEvent.change(input, { target: { value: '내 제목' } })
    expect(screen.getByTestId('issue-edit-conflict-title')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '최신 제목 보기' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('issue-title-input')).toBeInTheDocument()
  })

  it('충돌 중 Enter·blur 는 onSave 를 부르지 않는다', () => {
    const onSave = vi.fn(async () => true)
    renderWithProviders(<InlineEditableTitle title="원본" onSave={onSave} disabled={false} conflict={conflict} onOverwrite={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    const input = screen.getByTestId('issue-title-input')
    fireEvent.change(input, { target: { value: '내 제목' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('issue-title-input')).toBeInTheDocument()
  })

  it('그사이 바뀜 안내 중 [최신 제목 보기] 를 눌러 입력칸이 blur 돼도 저장하지 않고 안내를 펼친다', async () => {
    const onSave = vi.fn(async () => true)
    renderWithProviders(<InlineEditableTitle title="원본" onSave={onSave} disabled={false} changedWhileEditing={{ latest: '남의 새 제목' }} />)
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    fireEvent.change(screen.getByTestId('issue-title-input'), { target: { value: '내 제목' } })
    await userEvent.click(screen.getByRole('button', { name: '최신 제목 보기' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('issue-title-input')).toBeInTheDocument()
    expect(screen.getByTestId('issue-edit-latest-title')).toHaveTextContent('남의 새 제목')
  })

  // 코드 리뷰 지적 3 — 그사이 바뀜 안내 중 다른 곳을 눌러 떠나면 입력한 제목이 말없이 사라지던 문제.
  it('그사이 바뀜 안내 중 입력칸 밖을 눌러 blur 되면 평소처럼 저장한다', () => {
    const onSave = vi.fn(async () => true)
    renderWithProviders(<InlineEditableTitle title="원본" onSave={onSave} disabled={false} changedWhileEditing={{ latest: '남의 새 제목' }} />)
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    const input = screen.getByTestId('issue-title-input')
    fireEvent.change(input, { target: { value: '내 제목' } })
    fireEvent.blur(input)
    expect(onSave).toHaveBeenCalledWith('내 제목')
  })

  // 코드 리뷰 지적 2 — 키보드(Tab)로 안내 단추로 옮겨 가도 blur 저장이 나가면 안 된다.
  it('포커스가 안내 안으로 옮겨 가는 blur 는 저장하지 않는다', () => {
    const onSave = vi.fn(async () => true)
    renderWithProviders(<InlineEditableTitle title="원본" onSave={onSave} disabled={false} changedWhileEditing={{ latest: '남의 새 제목' }} />)
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    const input = screen.getByTestId('issue-title-input')
    fireEvent.change(input, { target: { value: '내 제목' } })
    fireEvent.blur(input, { relatedTarget: screen.getByRole('button', { name: '최신 제목 보기' }) })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('issue-title-input')).toBeInTheDocument()
  })

  // 2차 리뷰 지적 2 — 충돌 중 blur 에서 입력칸이 포커스를 되찾으면 확인 창·다른 컨트롤과 포커스가 서로 당긴다.
  it('충돌 중 바깥 단추로 포커스를 옮기면 입력칸이 포커스를 되찾지 않고 저장도 없다', async () => {
    const onSave = vi.fn(async () => true)
    renderWithProviders(
      <div>
        <InlineEditableTitle title="원본" onSave={onSave} disabled={false} conflict={conflict} />
        <button type="button">바깥</button>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    const input = screen.getByTestId('issue-title-input')
    fireEvent.change(input, { target: { value: '내 제목' } })
    await userEvent.click(screen.getByRole('button', { name: '바깥' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '바깥' })).toHaveFocus()
  })

  // 2차 리뷰 지적 3 — 안내로 Tab 한 뒤 안내 밖으로 나가면 편집이 열린 채 남던 문제.
  it('그사이 바뀜 안내로 Tab 한 뒤 안내 밖으로 포커스가 나가면 입력한 제목을 저장한다', async () => {
    const onSave = vi.fn(async () => true)
    renderWithProviders(
      <div>
        <button type="button">바깥</button>
        <InlineEditableTitle title="원본" onSave={onSave} disabled={false} changedWhileEditing={{ latest: '남의 새 제목' }} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    fireEvent.change(screen.getByTestId('issue-title-input'), { target: { value: '내 제목' } })
    // 안내는 입력칸 앞 형제라 Shift+Tab 으로 들어가고, 한 번 더 Shift+Tab 으로 안내 밖(앞 단추)으로 나간다.
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: '최신 제목 보기' })).toHaveFocus()
    expect(onSave).not.toHaveBeenCalled()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: '바깥' })).toHaveFocus()
    expect(onSave).toHaveBeenCalledWith('내 제목')
  })

  // Esc 는 입력칸 blur 가 컨테이너 focusout 으로 들어와도 저장 없이 끝나야 한다(skipCommitRef).
  it('Esc 는 저장 없이 편집을 닫는다', () => {
    const onSave = vi.fn(async () => true)
    const onEditEnd = vi.fn()
    renderWithProviders(<InlineEditableTitle title="원본" onSave={onSave} disabled={false} onEditEnd={onEditEnd} />)
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    const input = screen.getByTestId('issue-title-input')
    input.focus()
    fireEvent.change(input, { target: { value: '내 제목' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onSave).not.toHaveBeenCalled()
    expect(onEditEnd).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('issue-title-input')).not.toBeInTheDocument()
  })

  // 2차 리뷰 지적 4 — 덮어쓰기 확인 때 입력이 비었거나 최신 제목과 같으면 아무 일 없이 창만 닫히던 문제.
  it('덮어쓰기 확인 때 입력이 비면 토스트로 알리고 충돌 안내를 남긴다', async () => {
    const onOverwrite = vi.fn()
    const onSave = vi.fn(async () => true)
    renderWithProviders(<InlineEditableTitle title="원본" onSave={onSave} disabled={false} conflict={conflict} onOverwrite={onOverwrite} />)
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    fireEvent.change(screen.getByTestId('issue-title-input'), { target: { value: '  ' } })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-title-overwrite'))
    await userEvent.click(screen.getByRole('button', { name: '덮어쓰기' }))
    expect(toast.error).toHaveBeenCalledWith('제목을 비울 수 없습니다')
    expect(onOverwrite).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('issue-edit-conflict-title')).toBeInTheDocument()
  })

  it('덮어쓰기 확인 때 입력이 최신 제목과 같으면 최신으로 받고 편집을 닫는다', async () => {
    const onTakeLatest = vi.fn(() => '남의 제목')
    const onOverwrite = vi.fn()
    const onEditEnd = vi.fn()
    const onSave = vi.fn(async () => true)
    renderWithProviders(
      <InlineEditableTitle title="원본" onSave={onSave} disabled={false} conflict={conflict} onTakeLatest={onTakeLatest} onOverwrite={onOverwrite} onEditEnd={onEditEnd} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    fireEvent.change(screen.getByTestId('issue-title-input'), { target: { value: '남의 제목' } })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-title-overwrite'))
    await userEvent.click(screen.getByRole('button', { name: '덮어쓰기' }))
    expect(onTakeLatest).toHaveBeenCalled()
    expect(onOverwrite).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    expect(onEditEnd).toHaveBeenCalled()
    expect(screen.queryByTestId('issue-title-input')).not.toBeInTheDocument()
  })

  // 2차 리뷰 지적 6 — 안내(role=alert·단추)가 h1 접근 이름에 가려지지 않게 heading 감싸개 밖에 놓인다.
  it('heading 을 넘기면 안내가 heading 이 감싼 요소 밖에 있다', () => {
    renderWithProviders(
      <InlineEditableTitle
        title="원본"
        onSave={vi.fn(async () => true)}
        disabled={false}
        conflict={conflict}
        heading={(content) => <h1 aria-label="원본">{content}</h1>}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toContainElement(screen.getByTestId('issue-title-input'))
    expect(h1).not.toContainElement(screen.getByRole('alert'))
  })

  // 코드 리뷰 지적 4 — 비었거나 그대로인 입력으로 덮어쓰면 충돌만 풀리고 저장은 없던 문제.
  // 1차 리뷰 지적 4 회귀 방지 — 입력이 원래 제목 그대로면 저장할 것이 없어 충돌을 풀지 않고 요청도 없다.
  it('덮어쓰기 확인 때 입력이 원래 제목 그대로면 충돌을 풀지 않고 요청도 보내지 않는다', async () => {
    const onOverwrite = vi.fn()
    const onEditEnd = vi.fn()
    const onSave = vi.fn(async () => true)
    renderWithProviders(
      <InlineEditableTitle title="원본" onSave={onSave} disabled={false} conflict={conflict} onOverwrite={onOverwrite} onEditEnd={onEditEnd} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    fireEvent.change(screen.getByTestId('issue-title-input'), { target: { value: '원본' } })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-title-overwrite'))
    await userEvent.click(screen.getByRole('button', { name: '덮어쓰기' }))
    expect(onOverwrite).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    expect(onEditEnd).not.toHaveBeenCalled()
    expect(screen.getByTestId('issue-edit-conflict-title')).toBeInTheDocument()
  })

  it('충돌 안내 중 입력칸 밖으로 blur 되면 저장하지 않는다(안내가 다음 행동을 이끈다)', () => {
    const onSave = vi.fn(async () => true)
    renderWithProviders(<InlineEditableTitle title="원본" onSave={onSave} disabled={false} conflict={conflict} />)
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    const input = screen.getByTestId('issue-title-input')
    fireEvent.change(input, { target: { value: '내 제목' } })
    fireEvent.blur(input)
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('issue-title-input')).toBeInTheDocument()
  })

  it('안내 단추에 포커스가 있을 때 Esc 는 편집을 취소한다(저장 없이)', () => {
    const onSave = vi.fn(async () => true)
    const onEditEnd = vi.fn()
    renderWithProviders(
      <InlineEditableTitle title="원본" onSave={onSave} disabled={false} conflict={conflict} onTakeLatest={() => '남의 제목'} onEditEnd={onEditEnd} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    fireEvent.change(screen.getByTestId('issue-title-input'), { target: { value: '내 제목' } })
    const takeLatest = screen.getByTestId('issue-edit-conflict-title-take-latest')
    takeLatest.focus()
    fireEvent.keyDown(takeLatest, { key: 'Escape' })
    expect(screen.queryByTestId('issue-title-input')).not.toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
    expect(onEditEnd).toHaveBeenCalledTimes(1)
  })

  it('안내 단추를 눌러도 입력칸 포커스가 그대로다(mousedown 이 포커스를 가져가지 않는다)', async () => {
    renderWithProviders(<InlineEditableTitle title="원본" onSave={vi.fn(async () => true)} disabled={false} changedWhileEditing={{ latest: '남의 새 제목' }} />)
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    const input = screen.getByTestId('issue-title-input')
    input.focus()
    await userEvent.click(screen.getByRole('button', { name: '최신 제목 보기' }))
    expect(input).toHaveFocus()
  })

  // 코드 리뷰 지적 5 — 충돌이 없어 최신 값이 null 이면 입력칸을 비우지 않는다.
  it('onTakeLatest 가 null 을 돌려주면 입력칸을 그대로 둔다', async () => {
    renderWithProviders(<InlineEditableTitle title="원본" onSave={vi.fn(async () => true)} disabled={false} conflict={conflict} onTakeLatest={() => null} />)
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    fireEvent.change(screen.getByTestId('issue-title-input'), { target: { value: '내 제목' } })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-title-take-latest'))
    expect(screen.getByTestId('issue-title-input')).toHaveValue('내 제목')
  })

  it('충돌이 없으면 blur 저장은 그대로다', () => {
    const onSave = vi.fn(async () => true)
    renderWithProviders(<InlineEditableTitle title="원본" onSave={onSave} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    const input = screen.getByTestId('issue-title-input')
    fireEvent.change(input, { target: { value: '내 제목' } })
    fireEvent.blur(input)
    expect(onSave).toHaveBeenCalledWith('내 제목')
  })

  it('[최신 제목으로 다시 쓰기] 는 입력칸을 최신 값으로, 덮어쓰기 확인은 onOverwrite 뒤 내 입력으로 저장한다', async () => {
    const calls: string[] = []
    const onSave = vi.fn(async () => {
      calls.push('save')
      return true
    })
    const onOverwrite = vi.fn(() => calls.push('overwrite'))
    renderWithProviders(
      <InlineEditableTitle title="원본" onSave={onSave} disabled={false} conflict={conflict} onTakeLatest={() => '남의 제목'} onOverwrite={onOverwrite} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    fireEvent.change(screen.getByTestId('issue-title-input'), { target: { value: '내 제목' } })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-title-take-latest'))
    expect(screen.getByTestId('issue-title-input')).toHaveValue('남의 제목')
    fireEvent.change(screen.getByTestId('issue-title-input'), { target: { value: '내 제목' } })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-title-overwrite'))
    await userEvent.click(await screen.findByRole('button', { name: '덮어쓰기' }))
    expect(onSave).toHaveBeenCalledWith('내 제목')
    expect(calls).toEqual(['overwrite', 'save'])
  })

  it('저장 성공·취소는 onEditEnd, 실패는 부르지 않고 편집을 다시 연다', async () => {
    const onEditEnd = vi.fn()
    const onSave = vi.fn(async () => false)
    renderWithProviders(<InlineEditableTitle title="원본" onSave={onSave} disabled={false} onEditEnd={onEditEnd} />)
    fireEvent.click(screen.getByRole('button', { name: '제목 편집' }))
    const input = screen.getByTestId('issue-title-input')
    fireEvent.change(input, { target: { value: '내 제목' } })
    fireEvent.blur(input)
    await screen.findByTestId('issue-title-input')
    expect(onEditEnd).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByTestId('issue-title-input'), { key: 'Escape' })
    expect(onEditEnd).toHaveBeenCalledTimes(1)
  })
})
