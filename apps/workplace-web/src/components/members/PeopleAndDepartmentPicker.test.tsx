// 사람·조직 선택 팝오버(role=dialog) 접근 가능한 이름(WP-2067).
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import { PeopleAndDepartmentPicker } from './PeopleAndDepartmentPicker'

describe('PeopleAndDepartmentPicker', () => {
  it('열면 「사람·조직 선택」 이름의 팝오버가 보인다', async () => {
    renderScreen(
      <PeopleAndDepartmentPicker
        open
        onOpenChange={vi.fn()}
        trigger={<button type="button">추가</button>}
        existingUserIds={new Set()}
        onSelectPerson={vi.fn()}
      />,
      {
        handlers: [
          http.get('/api/v1/members', () => HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })),
          http.get('/api/v1/user-groups', () => HttpResponse.json([])),
        ],
      },
    )
    expect(await screen.findByRole('dialog', { name: '사람·조직 선택' })).toBeInTheDocument()
  })
})
