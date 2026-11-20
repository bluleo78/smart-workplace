// 외부 링크 한 줄(WP-1871) — 같은 이슈에 외부 링크가 여럿이어도 연필·× 단추의 접근 가능한 이름이 서로 달라야 한다.
// 실제 호버·기하는 보지 않는다(이름·호출만 판정).
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { createExternalLink } from '../../../e2e/factories/issueRelation.factory'
import { IssueExternalLinkRow } from './IssueExternalLinkRow'

const coarse = vi.hoisted(() => ({ value: false }))
vi.mock('@/hooks/useIsCoarsePointer', () => ({ useIsCoarsePointer: () => coarse.value }))

const keyed = createExternalLink({ id: 1, url: 'https://example.com/1', key: 'JIRA-12', title: '결제 오류' })
const keyless = createExternalLink({ id: 2, url: 'https://example.com/2', key: null, title: '배포 체크리스트' })

/** 외부 링크 줄 여럿을 목록 하나에 그린다(줄마다 props 를 따로 준다). */
function renderRows(...rows: ComponentProps<typeof IssueExternalLinkRow>[]) {
  return renderWithProviders(
    <ul>
      {rows.map((props) => (
        <IssueExternalLinkRow key={props.link.id} {...props} />
      ))}
    </ul>,
  )
}

describe('IssueExternalLinkRow — 단추 이름', () => {
  beforeEach(() => {
    coarse.value = false
  })

  it('두 외부 링크의 × 단추는 각 링크 이름을 담아 서로 다르다', () => {
    renderRows({ link: keyed, onRemove: vi.fn() }, { link: keyless, onRemove: vi.fn() })
    expect(screen.getByRole('button', { name: 'JIRA-12 결제 오류 외부 링크 제거' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '배포 체크리스트 외부 링크 제거' })).toBeInTheDocument()
  })

  it('연필 단추도 링크 이름을 담는다', () => {
    renderRows({ link: keyed, onEdit: vi.fn() })
    expect(screen.getByRole('button', { name: 'JIRA-12 결제 오류 외부 링크 수정' })).toBeInTheDocument()
  })

  it('× 를 누르면 그 행의 onRemove 만 불린다', async () => {
    const first = vi.fn()
    const second = vi.fn()
    renderRows({ link: keyed, onRemove: first }, { link: keyless, onRemove: second })
    await userEvent.click(screen.getByRole('button', { name: '배포 체크리스트 외부 링크 제거' }))
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('터치에서는 × 단추가 없고 ⋯ 하나', () => {
    coarse.value = true
    renderRows({ link: keyed, onEdit: vi.fn(), onRemove: vi.fn() })
    expect(screen.queryByRole('button', { name: /외부 링크 제거$/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'JIRA-12 결제 오류 더보기' })).toBeInTheDocument()
  })
})
