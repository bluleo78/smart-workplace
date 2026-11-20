// AlertList — 빈 목록, 수준 글자·아이콘, action.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AlertList } from './AlertList'

describe('AlertList', () => {
  it('비면 「이상 없음」', () => {
    render(<AlertList items={[]} />)
    expect(screen.getByText('이상 없음')).toBeInTheDocument()
  })

  it('수준 글자·아이콘·action 을 그린다', () => {
    render(<AlertList items={[{ id: 'a', level: 'danger', label: '서버 다운', action: <button type="button">보기</button> }]} />)
    const list = screen.getByRole('list')
    expect(list).toBeInTheDocument()
    expect(screen.getByText('위험')).toBeInTheDocument()
    expect(list.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('서버 다운')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '보기' })).toBeInTheDocument()
  })
})
