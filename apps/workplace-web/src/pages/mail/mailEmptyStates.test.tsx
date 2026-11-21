// 메일 빈 상태 규격(WP-1939) — 임시보관함·예약됨 상세 빈 칸이 디자인 시스템 규격 상수(40px muted 아이콘·14px/500 제목)를 쓰는지 본다.
import { screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { MailDraftsDetailEmpty } from './MailDraftsList'
import { MailScheduledDetailEmpty } from './MailScheduledList'

test.each([
  ['mail-drafts-detail-empty', <MailDraftsDetailEmpty key="d" />, '임시저장한 메일을 고르세요'],
  ['mail-scheduled-detail-empty', <MailScheduledDetailEmpty key="s" />, '예약한 메일 선택'],
])('%s — 아이콘은 규격 muted 40px(흐린 /50 아님), 제목은 text-sm font-medium', (testId, ui, title) => {
  renderWithProviders(ui)
  const icon = screen.getByTestId(testId).querySelector('svg')
  expect(icon).not.toBeNull()
  expect(icon).toHaveClass('h-10', 'w-10', 'text-muted-foreground')
  expect(icon!.getAttribute('class')).not.toContain('/50')
  expect(icon).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByText(title)).toHaveClass('text-sm', 'font-medium')
})
