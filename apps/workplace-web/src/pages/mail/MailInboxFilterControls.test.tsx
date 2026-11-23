// MailInboxFilterControls 테스트 (WP-1864) — 아이콘만 있던 동기화 단추가 hover·focus 툴팁으로
// 「지금 새로고침」임을 알리고, 접근 이름·비활성(busy) 중에도 툴팁이 남는지 확인한다.
// 자체 TooltipProvider 가 컴포넌트 안에 있어 renderWithProviders 는 쓰지 않는다.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { MailSyncControls } from './MailInboxFilterControls'

test('동기화 단추는 접근 이름을 유지하고 hover 시 「지금 새로고침」 툴팁을 보인다', async () => {
  const user = userEvent.setup()
  render(<MailSyncControls onSync={vi.fn()} busy={false} lastSyncedAt={null} progress={null} />)
  const btn = screen.getByRole('button', { name: '지금 새로고침' }) // 트리거·툴팁을 거쳐도 접근 이름은 그대로
  await user.hover(btn)
  expect(await screen.findByRole('tooltip')).toHaveTextContent('지금 새로고침')
})

test('키보드 포커스 때도 툴팁이 뜬다', async () => {
  render(<MailSyncControls onSync={vi.fn()} busy={false} lastSyncedAt={null} progress={null} />)
  screen.getByRole('button', { name: '지금 새로고침' }).focus()
  expect(await screen.findByRole('tooltip')).toHaveTextContent('지금 새로고침')
})

test('동기화 중(busy)에도 툴팁이 뜬다', async () => {
  const user = userEvent.setup()
  render(<MailSyncControls onSync={vi.fn()} busy={true} lastSyncedAt={null} progress={null} />)
  const btn = screen.getByRole('button', { name: '지금 새로고침' })
  await user.hover(btn)
  expect(await screen.findByRole('tooltip')).toHaveTextContent('지금 새로고침')
})
