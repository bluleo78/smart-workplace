// MemberSearchPopover 모드 분기 — agentOnly(개인 프로젝트 AI 추가)·includeAgents(팀 멤버 추가)에 따라
// kind 탭 노출과 백엔드 조회 범위(kind)가 달라지는지(#418·#734). 실제 검색 API 배선·POST payload 는
// E2E(project-members @smoke, member-search)가 맡는다(WP-413).
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { MemberSearchPopover } from './MemberSearchPopover'

// 검색 훅은 끊고, 어떤 kind 로 조회했는지만 기록한다 — "HUMAN 이 안 보인다"는 백엔드가 kind=AGENT 로 좁혀 준 결과다.
const useUserSearch = vi.fn()
vi.mock('@/hooks/queries/useUserSearch', () => ({
  useUserSearch: (q: string, kind: string) => useUserSearch(q, kind),
}))

function renderPopover(props: { agentOnly?: boolean; includeAgents?: boolean }) {
  return renderWithProviders(
    <MemberSearchPopover
      open
      onOpenChange={() => {}}
      existingMemberIds={new Set()}
      onSelect={() => {}}
      trigger={<button type="button">열기</button>}
      {...props}
    />,
  )
}

const KIND_TABS = ['ALL', 'HUMAN', 'AGENT'] as const

describe('MemberSearchPopover — 모드별 kind 탭·조회 범위', () => {
  beforeEach(() => {
    useUserSearch.mockReset()
    useUserSearch.mockReturnValue({ isLoading: false, isError: false, data: { content: [] } })
  })

  it('agentOnly(개인 프로젝트): kind 탭이 없고 AGENT 로만 조회한다', () => {
    renderPopover({ agentOnly: true, includeAgents: true })
    expect(screen.getByTestId('member-search-popover')).toBeInTheDocument()
    for (const k of KIND_TABS) expect(screen.queryByTestId(`member-search-filter-${k}`)).not.toBeInTheDocument()
    expect(useUserSearch).toHaveBeenLastCalledWith('', 'AGENT')
  })

  it('includeAgents(팀 프로젝트): 전체/사람/에이전트 탭을 보이고 기본은 전체(ALL)로 조회한다', () => {
    renderPopover({ includeAgents: true })
    for (const k of KIND_TABS) expect(screen.getByTestId(`member-search-filter-${k}`)).toBeInTheDocument()
    expect(screen.getByTestId('member-search-filter-ALL')).toHaveAttribute('aria-pressed', 'true')
    // WP-855 — 패널 없는 필터라 탭이 아니라 한국어 이름의 토글 묶음(예전엔 「kind 필터」로 읽혔다).
    expect(screen.getByRole('group', { name: '사람·에이전트 필터' })).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(useUserSearch).toHaveBeenLastCalledWith('', 'ALL')
  })

  it('사람 전용 호출부(옵션 없음): 탭이 없고 HUMAN 으로만 조회한다', () => {
    renderPopover({})
    for (const k of KIND_TABS) expect(screen.queryByTestId(`member-search-filter-${k}`)).not.toBeInTheDocument()
    expect(useUserSearch).toHaveBeenLastCalledWith('', 'HUMAN')
  })
})
