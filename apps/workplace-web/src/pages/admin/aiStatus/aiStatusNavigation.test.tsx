// 「AI 현황」 사이드바 항목(WP-1824) — 관리자에게만 보이고 /settings/ai-status 로 이어지는지 본다.
import { screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'

import { SettingsSidebar } from '@/components/layout/SettingsSidebar'
import { renderScreen } from '@/test/renderScreen'

test('관리자는 사이드바에서 「AI 현황」 을 에이전트 바로 아래에서 보고 /settings/ai-status 로 간다', async () => {
  renderScreen(<SettingsSidebar />, { path: '/settings/users', auth: { isAdmin: true } })
  const group = await screen.findByTestId('settings-admin-group')
  const labels = within(group).getAllByRole('link').map((link) => link.textContent?.trim())
  expect(labels.indexOf('AI 현황')).toBe(labels.indexOf('에이전트') + 1)
  expect(within(group).getByRole('link', { name: 'AI 현황' })).toHaveAttribute('href', '/settings/ai-status')
})

test('일반 구성원에게는 「AI 현황」 이 보이지 않는다', () => {
  renderScreen(<SettingsSidebar />, { path: '/settings/profile', auth: { isAdmin: false } })
  expect(screen.queryByRole('link', { name: 'AI 현황' })).not.toBeInTheDocument()
})
