// 이슈 상세 제목·본문 인라인 수정·삭제 확인·저장 뒤 목록 갱신 — 페이지 테스트(WP-971).
// 편집 → PATCH payload·취소·빈 값 차단·길이 상한 안내, 본문 초안 정리·사용자별 초안 키, 삭제 확인창 문구와 DELETE,
// 상태 변경 뒤 목록 검색 캐시 무효화는 브라우저 없이 판정되므로
// e2e/pages/projects/{issue-title-body-edit,issue-delete,issue-update-cache-invalidation}.spec.ts 에서 옮겼다.
// IME 조합(@input)·포커스 복원(@input)·긴 제목 줄바꿈(@layout)·버튼 대비(@layout)·history 위치로 출발 목록에 되감기(@platform)는 E2E 에 남는다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { issueBodyDraftKey } from '@/lib/issueBodyDraft'
import { issueDetailSubHandlers } from '@/test/kits/projects/issueDetailStubs'
import { API, projectScreen } from '@/test/kits/projects/projectScreens'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { IssueResponse } from '@/types/issue'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { makeEpicType } from '../../../e2e/factories/issueType.factory'
import { statusFieldsOf } from '../../../e2e/factories/projectStatus.factory'


const KEY = 'WP'
const ISSUE = `${API}/projects/${KEY}/issues/1`
// 본문 초안 localStorage 키 — 로그인한 사용자(id 1) 몫, 테넌트 클레임 없음(#824, WP-699).
const DRAFT_KEY = issueBodyDraftKey({ userId: 1, tenantId: null }, KEY, 1)

/** 「일어나지 않음」 확인용 짧은 대기 — 요청이 나갔다면 이 사이에 핸들러에 닿는다. */
const settle = (ms = 300) => act(() => new Promise((r) => setTimeout(r, ms)))

/** 제목·본문이 가변인 이슈 1 상세 — PATCH 를 받아 반영하고 본문을 patches 에 쌓는다. */
async function openEditable({ patchStatus = 200 }: { patchStatus?: number } = {}) {
  const state = { title: '원본 제목', body: '원본 본문' }
  const patches: Record<string, unknown>[] = []
  const view = renderPage(`/projects/${KEY}/issues/1`, {
    handlers: [
      http.patch(ISSUE, async ({ request }) => {
        const p = (await request.json()) as Record<string, unknown>
        patches.push(p)
        if (patchStatus !== 200) return HttpResponse.json({ message: '저장 실패' }, { status: patchStatus })
        if (typeof p.title === 'string') state.title = p.title
        if (typeof p.body === 'string') state.body = p.body
        return HttpResponse.json(createIssue({ id: 1, number: 1, title: state.title }))
      }),
      ...issueDetailSubHandlers({ key: KEY, number: 1, detail: () => createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: state.title }), body: state.body }) }),
      ...projectScreen(KEY).handlers,
    ],
  })
  await within(await screen.findByTestId('issue-title-heading', {}, { timeout: PAGE_LOAD_TIMEOUT })).findByText('원본 제목')
  return { ...view, patches, state }
}

/** 제목 편집을 열고 입력 값을 바꾼다. */
async function editTitle(user: ReturnType<typeof renderPage>['user'], value: string) {
  await user.click(screen.getByRole('button', { name: '제목 편집' }))
  const input = await screen.findByTestId('issue-title-input')
  fireEvent.change(input, { target: { value } })
  return input
}

/** 본문 편집을 열고 값을 바꾼다. */
async function editBody(user: ReturnType<typeof renderPage>['user'], value: string) {
  await user.click(await screen.findByRole('button', { name: '본문 편집' }))
  const textarea = await screen.findByTestId('issue-body-textarea')
  fireEvent.change(textarea, { target: { value } })
  return textarea
}

