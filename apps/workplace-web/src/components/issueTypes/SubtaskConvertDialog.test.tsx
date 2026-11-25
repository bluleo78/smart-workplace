// 「하위 태스크 N개 유형 변경」 확인 창(WP-2098) — 제목·목록·기본 유형·상위 안내·확인/취소 판정.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'

import { convertTargetTypes } from '@/lib/issueTypeSubtaskConvert'
import { renderScreen } from '@/test/renderScreen'

import { createIssue } from '../../../e2e/factories/issue.factory'
import { makeSubtaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { type SubtaskConvertChoice, SubtaskConvertDialog } from './SubtaskConvertDialog'

const subtasks = [1, 2, 3].map((n) =>
  createIssue({ id: n, projectKey: 'WP', number: n + 10, title: `하위 ${n}`, type: makeSubtaskType() }),
)
const parent = { key: 'EP-1', title: '상위 에픽', typeName: 'STORY' }

function Harness({
  currentParent = parent,
  onConfirm = vi.fn(),
  onCancel,
  pending,
}: {
  currentParent?: typeof parent | null
  onConfirm?: (c: SubtaskConvertChoice) => void
  onCancel?: () => void
  pending?: boolean
}) {
  const [open, setOpen] = useState(true)
  return (
    <SubtaskConvertDialog
      open={open}
      onOpenChange={setOpen}
      subtasks={subtasks}
      targetTypes={convertTargetTypes(systemTypes())}
      currentParent={currentParent}
      onConfirm={onConfirm}
      onCancel={() => {
        onCancel?.()
        setOpen(false)
      }}
      pending={pending}
    />
  )
}

test('제목에 개수가 있고 항목마다 키·제목·유형 배지가 보이며 목록은 세로 스크롤이다', async () => {
  renderScreen(<Harness />)
  const dialog = await screen.findByTestId('subtask-convert-dialog')
  expect(dialog).toHaveTextContent('하위 태스크 3개 유형 변경')
  const list = screen.getByTestId('subtask-convert-list')
  expect(list.className).toMatch(/max-h-/)
  expect(list.className).toMatch(/overflow-y-auto/)
  const item = screen.getByTestId('subtask-convert-item-WP-11')
  expect(item).toHaveTextContent('WP-11')
  expect(item).toHaveTextContent('하위 1')
  expect(item).toHaveTextContent('하위 태스크')
  expect(within(list).getAllByRole('listitem')).toHaveLength(3)
})

test('기본은 TASK 이고 BUG 를 고르면 그 id 와 관계 유지(기본 켬)로 확인한다', async () => {
  const onConfirm = vi.fn()
  renderScreen(<Harness onConfirm={onConfirm} />)
  await screen.findByTestId('subtask-convert-dialog')
  expect(screen.getByTestId('subtask-convert-type-1')).toBeChecked()
  await userEvent.click(screen.getByTestId('subtask-convert-type-2'))
  await userEvent.click(screen.getByTestId('subtask-convert-confirm'))
  expect(onConfirm).toHaveBeenCalledWith({ convertSubtasksToTypeId: 2, relateToReleasedParent: true })
})

test('상위가 있으면 안내와 「관련 관계 유지」가 있고 끄면 false 로 확인한다', async () => {
  const onConfirm = vi.fn()
  renderScreen(<Harness onConfirm={onConfirm} />)
  await screen.findByTestId('subtask-convert-dialog')
  expect(screen.getByTestId('subtask-convert-parent-notice')).toHaveTextContent(
    '에픽은 상위를 둘 수 없어 지금 상위 EP-1 에서 빠집니다',
  )
  const relate = screen.getByRole('checkbox', { name: '관련 관계 유지' })
  expect(relate).toBeChecked()
  await userEvent.click(relate)
  await userEvent.click(screen.getByTestId('subtask-convert-confirm'))
  expect(onConfirm).toHaveBeenCalledWith({ convertSubtasksToTypeId: 1, relateToReleasedParent: false })
})

test('상위가 없으면 안내도 체크도 없다', async () => {
  renderScreen(<Harness currentParent={null} />)
  await screen.findByTestId('subtask-convert-dialog')
  expect(screen.queryByTestId('subtask-convert-parent-notice')).toBeNull()
  expect(screen.queryByRole('checkbox', { name: '관련 관계 유지' })).toBeNull()
})

test('「취소」와 Esc 는 onCancel 만 부르고 확인하지 않는다', async () => {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  renderScreen(<Harness onCancel={onCancel} onConfirm={onConfirm} />)
  await screen.findByTestId('subtask-convert-dialog')
  await userEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onConfirm).not.toHaveBeenCalled()
})

test('Esc 로 닫히면 확인 없이 창이 사라진다', async () => {
  const onConfirm = vi.fn()
  renderScreen(<Harness onConfirm={onConfirm} />)
  await screen.findByTestId('subtask-convert-dialog')
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('subtask-convert-dialog')).toBeNull())
  expect(onConfirm).not.toHaveBeenCalled()
})

test('pending 이면 「모두 변경」이 꺼진다', async () => {
  renderScreen(<Harness pending />)
  await screen.findByTestId('subtask-convert-dialog')
  expect(screen.getByTestId('subtask-convert-confirm')).toBeDisabled()
})
