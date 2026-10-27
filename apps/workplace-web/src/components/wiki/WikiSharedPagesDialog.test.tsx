// @vitest-environment jsdom
// happy-dom(화면 테스트 기본, WP-1002)과 날짜 칸·글자 수 제한·포커스 이동 처리가 달라 이 파일은 jsdom 에서 돈다.
// 스페이스 「공유 중인 페이지」 목록(WP-579) — 줄 요약·페이지 열기, 링크 복사(토큰이 있을 때만).
// 서버는 EDITOR 미만 호출자에게 token 을 null 로 준다 — 그때는 복사 버튼을 두지 않는다. 목록 열기 배선은 E2E(wiki-share-owner).
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { WikiSharedPageItem } from '../../types/wiki'
import { WikiSharedPagesDialog } from './WikiSharedPagesDialog'

const list = vi.hoisted(() => ({ value: { isPending: false, isError: false, data: [] as WikiSharedPageItem[] } }))
vi.mock('../../hooks/queries/useWikiShare', () => ({ useWikiSharedPages: () => list.value }))
const copyText = vi.hoisted(() => vi.fn())
vi.mock('@/lib/copyText', () => ({ copyText }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const item = (over: Partial<WikiSharedPageItem> = {}): WikiSharedPageItem => ({
  pageId: 11,
  title: '제품 로드맵',
  audience: 'WORKSPACE',
  permission: 'VIEW',
  includeChildren: true,
  peopleCount: 0,
  groupCount: 0,
  createdBy: { userId: 2, name: '김민지' },
  updatedAt: '2026-10-20T01:00:00Z',
  expiresAt: null,
  lastAccessedAt: null,
  viewCount: 0,
  token: 'wsh_tok11',
  ...over,
})

function renderList(items: WikiSharedPageItem[], onOpenPage = vi.fn()) {
  list.value = { isPending: false, isError: false, data: items }
  renderWithProviders(<WikiSharedPagesDialog open onOpenChange={() => {}} spaceId={1} spaceName="팀 노트" onOpenPage={onOpenPage} />)
  return onOpenPage
}

beforeEach(() => copyText.mockReset().mockResolvedValue(true))

describe('WikiSharedPagesDialog', () => {
  it('줄마다 범위 요약·하위 포함·공유한 사람을 보이고, 줄을 누르면 그 페이지를 연다', async () => {
    const onOpenPage = renderList([item(), item({ pageId: 12, title: '고객 목록', audience: 'PEOPLE', peopleCount: 3, permission: 'EDIT', includeChildren: false })])
    const rows = screen.getByTestId('wiki-shared-pages-list')
    expect(within(rows).getByText('워크스페이스 전체 · 보기 · 하위 페이지 포함')).toBeInTheDocument()
    expect(within(rows).getByText('3명 · 편집')).toBeInTheDocument()
    await userEvent.click(within(rows).getByRole('button', { name: /^고객 목록3명/ }))
    expect(onOpenPage).toHaveBeenCalledWith(12)
  })

  it('비어 있으면 안내 문구', () => {
    renderList([])
    expect(screen.getByText('공유 중인 페이지가 없습니다.')).toBeInTheDocument()
  })

  it('토큰이 있으면 링크 복사 버튼이 공유 주소를 복사하고 페이지는 열지 않는다', async () => {
    const onOpenPage = renderList([item()])
    await userEvent.click(screen.getByRole('button', { name: '제품 로드맵 링크 복사' }))
    expect(copyText).toHaveBeenCalledWith(`${window.location.origin}/wiki/share/wsh_tok11`)
    expect(onOpenPage).not.toHaveBeenCalled()
  })

  it('토큰이 null(읽기 전용 멤버)이면 복사 버튼을 두지 않는다', () => {
    renderList([item({ token: null })])
    expect(screen.queryByRole('button', { name: /링크 복사/ })).not.toBeInTheDocument()
    expect(screen.getByText('제품 로드맵')).toBeInTheDocument()
  })
})
