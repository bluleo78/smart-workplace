// 사용자 아바타의 비활성·장식 표기(WP-1160) — 비활성은 색만이 아니라 점선 테두리(모양)로도 보이고,
// 이름·상태를 글자로 함께 보이는 줄에서는 장식(decorative)으로 접근성 트리에서 빠져 스크린리더가 두 번 읽지 않는다.
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { UserAvatar } from './UserAvatar'

const user = { id: 3, username: 'kim', name: '김개발' }

describe('UserAvatar', () => {
  test('비활성이면 점선 테두리 + 접근 이름 「(비활성)」', () => {
    render(<UserAvatar user={user} inactive />)
    const el = screen.getByTestId('user-avatar-3')
    expect(el).toHaveAttribute('data-inactive', 'true')
    expect(el).toHaveClass('border-dashed')
    expect(el).toHaveAccessibleName('김개발 (비활성)')
  })

  test('활성이면 테두리 없음', () => {
    render(<UserAvatar user={user} />)
    expect(screen.getByTestId('user-avatar-3')).not.toHaveClass('border-dashed')
  })

  test('decorative 면 접근성 트리에서 빠진다(이름·상태는 옆 글자가 읽는다)', () => {
    render(<UserAvatar user={user} inactive decorative />)
    const el = screen.getByTestId('user-avatar-3')
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el).not.toHaveAttribute('aria-label')
  })
})