describe('제목 인라인 수정 (#117)', () => {
  // #791 — h1 접근 이름에 편집 버튼 라벨(「제목 편집」)이 섞이지 않는다.
  test('제목 heading 의 접근 이름은 제목 글자만이다', async () => {
    await openEditable()
    expect(screen.getByRole('heading', { level: 1, name: '원본 제목' })).toBeInTheDocument()
  })

  test('제목을 고쳐 Enter 하면 PATCH {title} 이 나가고 새 제목이 보인다', async () => {
    const { user, patches } = await openEditable()
    const input = await editTitle(user, '수정된 제목')
    await user.type(input, '{Enter}')
    await waitFor(() => expect(patches).toEqual([{ title: '수정된 제목' }]))
    expect(await within(screen.getByTestId('issue-title-heading')).findByText('수정된 제목')).toBeInTheDocument()
  })

  // WP-459: 입력 단계에서 200자로 막는다(maxLength), 저장이 실패하면 오류 토스트와 입력이 다시 열린다.
  test('제목 입력은 200자 상한이고, 저장이 실패하면 오류 토스트 뒤 입력이 고친 값으로 남는다', async () => {
    const { user } = await openEditable({ patchStatus: 500 })
    await user.click(screen.getByRole('button', { name: '제목 편집' }))
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: '이슈 제목' })
    expect(input.maxLength).toBe(200)
    fireEvent.change(input, { target: { value: '실패할 제목' } })
    await user.type(input, '{Enter}')
    expect(await screen.findByText('저장 실패')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox', { name: '이슈 제목' })).toHaveValue('실패할 제목'))
  })

  test('제목을 공백으로 비우면 PATCH 없이 원래 제목으로 돌아간다', async () => {
    const { user, patches } = await openEditable()
    const input = await editTitle(user, '   ')
    await user.type(input, '{Enter}')
    await settle()
    expect(patches).toEqual([])
    expect(within(screen.getByTestId('issue-title-heading')).getByText('원본 제목')).toBeInTheDocument()
  })

  // ESC 는 편집만 취소하고(PATCH 없음) 상세에 머문다 — 상세 ESC(목록 복귀)와 충돌하지 않는다.
  test('제목 편집 중 Escape 는 편집만 취소하고 상세에 머문다', async () => {
    const { user, patches, location } = await openEditable()
    const input = await editTitle(user, '버려질 제목')
    await user.type(input, '{Escape}')
    await waitFor(() => expect(screen.queryByTestId('issue-title-input')).not.toBeInTheDocument())
    await settle()
    expect(patches).toEqual([])
    expect(within(screen.getByTestId('issue-title-heading')).getByText('원본 제목')).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}/issues/1`)
  })
})

describe('본문 인라인 수정 (#117)', () => {
  // 본문 영역 전체가 편집 버튼(호버 배경 클래스) — 누르면 편집기와 저장·취소가 보인다.
  test('본문 영역을 누르면 편집기와 저장·취소 버튼이 보인다', async () => {
    const { user } = await openEditable()
    const area = await screen.findByRole('button', { name: '본문 편집' })
    expect(area).toHaveClass('hover:bg-muted/50')
    await user.click(area)
    expect(await screen.findByTestId('issue-body-textarea')).toBeInTheDocument()
    expect(screen.getByTestId('issue-body-save')).toBeInTheDocument()
    expect(screen.getByTestId('issue-body-cancel')).toBeInTheDocument()
  })

  test('본문을 고쳐 Ctrl+Enter 하면 PATCH {body} 가 나가고 새 본문이 보인다', async () => {
    const { user, patches } = await openEditable()
    const textarea = await editBody(user, '수정된 본문')
    textarea.focus()
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(patches).toEqual([{ body: '수정된 본문' }]))
    expect(await screen.findByText('수정된 본문')).toBeInTheDocument()
  })

  test('본문을 고쳐 「저장」을 누르면 PATCH {body} 가 나가고 새 본문이 보인다', async () => {
    const { user, patches } = await openEditable()
    await editBody(user, '버튼으로 저장한 본문')
    await user.click(screen.getByTestId('issue-body-save'))
    await waitFor(() => expect(patches).toEqual([{ body: '버튼으로 저장한 본문' }]))
    expect(await screen.findByText('버튼으로 저장한 본문')).toBeInTheDocument()
  })

  test('본문 편집 중 Escape·「취소」는 PATCH 없이 원본으로 돌아간다', async () => {
    const { user, patches } = await openEditable()
    const textarea = await editBody(user, '버려질 본문')
    textarea.focus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('issue-body-textarea')).not.toBeInTheDocument())
    expect(screen.getByText('원본 본문')).toBeInTheDocument()

    await editBody(user, '또 버려질 본문')
    await user.click(screen.getByTestId('issue-body-cancel'))
    await waitFor(() => expect(screen.queryByTestId('issue-body-textarea')).not.toBeInTheDocument())
    await settle()
    expect(patches).toEqual([])
    expect(screen.getByText('원본 본문')).toBeInTheDocument()
  })

  // WP-885: 5만자 초과 — 서버 400 토스트 대신 입력창 아래 안내 + 저장(버튼·단축키) 막힘, 상한 이내로 줄이면 풀린다.
  test('본문이 5만자를 넘으면 안내를 보이고 저장을 막으며, 줄이면 저장할 수 있다', async () => {
    const { user, patches } = await openEditable()
    const textarea = await editBody(user, '가'.repeat(50001))
    expect(await screen.findByTestId('issue-body-limit-error')).toHaveTextContent('50000자 이하')
    expect(screen.getByTestId('issue-body-save')).toBeDisabled()
    textarea.focus()
    await user.keyboard('{Control>}{Enter}{/Control}')
    await settle()
    expect(patches).toEqual([])
    expect(screen.getByTestId('issue-body-textarea')).toBeInTheDocument()

    fireEvent.change(textarea, { target: { value: '가'.repeat(50000) } })
    await waitFor(() => expect(screen.queryByTestId('issue-body-limit-error')).not.toBeInTheDocument())
    expect(screen.getByTestId('issue-body-save')).toBeEnabled()
  })

  // #824: 편집 중 초안은 localStorage 에 디바운스 저장되고, 정식 저장이 성공하면 정리돼 다시 열어도 복구 배너가 없다.
  test('저장에 성공하면 초안이 정리돼 다시 편집을 열어도 복구 배너가 없다', async () => {
    const { user, patches } = await openEditable()
    await editBody(user, '정상 저장된 본문')
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toBe('정상 저장된 본문'), { timeout: 3000 })
    await user.click(screen.getByTestId('issue-body-save'))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(await screen.findByText('정상 저장된 본문')).toBeInTheDocument()
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull())
    await user.click(screen.getByRole('button', { name: '본문 편집' }))
    await screen.findByTestId('issue-body-textarea')
    expect(screen.queryByTestId('issue-body-draft-banner')).not.toBeInTheDocument()
  })

  // WP-699: 같은 기기의 다른 사용자 키·예전 형식 키에 남은 초안은 이 사용자에게 복구 배너로 뜨지 않는다.
  test('다른 사용자·예전 키의 초안은 복구 배너로 뜨지 않는다', async () => {
    window.localStorage.setItem(issueBodyDraftKey({ userId: 2, tenantId: null }, KEY, 1), '다른 사람의 저장 안 한 글')
    window.localStorage.setItem(`issue-body-draft:${KEY}:1`, '예전 키에 남은 글')
    const { user } = await openEditable()
    await user.click(screen.getByRole('button', { name: '본문 편집' }))
    expect(await screen.findByTestId('issue-body-textarea')).toHaveValue('원본 본문')
    expect(screen.queryByTestId('issue-body-draft-banner')).not.toBeInTheDocument()
  })

  // #824 짝: 이 사용자 키에 서버 본문과 다른 초안이 있으면 배너 → [불러오기] 로 편집기에 복원된다.
  test('내 초안이 서버 본문과 다르면 복구 배너가 뜨고 불러오면 편집기에 채워진다', async () => {
    window.localStorage.setItem(DRAFT_KEY, '저장 안 하고 이탈할 초안')
    const { user } = await openEditable()
    await user.click(screen.getByRole('button', { name: '본문 편집' }))
    await user.click(await screen.findByTestId('issue-body-draft-restore'))
    expect(screen.getByTestId('issue-body-textarea')).toHaveValue('저장 안 하고 이탈할 초안')
    expect(screen.queryByTestId('issue-body-draft-banner')).not.toBeInTheDocument()
  })
})

describe('삭제 확인 AlertDialog (#161)', () => {
  /** 이슈 2 상세(삭제 대상) — DELETE 는 deletes 에 센다. */
  async function openDeletable(summary: Partial<IssueResponse> = {}) {
    let deletes = 0
    const view = renderPage(`/projects/${KEY}/issues/2`, {
      handlers: [
        http.delete(`${API}/projects/${KEY}/issues/2`, () => {
          deletes++
          return new HttpResponse(null, { status: 204 })
        }),
        ...issueDetailSubHandlers({ key: KEY, number: 2, detail: () =>
          createIssueDetail({ summary: createIssue({ id: 2, number: 2, title: '삭제 대상 태스크', ...summary }) }) }),
        ...projectScreen(KEY).handlers,
      ],
    })
    await view.user.click(await screen.findByTestId('issue-delete', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    const dialog = await screen.findByRole('alertdialog')
    return { ...view, dialog, deletes: () => deletes }
  }

  test('삭제 버튼은 확인창(태스크 삭제)을 열고, 취소하면 닫히며 DELETE 는 없다', async () => {
    const { user, dialog, deletes } = await openDeletable()
    expect(within(dialog).getByText('태스크 삭제')).toBeInTheDocument()
    expect(within(dialog).getByText(/이 태스크를 삭제하시겠습니까\?/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await settle()
    expect(deletes()).toBe(0)
  })

  test('확인창에서 「삭제」를 누르면 DELETE 가 한 번 나간다', async () => {
    const { user, dialog, deletes } = await openDeletable()
    await user.click(within(dialog).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(deletes()).toBe(1))
  })

  test('하위가 있으면 하위 태스크 수와 함께 삭제된다는 경고를 보인다', async () => {
    const { dialog } = await openDeletable({ childCount: 3 })
    expect(within(dialog).getByText('이 태스크에는 하위 태스크가 3개 있습니다. 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.')).toBeInTheDocument()
  })

  // WP-469: 에픽은 「에픽 삭제」·「하위 이슈(태스크·버그 등)도 함께 삭제」로 알린다.
  test('에픽 삭제 확인창은 에픽 문구와 하위 이슈 경고를 보인다', async () => {
    const { dialog } = await openDeletable({ childCount: 2, type: makeEpicType() })
    expect(within(dialog).getByRole('heading', { name: '에픽 삭제' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('이 에픽에는 하위 이슈가 2개 있습니다. 하위 이슈(태스크·버그 등)도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.')
  })
})

describe('저장 뒤 목록 검색 캐시 무효화 (#175)', () => {
  // 상세에서 상태를 바꾸고 목록으로 돌아오면 검색 API 를 다시 부른다(staleTime 안이라도 issueKeys.search 무효화).
  test('상세에서 상태를 바꾼 뒤 목록으로 돌아오면 검색 요청이 다시 나간다', async () => {
    let summary = createIssue({ id: 1, number: 1, title: '상태 변경 테스트 이슈', status: 'TODO' })
    const screenApi = projectScreen(KEY, { search: () => [summary] })
    const { user } = renderPage(`/projects/${KEY}`, {
      handlers: [
        http.patch(ISSUE, async ({ request }) => {
          const p = (await request.json()) as { statusId: number }
          summary = { ...summary, ...statusFieldsOf(p.statusId) }
          return HttpResponse.json(createIssueDetail({ summary }))
        }),
        ...issueDetailSubHandlers({ key: KEY, number: 1, detail: () => createIssueDetail({ summary }) }),
        ...screenApi.handlers,
      ],
    })
    await user.click(await screen.findByRole('link', { name: '상태 변경 테스트 이슈' }, { timeout: PAGE_LOAD_TIMEOUT }))
    await screen.findByTestId('issue-title-heading')
    const before = screenApi.searches.filter((u) => !u.searchParams.has('parent')).length

    await user.click(screen.getByRole('combobox', { name: '상태' }))
    await user.click(await screen.findByRole('option', { name: '진행 중' }))
    await screen.findByText('이슈 필드가 업데이트되었습니다')

    // 브레드크럼의 프로젝트 링크로 목록에 돌아간다(← 는 브라우저 history 위치를 써서 E2E 가 본다).
    await user.click(within(screen.getByRole('navigation', { name: '이슈 경로' })).getAllByRole('link')[0])
    await screen.findByRole('link', { name: '상태 변경 테스트 이슈' })
    await waitFor(() => expect(screenApi.searches.filter((u) => !u.searchParams.has('parent')).length).toBeGreaterThan(before))
  })
})
