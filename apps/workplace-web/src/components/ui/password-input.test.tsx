// 비밀번호 칸 PasswordInput 의 보기/숨기기 토글(WP-1426) — 버튼에서 Enter·Space 로 type 이 password↔text 로 바뀌고
// 이름(「… 보기」↔「… 숨기기」)이 따라 바뀌는지, 비활성 칸이면 버튼도 막히는지, id 를 준 칸이면 aria-controls 로 이어지는지 본다.
// Tab 순서(칸 → 보기 버튼 → 다음 요소)는 실제 브라우저 키보드 탐색이라 E2E(e2e/pages/auth/login-password-toggle.spec.ts, @input)가 지킨다.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { PasswordInput } from './password-input'

/** 보기 버튼에 포커스를 둔 채로 띄운다 — 키 입력은 포커스된 버튼에 들어간다. */
function renderFocused() {
  render(<PasswordInput id="pw" aria-label="비밀번호" />)
  const input = screen.getByLabelText('비밀번호') as HTMLInputElement
  screen.getByRole('button', { name: '비밀번호 보기' }).focus()
  return { user: userEvent.setup(), input }
}

describe('PasswordInput 보기/숨기기 토글 (WP-1426)', () => {
  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('%s 로 보이기·숨기기가 바뀌고 이름이 따라 바뀐다', async (_name, key) => {
    const { user, input } = renderFocused()
    expect(input).toHaveAttribute('type', 'password')
    await user.keyboard(key)
    expect(input).toHaveAttribute('type', 'text')
    // 같은 버튼이 포커스를 지킨 채 이름만 「숨기기」로 바뀐다 — 다시 누르면 감춘다.
    const hide = screen.getByRole('button', { name: '비밀번호 숨기기' })
    expect(hide).toHaveFocus()
    // 이름이 상태를 알리므로 aria-pressed 는 두지 않는다(상태를 두 번 읽지 않게).
    expect(hide).not.toHaveAttribute('aria-pressed')
    await user.keyboard(key)
    expect(input).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: '비밀번호 보기' })).toHaveFocus()
  })

  it('비활성 칸이면 보기 버튼도 비활성이라 비밀번호를 드러내지 못한다', async () => {
    render(<PasswordInput aria-label="비밀번호" disabled />)
    const button = screen.getByRole('button', { name: '비밀번호 보기' })
    expect(button).toBeDisabled()
    await userEvent.setup().click(button)
    expect(screen.getByLabelText('비밀번호')).toHaveAttribute('type', 'password')
  })

  it('id 를 준 칸이면 보기 버튼이 aria-controls 로 그 칸을 가리키고, 없으면 두지 않는다', () => {
    const { unmount } = render(<PasswordInput id="pw" aria-label="비밀번호" />)
    expect(screen.getByRole('button', { name: '비밀번호 보기' })).toHaveAttribute('aria-controls', 'pw')
    unmount()
    render(<PasswordInput aria-label="비밀번호" />)
    expect(screen.getByRole('button', { name: '비밀번호 보기' })).not.toHaveAttribute('aria-controls')
  })
})
