// 위젯 설정 팝오버(role=dialog) 접근 가능한 이름(WP-2067).
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { allCatalogWidgets } from './catalogRegistry'
import { WidgetSettingsPopover } from './WidgetSettingsPopover'

describe('WidgetSettingsPopover', () => {
  it('⚙ 를 누르면 「위젯 설정」 이름의 팝오버가 열린다', async () => {
    const user = userEvent.setup()
    const catalogDef = allCatalogWidgets()[0]
    renderWithProviders(
      <WidgetSettingsPopover catalogDef={catalogDef} cfg={{ id: 'w1', type: catalogDef.type, count: 5, hidden: false }} onApply={vi.fn()}>
        <button type="button">설정 열기</button>
      </WidgetSettingsPopover>,
    )
    await user.click(screen.getByRole('button', { name: '설정 열기' }))
    expect(await screen.findByRole('dialog', { name: '위젯 설정' })).toBeInTheDocument()
  })
})
