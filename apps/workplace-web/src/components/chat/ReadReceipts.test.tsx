import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelReadState } from '@/types/messaging'

import { ReadReceipts } from './ReadReceipts'

// 터치 화면 여부 — 마우스(얼굴마다 툴팁)와 터치(줄 전체 팝오버)를 나눠 본다.
const coarse = vi.hoisted(() => ({ value: false }))
vi.mock('@/hooks/useIsCoarsePointer', () => ({ useIsCoarsePointer: () => coarse.value }))

// DM 읽음 표시(WP-1176) — 3명까지 얼굴, 넘치면 「+N」, 누르면 이름·읽은 시각.
const reader = (userId: number, readAt: string | null = null): ChannelReadState => ({
  userId,
  name: `사람${userId}`,
  lastReadMessageId: 10,
  readAt,
})

describe('ReadReceipts', () => {
  beforeEach(() => {
    coarse.value = false
  })

  it('3명까지 얼굴을 보이고 나머지는 「+N」으로 줄인다', () => {
    render(<ReadReceipts readers={[reader(2), reader(3), reader(4), reader(5), reader(6)]} />)
    expect(screen.getByTestId('read-receipt-2')).toBeInTheDocument()
    expect(screen.getByTestId('read-receipt-4')).toBeInTheDocument()
    expect(screen.queryByTestId('read-receipt-5')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '그 밖에 2명 읽음' })).toHaveTextContent('+2')
  })

  it('터치 화면은 줄 전체가 누를 자리 하나 — 누르면 읽은 사람 모두의 이름·시각, 스크린리더 이름에도 시각이 담긴다', async () => {
    coarse.value = true
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-29T05:00:00Z'))
    render(<ReadReceipts readers={[reader(2, '2026-10-29T03:47:00Z'), reader(3), reader(4), reader(5)]} />)
    expect(screen.getByRole('img', { name: '사람2 오후 12:47에 읽음' })).toBeInTheDocument()
    // 얼굴마다 따로 누르는 자리를 두지 않는다(16px 얼굴이 붙어 있어 옆 사람을 잘못 누르게 된다).
    expect(screen.queryByTestId('read-receipt-2')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await userEvent.click(screen.getByTestId('read-receipts-trigger'))
    expect(await screen.findByText('오후 12:47에 읽음')).toBeVisible()
    // 「+1」로 줄인 사람까지 목록에 보인다.
    expect(screen.getByText('사람5')).toBeVisible()
    vi.useRealTimers()
  })

  it('읽은 사람이 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<ReadReceipts readers={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
