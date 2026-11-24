// PersonalTaskDeleteAction 컴포넌트 테스트(WP-2036 후속) — 확인창이 열린 채 권한이 사라져도 언마운트되지 않는다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PersonalTaskDeleteAction } from './PersonalTaskDeleteAction'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function ui(canDelete: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <PersonalTaskDeleteAction projectKey="P" number={1} title="세금 신고" childCount={0} canDelete={canDelete} variant="desktop" onDeleted={() => {}} />
    </QueryClientProvider>
  )
}

describe('PersonalTaskDeleteAction', () => {
  it('확인창을 연 채 canDelete 가 false 가 돼도 확인창은 남고, 닫으면 단추도 없다', async () => {
    const user = userEvent.setup()
    const { rerender } = render(ui(true))
    await user.click(screen.getByTestId('personal-task-delete'))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()

    rerender(ui(false))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.queryByTestId('personal-task-delete')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.queryByTestId('personal-task-delete')).not.toBeInTheDocument()
  })
})
