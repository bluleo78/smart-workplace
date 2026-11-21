// API 토큰 발급 입력 대화상자 — 발급 실패 안내가 role=alert 로 읽히고 이름 칸과 이어지는지 본다(WP-1901).
import { screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import { TokenIssueFormDialog } from './TokenIssueFormDialog'

describe('TokenIssueFormDialog 실패 안내 (WP-1901)', () => {
  test('발급 실패 안내는 alert 로 읽히고 id·data-testid 를 유지하며 이름 칸이 가리킨다', async () => {
    const { user } = renderScreen(
      <TokenIssueFormDialog
        open
        onOpenChange={() => {}}
        isPending={false}
        onSubmit={() => Promise.reject(new Error('boom'))}
      />,
    )
    await user.type(await screen.findByLabelText(/토큰 이름/), '내 토큰')
    await user.click(screen.getByTestId('token-issue-submit'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('토큰 발급에 실패했습니다.')
    expect(alert).toHaveAttribute('id', 'token-issue-error')
    expect(alert).toBe(screen.getByTestId('token-issue-error'))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByLabelText(/토큰 이름/).getAttribute('aria-describedby')).toContain('token-issue-error')
  })
})
