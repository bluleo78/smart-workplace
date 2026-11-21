import { render } from '@testing-library/react'
import { Inbox } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('desktopDefault: 데스크톱 규격 클래스·aria-hidden·바깥 클래스·testid', () => {
    const { container, getByText } = render(
      <EmptyState icon={Inbox} title="제목" description="설명" className="py-4" testId="es" />,
    )
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('class')).toContain('h-10 w-10 text-muted-foreground')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(getByText('제목').tagName).toBe('P')
    expect(getByText('제목').className).toContain('text-sm font-medium')
    expect(getByText('설명').tagName).toBe('P')
    expect(getByText('설명').className).toContain('text-xs text-muted-foreground')
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('flex flex-col items-center text-center')
    expect(root.className).toContain('py-4')
    expect(root.getAttribute('data-testid')).toBe('es')
  })

  it('mobileSize: 모바일 규격 클래스', () => {
    const { container, getByText } = render(
      <EmptyState size="mobile" icon={Inbox} title="제목" description="설명" />,
    )
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('h-12 w-12 text-muted-foreground')
    expect(getByText('제목').className).toContain('text-[17px] font-semibold')
    expect(getByText('설명').className).toContain('text-sm text-muted-foreground')
  })

  it('positiveTone: 아이콘만 primary', () => {
    const { container } = render(<EmptyState tone="positive" icon={Inbox} title="제목" />)
    const cls = container.querySelector('svg')!.getAttribute('class')!
    expect(cls).toContain('text-primary')
    expect(cls).not.toContain('text-muted-foreground')
  })

  it('noIconNoDescription: svg 없고 p 는 제목 하나', () => {
    const { container } = render(<EmptyState title="제목" />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })

  it('grouped: 제목·설명을 묶고 action 은 묶음 밖', () => {
    const { getByText, getByTestId } = render(
      <EmptyState
        grouped
        textRole="status"
        textClassName="max-w-full"
        title="제목"
        description="설명"
        action={<a data-testid="cta">go</a>}
      />,
    )
    const group = getByText('제목').parentElement!
    expect(group.className).toContain('space-y-1')
    expect(group.className).toContain('max-w-full')
    expect(group.getAttribute('role')).toBe('status')
    expect(getByText('설명').parentElement).toBe(group)
    expect(group.contains(getByTestId('cta'))).toBe(false)
  })

  it('titleAsDiv: 제목 태그 DIV + titleClassName', () => {
    const { getByText } = render(<EmptyState titleAs="div" titleClassName="mt-1" title="제목" />)
    expect(getByText('제목').tagName).toBe('DIV')
    expect(getByText('제목').className).toContain('mt-1')
    expect(getByText('제목').className).toContain('text-sm font-medium')
  })

  it('descriptionAsDiv: 설명 태그 DIV', () => {
    const { getByText } = render(<EmptyState descriptionAs="div" title="제목" description="설명" />)
    expect(getByText('설명').tagName).toBe('DIV')
    expect(getByText('설명').className).toContain('text-xs text-muted-foreground')
  })
})
