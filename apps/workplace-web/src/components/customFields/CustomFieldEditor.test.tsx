// 커스텀 필드 위젯 편집 권한 분기(WP-503) — 서버는 멤버만 값 저장을 허용한다. 비멤버(disabled)에겐 값은 보이되 모든 유형의
// 입력이 꺼지고, 날짜 지우기 버튼도 그리지 않는다. 화면 배선은 E2E(open-issue-permissions)가 맡는다(WP-413).
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { IssueFieldDef } from '../../types/customField'
import { CustomFieldEditor } from './CustomFieldEditor'

const def = (id: number, type: IssueFieldDef['type'], options?: string[]) =>
  ({ id, name: `필드${id}`, type, options }) as IssueFieldDef

const cases: { d: IssueFieldDef; value: unknown }[] = [
  { d: def(1, 'TEXT'), value: '메모' },
  { d: def(2, 'NUMBER'), value: 3 },
  { d: def(3, 'DATE'), value: '2026-10-20' },
  { d: def(4, 'SELECT', ['A', 'B']), value: 'A' },
]

describe('CustomFieldEditor — 편집 권한', () => {
  it.each(cases)('편집 불가면 $d.type 입력이 꺼진다', ({ d, value }) => {
    renderWithProviders(<CustomFieldEditor def={d} value={value} onChange={vi.fn()} disabled />)
    expect(screen.getByTestId(`field-input-${d.id}`)).toBeDisabled()
  })

  it('편집 불가면 MULTI_SELECT 옵션 버튼이 모두 꺼진다', () => {
    const d = def(5, 'MULTI_SELECT', ['A', 'B'])
    renderWithProviders(<CustomFieldEditor def={d} value={['A']} onChange={vi.fn()} disabled />)
    for (const b of within(screen.getByTestId('field-input-5')).getAllByRole('button')) expect(b).toBeDisabled()
  })

  it('편집 불가면 날짜 값이 있어도 지우기 버튼이 없고, 편집 가능하면 있다', () => {
    const d = def(3, 'DATE')
    const { unmount } = renderWithProviders(<CustomFieldEditor def={d} value="2026-10-20" onChange={vi.fn()} disabled />)
    expect(screen.queryByTestId('field-input-3-clear')).not.toBeInTheDocument()
    unmount()
    renderWithProviders(<CustomFieldEditor def={d} value="2026-10-20" onChange={vi.fn()} />)
    expect(screen.getByTestId('field-input-3-clear')).toBeEnabled()
    expect(screen.getByTestId('field-input-3')).toBeEnabled()
  })
})

// WP-2058: 날짜 필드 달력 팝오버(role=dialog)는 필드 이름으로 읽혀야 한다 — 이름이 없으면 스크린리더가 「dialog」 로만 읽는다.
describe('CustomFieldEditor — 날짜 팝오버 이름', () => {
  it('dateField_open_dialogHasAccessibleName', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CustomFieldEditor def={def(3, 'DATE')} value={null} onChange={vi.fn()} />)
    await user.click(screen.getByTestId('field-input-3'))
    expect(await screen.findByRole('dialog', { name: '필드3 선택' })).toBeInTheDocument()
  })
})
