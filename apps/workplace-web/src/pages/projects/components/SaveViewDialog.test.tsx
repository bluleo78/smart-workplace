// SaveViewDialog 열 구성 옵트인(WP-270 사용자 결정, 스펙 4.7) — 「현재 열 구성도 함께 저장」 체크박스의 노출 조건과
// 저장 페이로드(생성: 켰을 때만 cols / 수정 「현재 필터로 갱신」: 뷰의 선택 유지)를 지킨다.
// 실제 POST·PATCH 배선과 일치·「수정됨」 판정은 E2E(issue-list-columns)가 맡는다(WP-413).
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { IssueListColumnKey } from '../../../lib/issueListColumns'
import type { SavedViewResponse } from '../../../types/savedView'
import { SaveViewDialog } from './SaveViewDialog'

// 저장 훅은 끊고 넘긴 페이로드만 기록한다. 커스텀 필드 정의는 열 안내 문구용 — 고객사(cf7) 하나.
const createMutate = vi.fn()
const updateMutate = vi.fn()
vi.mock('../../../hooks/queries/useSavedViews', () => ({
  useCreateSavedView: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateSavedView: () => ({ mutateAsync: updateMutate, isPending: false }),
}))
vi.mock('../../../hooks/queries/useCustomFields', () => ({
  useCustomFields: () => ({ data: [{ id: 7, projectId: 1, name: '고객사', type: 'SELECT', options: [], position: 0, createdAt: '', updatedAt: '' }] }),
}))

const QUERY = 'priority=HIGH&group=none'
const WITH_COLS = 'priority=HIGH&group=none&cols=priority%2Cassignee%2Creporter%2Ccf7'
const COLUMNS: IssueListColumnKey[] = ['priority', 'assignee', 'reporter', 'cf7']

function view(query: string): SavedViewResponse {
  return { id: 3, name: '높음', query, visibility: 'PRIVATE', ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '' }
}

function renderDialog(props: { columns?: IssueListColumnKey[]; editing?: SavedViewResponse }) {
  return renderWithProviders(
    <SaveViewDialog projectKey="WP" query={QUERY} queryWithColumns={WITH_COLS} open onOpenChange={() => {}} {...props} />,
  )
}

describe('SaveViewDialog — 열 구성 옵트인', () => {
  beforeEach(() => {
    createMutate.mockReset().mockResolvedValue({})
    updateMutate.mockReset().mockResolvedValue({})
  })

  it('생성·목록 보기(columns 있음): 체크박스는 꺼진 채 보이고 고른 열을 헤더 문구로 안내한다', () => {
    renderDialog({ columns: COLUMNS })
    expect(screen.getByTestId('save-view-include-columns')).not.toBeChecked()
    expect(screen.getByTestId('save-view-columns-hint')).toHaveTextContent('(우선순위·담당자·보고자·고객사)')
  })

  it('고른 열이 하나도 없으면(모두 끔) 「선택 열 없음」 으로 안내한다', () => {
    renderDialog({ columns: [] })
    expect(screen.getByTestId('save-view-columns-hint')).toHaveTextContent('(선택 열 없음)')
  })

  it('columns 를 주지 않으면(보드·모바일) 체크박스가 없다', () => {
    renderDialog({})
    expect(screen.queryByTestId('save-view-include-columns')).not.toBeInTheDocument()
  })

  it('수정 모드에선 체크박스가 없다(뷰의 선택을 바꾸지 않는다)', () => {
    renderDialog({ columns: COLUMNS, editing: view(QUERY) })
    expect(screen.queryByTestId('save-view-include-columns')).not.toBeInTheDocument()
  })

  it('생성 — 끈 채 저장하면 cols 없는 쿼리, 켜고 저장하면 열 포함 쿼리', async () => {
    const { unmount } = renderDialog({ columns: COLUMNS })
    fireEvent.change(screen.getByTestId('save-view-name'), { target: { value: '높음' } })
    fireEvent.click(screen.getByTestId('save-view-submit'))
    await waitFor(() => expect(createMutate).toHaveBeenCalledWith({ name: '높음', query: QUERY, visibility: 'PRIVATE' }))
    unmount()

    renderDialog({ columns: COLUMNS })
    fireEvent.change(screen.getByTestId('save-view-name'), { target: { value: '높음 + 열' } })
    fireEvent.click(screen.getByTestId('save-view-include-columns'))
    fireEvent.click(screen.getByTestId('save-view-submit'))
    await waitFor(() => expect(createMutate).toHaveBeenLastCalledWith({ name: '높음 + 열', query: WITH_COLS, visibility: 'PRIVATE' }))
  })

  it('수정 「현재 필터로 갱신」 — 열을 담은 뷰는 지금 열까지, 안 담은 뷰는 열 없이 저장한다', async () => {
    const { unmount } = renderDialog({ editing: view('priority=MID&cols=assignee') })
    fireEvent.click(screen.getByTestId('save-view-update-query'))
    fireEvent.click(screen.getByTestId('save-view-submit'))
    await waitFor(() => expect(updateMutate).toHaveBeenCalledWith({ id: 3, body: { name: '높음', query: WITH_COLS, visibility: 'PRIVATE' } }))
    unmount()

    renderDialog({ editing: view('priority=MID') })
    fireEvent.click(screen.getByTestId('save-view-update-query'))
    fireEvent.click(screen.getByTestId('save-view-submit'))
    await waitFor(() => expect(updateMutate).toHaveBeenLastCalledWith({ id: 3, body: { name: '높음', query: QUERY, visibility: 'PRIVATE' } }))
  })

  it('생성 성공 — 만든 뷰로 onCreated 를 불러 호출부가 그 뷰를 활성으로 고르게 한다', async () => {
    const created = view(QUERY)
    createMutate.mockResolvedValue(created)
    const onCreated = vi.fn()
    renderWithProviders(
      <SaveViewDialog projectKey="WP" query={QUERY} queryWithColumns={WITH_COLS} onCreated={onCreated} open onOpenChange={() => {}} />,
    )
    fireEvent.change(screen.getByTestId('save-view-name'), { target: { value: '높음' } })
    fireEvent.click(screen.getByTestId('save-view-submit'))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created))
  })
})
