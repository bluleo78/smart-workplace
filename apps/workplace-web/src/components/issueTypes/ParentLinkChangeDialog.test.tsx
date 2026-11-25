// 「상위 연결 변경」 확인 창(WP-2097) — 지금 상위 표시, 에픽 유무에 따른 선택지, 관련 관계 유지 기본값,
// 「유형 변경」·「취소」·Esc 판정을 그린다. 창은 서버 요청 전에 뜨고(서버 미리보기 없음), 닫으면 아무것도 보내지 않는다.
import { screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import { type ParentLinkChangeChoice, ParentLinkChangeDialog } from './ParentLinkChangeDialog'

/** 지금 상위가 에픽 아래에 있는 하위 태스크의 부모(스토리) 기본값. */
const currentParent = { key: 'WP-3', title: '로그인 개선', typeName: 'SUBTASK' }

/** 제어형 창 하네스 — 열림 상태를 테스트가 들고 있어 닫힘을 그대로 단언한다. */
function Harness({
  epic,
  onConfirm,
  parent = currentParent,
}: {
  epic: { key: string; title: string } | null
  onConfirm: (p: ParentLinkChangeChoice) => void
  parent?: { key: string; title: string; typeName: string }
}) {
  const [open, setOpen] = useState(true)
  return (
    <ParentLinkChangeDialog
      open={open}
      onOpenChange={setOpen}
      currentParent={parent}
      epic={epic}
      onConfirm={onConfirm}
      onCancel={() => setOpen(false)}
    />
  )
}

test('「지금 상위」 칸에 부모 유형·키·제목이 보인다', async () => {
  renderScreen(<Harness epic={{ key: 'WP-9', title: '기능 에픽' }} onConfirm={vi.fn()} />)
  const dialog = await screen.findByRole('alertdialog')
  const current = within(dialog).getByTestId('parent-link-current')
  // 부모는 하위 태스크 아래 스토리 — 배지 이름(한국어 라벨)·키·제목이 한 칸에 다 보인다.
  expect(current).toHaveTextContent('하위 태스크')
  expect(current).toHaveTextContent('WP-3')
  expect(current).toHaveTextContent('로그인 개선')
})

test('에픽 아래면 라디오가 두 개인데 「상위의 에픽 아래로 이동」이 기본이고 「관련 관계 유지」도 켜 있다', async () => {
  renderScreen(<Harness epic={{ key: 'WP-9', title: '기능 에픽' }} onConfirm={vi.fn()} />)
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getAllByRole('radio')).toHaveLength(2)
  const move = screen.getByRole('radio', { name: /상위의 에픽 아래로 이동/ })
  expect(move).toBeChecked()
  // 이동 선택지 라벨에 그 에픽의 유형·키·제목이 실린다(완료 기준 2) — 라디오 단추와 연결된 label 을 본다.
  const moveLabel = screen.getByText('상위의 에픽 아래로 이동').closest('label')
  expect(moveLabel).not.toBeNull()
  expect(moveLabel).toHaveTextContent('에픽')
  expect(moveLabel).toHaveTextContent('WP-9')
  expect(moveLabel).toHaveTextContent('기능 에픽')
  expect(screen.getByRole('radio', { name: /상위 없이 변경/ })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: '관련 관계 유지' })).toBeChecked()
})

test('에픽 아래가 아니면 「상위 없이 변경」만 보인다', async () => {
  renderScreen(<Harness epic={null} onConfirm={vi.fn()} />)
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getAllByRole('radio')).toHaveLength(1)
  expect(screen.queryByRole('radio', { name: /상위의 에픽 아래로 이동/ })).toBeNull()
  expect(screen.getByRole('radio', { name: /상위 없이 변경/ })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '관련 관계 유지' })).toBeChecked()
})

test('「유형 변경」을 누르면 기본 선택(에픽 아래 이동 + 관련 관계 유지)으로 확인이 불린다', async () => {
  const onConfirm = vi.fn()
  const { user } = renderScreen(<Harness epic={{ key: 'WP-9', title: '기능 에픽' }} onConfirm={onConfirm} />)
  await screen.findByRole('alertdialog')
  await user.click(screen.getByTestId('parent-link-confirm'))
  expect(onConfirm).toHaveBeenCalledWith({ moveToEpic: true, relateToReleasedParent: true })
})

test('「상위 없이 변경」과 체크 해제를 고르면 확인 값이 그대로 반영된다', async () => {
  const onConfirm = vi.fn()
  const { user } = renderScreen(<Harness epic={{ key: 'WP-9', title: '기능 에픽' }} onConfirm={onConfirm} />)
  await screen.findByRole('alertdialog')
  await user.click(screen.getByRole('radio', { name: /상위 없이 변경/ }))
  await user.click(screen.getByRole('checkbox', { name: '관련 관계 유지' }))
  await user.click(screen.getByTestId('parent-link-confirm'))
  expect(onConfirm).toHaveBeenCalledWith({ moveToEpic: false, relateToReleasedParent: false })
})

test('「취소」를 누르면 확인 없이 창이 닫힌다', async () => {
  const onConfirm = vi.fn()
  const { user } = renderScreen(<Harness epic={{ key: 'WP-9', title: '기능 에픽' }} onConfirm={onConfirm} />)
  await screen.findByRole('alertdialog')
  await user.click(screen.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(onConfirm).not.toHaveBeenCalled()
})

test('Esc 를 누르면 확인 없이 창이 닫힌다', async () => {
  const onConfirm = vi.fn()
  const { user } = renderScreen(<Harness epic={{ key: 'WP-9', title: '기능 에픽' }} onConfirm={onConfirm} />)
  await screen.findByRole('alertdialog')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(onConfirm).not.toHaveBeenCalled()
})
