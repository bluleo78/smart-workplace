// TableEmptyRow 검색 빈 상태 아이콘 규격(WP-1947) — 40px muted, 흐린 색(/60) 금지.
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { Table, TableBody } from './table'
import { TableEmptyRow } from './table-empty'

describe('TableEmptyRow', () => {
  test('검색 빈 상태 아이콘은 40px muted 규격이다', () => {
    render(
      <Table>
        <TableBody>
          <TableEmptyRow colSpan={3} searchKeyword="없는말" />
        </TableBody>
      </Table>,
    )
    const icon = screen.getByText(/에 대한 결과가 없습니다/).closest('td')!.querySelector('svg')!
    const cls = icon.getAttribute('class') ?? ''
    expect(cls).toContain('h-10 w-10')
    expect(cls).toContain('text-muted-foreground')
    expect(cls).not.toContain('/60')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })
})
