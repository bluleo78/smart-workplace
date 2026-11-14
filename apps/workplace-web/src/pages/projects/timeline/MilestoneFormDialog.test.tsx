// 마일스톤 창 마감일 필수 표시(WP-1556) — 서버가 마감일을 요구하니 왜 저장이 안 되는지 화면에 알린다.
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { MilestoneResponse } from '@/types/milestone'

import { MilestoneFormDialog } from './MilestoneFormDialog'

const REQUIRED = 'milestone-due-date-required'

/** 기존 마일스톤(수정 모드) — 필요한 필드만 채워 타입에 맞춘다. */
const existing = { id: 1, name: 'M0', dueDate: '2026-12-01' } as MilestoneResponse

function renderDialog(props: { milestone?: MilestoneResponse; defaultDueDate?: string } = {}) {
  return renderScreen(<MilestoneFormDialog projectKey="WP" open onOpenChange={() => {}} {...props} />)
}

describe('MilestoneFormDialog — 마감일 필수 표시', () => {
  test('생성 모드에서 마감일이 비면 안내가 보이고 저장이 비활성', async () => {
    renderDialog()
    fireEvent.change(await screen.findByTestId('milestone-name-input'), { target: { value: 'M1' } })
    expect(screen.getByTestId(REQUIRED)).toHaveTextContent('마감일을 입력해 주세요')
    expect(screen.getByTestId('milestone-submit')).toBeDisabled()
    // 라벨(* 포함)이 날짜 칸과 연결되고, 안내 문구는 날짜 칸의 설명으로 읽힌다
    const date = screen.getByTestId('milestone-due-date-input')
    const label = screen.getByText('마감일', { selector: 'label' })
    expect(label).toHaveTextContent('마감일 *')
    expect(label).toHaveAttribute('for', date.id)
    expect(date).toHaveAccessibleDescription('마감일을 입력해 주세요')
    // 이름은 라벨에서 온다 — * 는 aria-hidden 이라 접근 이름에 들어가지 않는다
    expect(date).toHaveAccessibleName('마감일')
    expect(date).toBeRequired()
  })

  test('마감일을 넣으면 안내가 사라지고 저장이 켜지며, 지우면 다시 돌아온다', async () => {
    renderDialog()
    fireEvent.change(await screen.findByTestId('milestone-name-input'), { target: { value: 'M1' } })
    const date = screen.getByTestId('milestone-due-date-input')
    fireEvent.change(date, { target: { value: '2026-12-01' } })
    expect(screen.queryByTestId(REQUIRED)).not.toBeInTheDocument()
    expect(date).not.toHaveAttribute('aria-describedby')
    expect(screen.getByTestId('milestone-submit')).toBeEnabled()
    fireEvent.change(date, { target: { value: '' } })
    expect(screen.getByTestId(REQUIRED)).toBeInTheDocument()
    expect(screen.getByTestId('milestone-submit')).toBeDisabled()
  })

  test('수정 모드·날짜 프리필에서는 안내가 없다', async () => {
    // 수정·프리필 창은 값이 채워진 채 열린다(폼이 열릴 때 마운트되며 받은 값으로 시작)
    const edit = renderDialog({ milestone: existing })
    expect(screen.getByTestId('milestone-due-date-input')).toHaveValue('2026-12-01')
    expect(screen.queryByTestId(REQUIRED)).not.toBeInTheDocument()
    edit.unmount()
    renderDialog({ defaultDueDate: '2026-12-01' })
    expect(screen.getByTestId('milestone-due-date-input')).toHaveValue('2026-12-01')
    expect(screen.queryByTestId(REQUIRED)).not.toBeInTheDocument()
  })
})
