import { fireEvent, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { WorkflowProblem } from '@/lib/workflows'
import { renderWithProviders } from '@/test/renderWithProviders'

import { WorkflowProblemsBadge } from './WorkflowProblemsBadge'

const err = (message: string, nodeKey: string | null = null, code = 'E'): WorkflowProblem => ({ severity: 'ERROR', code, message, line: 1, column: 1, nodeKey })
const warn = (message: string, nodeKey: string | null = null, code = 'W'): WorkflowProblem => ({ severity: 'WARNING', code, message, line: 1, column: 1, nodeKey })

function setup(over: Partial<Parameters<typeof WorkflowProblemsBadge>[0]> = {}) {
  const props = { problems: [] as WorkflowProblem[], checking: false, failed: false, onRetry: vi.fn(), onAddAskPath: vi.fn(), onOpenYaml: vi.fn(), ...over }
  const view = renderWithProviders(<WorkflowProblemsBadge {...props} />)
  return { props, view }
}

it('noProblems_rendersNothing', () => {
  // 보이는 것은 없고, 첫 오류 알림이 읽히도록 비어 있는 숨긴 상태 영역만 마운트한다
  setup()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
})

it('errorsAndWarnings_showsCounts', () => {
  setup({ problems: [err('틀림'), warn('주의 1'), warn('주의 2')] })
  const button = screen.getByRole('button', { name: '검사 결과 오류 1 · 경고 2' })
  expect(button).toHaveTextContent('오류 1 · 경고 2')
})

it('button_hasAriaHiddenAlertIcon_notInAccessibleName', () => {
  setup({ problems: [err('틀림')] })
  const button = screen.getByRole('button', { name: '검사 결과 오류 1' })
  const icon = button.querySelector('svg')
  expect(icon).not.toBeNull()
  expect(icon).toHaveAttribute('aria-hidden', 'true')
})

it('errorsOnly_omitsZeroWarning', () => {
  setup({ problems: [err('틀림')] })
  const button = screen.getByRole('button', { name: '검사 결과 오류 1' })
  expect(button).toHaveTextContent('오류 1')
  expect(button).not.toHaveTextContent('경고')
})

it('warningsOnly_showsWarningCount', () => {
  setup({ problems: [warn('주의 1'), warn('주의 2')] })
  expect(screen.getByRole('button', { name: '검사 결과 경고 2' })).toHaveTextContent('경고 2')
})

it('click_listsProblemMessages', () => {
  setup({ problems: [err('틀렸습니다.'), warn('주의하세요.', 'dev')] })
  fireEvent.click(screen.getByRole('button', { name: /검사 결과/ }))
  expect(screen.getByText('틀렸습니다.')).toBeInTheDocument()
  expect(screen.getByText(/주의하세요\./)).toBeInTheDocument()
})

it('askPathMissing_quickFix_callsOnAddAskPath', () => {
  const { props } = setup({ problems: [warn('물어볼 길이 없습니다.', 'ask1', 'ASK_PATH_MISSING')] })
  fireEvent.click(screen.getByRole('button', { name: /검사 결과/ }))
  fireEvent.click(screen.getByRole('button', { name: '질문 경로 추가' }))
  expect(props.onAddAskPath).toHaveBeenCalledWith('ask1')
  expect(screen.queryByRole('button', { name: 'YAML 오류 확인' })).not.toBeInTheDocument()
})

it('errors_offerOpenYaml', () => {
  const { props } = setup({ problems: [err('틀렸습니다.')] })
  fireEvent.click(screen.getByRole('button', { name: /검사 결과/ }))
  fireEvent.click(screen.getByRole('button', { name: 'YAML 오류 확인' }))
  expect(props.onOpenYaml).toHaveBeenCalled()
})

it('checking_keepsBadgeAndShowsPendingText', () => {
  // 검증 중에도 직전 문제 배지는 남고 옆에 「검증 중…」만 더한다
  setup({ problems: [err('틀림')], checking: true })
  expect(screen.getByText('검증 중…')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '검사 결과 오류 1' })).toBeInTheDocument()
})

it('checking_openPopoverStaysOpen', () => {
  const view = setup({ problems: [err('틀렸습니다.')] })
  fireEvent.click(screen.getByRole('button', { name: /검사 결과/ }))
  view.view.rerender(<WorkflowProblemsBadge {...view.props} checking />)
  expect(screen.getByText('틀렸습니다.')).toBeInTheDocument()
})

it('checking_withoutProblems_showsPendingTextOnly', () => {
  setup({ checking: true })
  expect(screen.getByText('검증 중…')).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('readOnly_disablesAddAskPath', () => {
  const { props } = setup({ problems: [warn('물어볼 길이 없습니다.', 'ask1', 'ASK_PATH_MISSING')], readOnly: true })
  fireEvent.click(screen.getByRole('button', { name: /검사 결과/ }))
  const add = screen.getByRole('button', { name: '질문 경로 추가' })
  expect(add).toBeDisabled()
  fireEvent.click(add)
  expect(props.onAddAskPath).not.toHaveBeenCalled()
})

it('지난 결과(stale)면 질문 경로 추가·YAML 오류 확인 단추를 끈다', () => {
  setup({ problems: [err('틀림'), warn('물어볼 길이 없습니다.', 'ask1', 'ASK_PATH_MISSING')], stale: true })
  fireEvent.click(screen.getByRole('button', { name: /검사 결과/ }))
  expect(screen.getByText('틀림')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '질문 경로 추가' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'YAML 오류 확인' })).toBeDisabled()
})

it('stale_liveRegionIsEmptyAndLabelMarksOldResult', () => {
  setup({ problems: [err('틀림')], stale: true })
  // 지난 결과를 현재 상태처럼 읽지 않게 — 숨긴 알림은 비우고 단추 이름에 지난 결과임을 적는다
  expect(screen.getAllByRole('status').every((el) => !el.textContent?.includes('오류 1'))).toBe(true)
  expect(screen.getByRole('button', { name: '검사 결과 오류 1 (지난 결과)' })).toBeInTheDocument()
})

it('failedWithoutAnnounce_hidesFailureMessage', () => {
  // YAML 보기는 검증 결과 패널이 실패 문구를 맡으므로 배지는 또 보이지 않는다
  setup({ failed: true, announce: false })
  expect(screen.queryByText(/검증 결과를 불러오지 못했습니다/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '다시 확인' })).not.toBeInTheDocument()
})

it('failed_statusOnlyOnMessageText', () => {
  setup({ failed: true })
  // 숨긴 알림 영역(빈 status)이 함께 마운트돼 있으므로 문구를 가진 status 를 찾는다
  const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('검증 결과를 불러오지 못했습니다.'))
  expect(status).toBeDefined()
  expect(status).not.toContainElement(screen.getByRole('button', { name: '다시 확인' }))
})

it('failed_offersRetry', () => {
  const { props } = setup({ failed: true })
  fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
  expect(props.onRetry).toHaveBeenCalled()
})
