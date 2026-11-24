// 도움말 ⌄ 목록 팝오버(role=dialog) 접근 가능한 이름(WP-2067).
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { HelpIndexChapter } from './helpBundle'
import { HelpSectionMenu } from './HelpSectionMenu'

const chapter: HelpIndexChapter = {
  chapter: 'agents',
  number: 1,
  title: '에이전트',
  routes: [],
  audience: ['member'],
  sections: [{ id: 'agents.intro', label: '소개', title: '소개', parent: null, level: 1 }],
}

describe('HelpSectionMenu', () => {
  it('⌄ 를 누르면 「이 화면 도움말 목록」 이름의 팝오버가 열린다', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <HelpSectionMenu chapter={chapter} currentId="agents.intro" related={[]} onSelect={vi.fn()}>
        {(trigger) => <div>{trigger}</div>}
      </HelpSectionMenu>,
    )
    await user.click(screen.getByTestId('help-section-menu-toggle'))
    expect(await screen.findByRole('dialog', { name: '이 화면 도움말 목록' })).toBeInTheDocument()
  })
})
