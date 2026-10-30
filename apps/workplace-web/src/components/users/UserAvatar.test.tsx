// 사용자 아바타의 비활성·장식 표기(WP-1160)·프로필 이미지(WP-1222) — 비활성은 색만이 아니라 점선 테두리(모양)로도 보이고,
// 이름·상태를 글자로 함께 보이는 줄에서는 장식(decorative)으로 접근성 트리에서 빠져 스크린리더가 두 번 읽지 않는다.
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, test } from 'vitest'

import { ChatAvatar } from '@/components/chat/ChatAvatar'
import { AvatarMapContext } from '@/hooks/avatar-map-context'

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

// WP-1222 — 아바타 주소 표에 사용자가 있으면 같은 상자 안에 이미지를 덮고(크기는 2배 규칙), 없거나 실패하면 이니셜 그대로.
// UserAvatar·ChatAvatar 가 같은 AvatarPicture 경로를 쓴다.
describe('아바타 이미지 (WP-1222)', () => {
  const withMap = (ui: ReactElement, entries: [number, string][]) =>
    render(<AvatarMapContext value={new Map(entries)}>{ui}</AvatarMapContext>)

  test('표에 있으면 이미지 — alt 이름, 지연 로드, 표시 크기의 2배 이상인 벌', () => {
    withMap(<UserAvatar user={user} size="lg" />, [[3, '/api/v1/avatars/3/h1']])
    const img = within(screen.getByTestId('user-avatar-3')).getByRole('img', { name: '김개발' })
    // lg = 36px → 2배 72 → 128 벌.
    expect(img).toHaveAttribute('src', '/api/v1/avatars/3/h1/128')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('decoding', 'async')
    expect(img).toHaveClass('object-cover', 'rounded-full')
  })

  test('표에 없으면 이니셜만', () => {
    withMap(<UserAvatar user={user} />, [[99, '/api/v1/avatars/99/h']])
    const el = screen.getByTestId('user-avatar-3')
    expect(el.querySelector('img')).toBeNull()
    expect(el).toHaveTextContent('김')
  })

  test('이미지가 실패하면 이니셜로 돌아간다', () => {
    withMap(<UserAvatar user={user} />, [[3, '/api/v1/avatars/3/h1']])
    const el = screen.getByTestId('user-avatar-3')
    fireEvent.error(el.querySelector('img')!)
    expect(el.querySelector('img')).toBeNull()
    expect(el).toHaveTextContent('김')
  })

  test('불러오기 전엔 투명, 다 받으면 보이고 이니셜은 낭독에서 빠진다', () => {
    withMap(<UserAvatar user={user} />, [[3, '/api/v1/avatars/3/h1']])
    const img = screen.getByTestId('user-avatar-3').querySelector('img')!
    expect(img).toHaveClass('opacity-0')
    fireEvent.load(img)
    expect(img).not.toHaveClass('opacity-0')
    expect(screen.getByText('김').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  test('AI 표식(링·Bot 마커)은 이미지와 함께 남는다', () => {
    withMap(<UserAvatar user={user} agent />, [[3, '/api/v1/avatars/3/h1']])
    const el = screen.getByTestId('user-avatar-3')
    expect(el.querySelector('img')).not.toBeNull()
    expect(el).toHaveClass('ring-ai-accent')
    expect(screen.getByTestId('user-avatar-3-agent-marker')).toBeInTheDocument()
  })

  test('ChatAvatar 도 같은 표에서 찾는다(64px 벌) — AI 배지는 그대로', () => {
    withMap(<ChatAvatar userId={5} name="봇" kind="AGENT" />, [[5, '/api/v1/avatars/5/h5']])
    const el = screen.getByTestId('chat-avatar-5')
    expect(el.querySelector('img')).toHaveAttribute('src', '/api/v1/avatars/5/h5/64')
    expect(screen.getByTestId('chat-avatar-agent-5')).toBeInTheDocument()
  })
})
