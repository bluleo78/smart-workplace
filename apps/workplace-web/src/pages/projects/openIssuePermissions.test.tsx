// OPEN 프로젝트 보드·이슈 상세의 권한 분기(Task 11·WP-477·WP-503·WP-713·WP-741·WP-202) — 화면 테스트(WP-980, WP-1002 에서 목록·상세 화면만 띄우게 바꿈).
// 서버 플래그(viewerIsMember·viewerCanEdit*) → 버튼·다이얼로그 칸·잠김 안내·꺼진 위젯·드롭존, 저장된 뷰 요청 여부,
// 접수 다이얼로그 payload 는 브라우저 없이 판정되므로 e2e/pages/projects/open-issue-permissions.spec.ts 에서 옮겼다.
// 그 spec 에는 실제 파일 선택 업로드의 multipart 파일 이름(jsdom File 은 이름·내용이 실리지 않는다)·본문 이미지 붙여넣기(@input)와
// 인증 blob 이미지 열람(@platform)이 남는다.
// 판정 자체(OPEN·TEAM × 멤버 여부, 잠김 문구)는 src/lib/projectPermissions.test.ts 가 맡는다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { issueDetailHandlers, issueListHandlers, recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

const KEY = 'OPNQA'

/** OPEN 프로젝트 보드 — 비멤버/멤버. 목록은 issues 가 준다. */
function openBoard(viewerIsMember: boolean, issues: ReturnType<typeof createIssue>[] = [], extra: RequestHandler[] = []) {
  const requests = recordRequests()
  const view = renderProjectScreen(`/projects/${KEY}?view=board`, {
    handlers: [
      ...(extra ?? []),
      ...issueListHandlers({ key: KEY, project: { type: 'OPEN', viewerIsMember }, issues: () => ({ items: issues, nextCursor: null, hasMore: false }) }),
    ],
  })
  return { ...view, requests }
}

describe('보드 — OPEN 비멤버·멤버', () => {
  test('OPEN 비멤버도 「+ 새 태스크」가 보인다 (테넌트 전원 생성 가능)', async () => {
    openBoard(false)
    expect(await screen.findByRole('button', { name: '+ 새 태스크' })).toBeInTheDocument()
  })

  // WP-713 — 드래그가 막힌 카드에 dnd-kit 의 aria-disabled 가 붙어 카드와 「상세 보기」 링크까지 「사용 불가」로 읽혔다.
  test('OPEN 비멤버: 드래그 못 하는 카드도 사용 불가로 표시되지 않고 링크로 상세로 간다', async () => {
    // 링크를 누르면 상세(#7)로 간다 — 이 화면은 목록만 띄우므로 주소로 본다(상세 조회 응답은 원본과 같이 둔다).
    const { user, location } = openBoard(false, [createIssue({ id: 7, number: 7, title: '공개 카드' })], [
      http.get(`/api/v1/projects/${KEY}/issues/7`, () => HttpResponse.json(createIssueDetail({ summary: createIssue({ projectKey: KEY, id: 7, number: 7 }) }))),
      http.get(`/api/v1/projects/${KEY}/issues/7/:sub`, () => HttpResponse.json([])),
    ])
    const card = await screen.findByTestId('issue-card-7')
    expect(card).not.toHaveAttribute('aria-disabled')
    expect(card).not.toHaveAttribute('aria-roledescription')
    const link = within(card).getByRole('link')
    expect(link).not.toHaveAttribute('aria-disabled')
    await user.click(link)
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/issues/7`))
  })

  // WP-741 — 저장된 뷰는 멤버 전용이라 비멤버가 보드를 열 때마다 403 이었고, 쓸 수 없는 「뷰 저장」이 보였다.
  test('OPEN 비멤버: 저장된 뷰를 요청하지 않고 「뷰 저장」도 없다', async () => {
    const { requests } = openBoard(false)
    expect(await screen.findByTestId('view-chip-bar')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '+ 새 태스크' })).toBeInTheDocument()
    expect(screen.queryByTestId('save-view-button')).not.toBeInTheDocument()
    expect(requests.count('GET', `/api/v1/projects/${KEY}/saved-views`)).toBe(0)
  })

  test('OPEN 멤버: 저장된 뷰를 불러오고 「뷰 저장」이 보인다 (WP-741 반대쪽)', async () => {
    const { requests } = openBoard(true)
    expect(await screen.findByTestId('save-view-button')).toBeInTheDocument()
    await waitFor(() => expect(requests.count('GET', `/api/v1/projects/${KEY}/saved-views`)).toBeGreaterThan(0))
  })

  // WP-477 — 비멤버는 접수만: 유형·우선순위·일정 칸 대신 안내, 제목·본문만 보낸다(서버는 멤버 전용 값을 403 으로 거부).
  test('OPEN 비멤버: 새 이슈 다이얼로그는 접수 칸만 보이고 제목·본문만 보낸다', async () => {
    const posted: unknown[] = []
    const { user } = openBoard(false, [], [
      http.post(`/api/v1/projects/${KEY}/issues`, async ({ request }) => {
        posted.push(await request.json())
        return HttpResponse.json(createIssue({ projectKey: KEY, number: 2, title: '접수 건의' }), { status: 201 })
      }),
    ])
    await user.click(await screen.findByRole('button', { name: '+ 새 태스크' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId('create-intake-notice')).toHaveTextContent('우선순위·일정은 처리팀이 정합니다')
    expect(within(dialog).queryByLabelText('우선순위')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('시작일')).not.toBeInTheDocument()
    expect(within(dialog).queryByTestId('create-type-select')).not.toBeInTheDocument()
    fireEvent.change(document.getElementById('issue-title')!, { target: { value: '접수 건의' } })
    fireEvent.change(document.getElementById('issue-body')!, { target: { value: '내용' } })
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(posted).toEqual([{ title: '접수 건의', body: '내용' }]))
  })
})

/** OPEN reporter(비멤버) 시점의 이슈 상세 — 내용은 고칠 수 있고 워크플로는 못 고친다. */
async function openReporterDetail(handlers: RequestHandler[] = [], viewerCanDelete = true) {
  const view = renderIssueDetailScreen(`/projects/${KEY}/issues/1`, {
    handlers: [
      ...handlers,
      ...issueDetailHandlers({
        key: KEY,
        project: { type: 'OPEN', viewerIsMember: false },
        detail: createIssueDetail({
          summary: createIssue({ projectKey: KEY, number: 1, reporterId: 2 }),
          viewerCanEditContent: true,
          viewerCanEditWorkflow: false,
          viewerCanDelete,
        }),
      }),
    ],
  })
  await screen.findByTestId('issue-title-heading')
  return view
}

describe('이슈 상세 — OPEN reporter(비멤버)', () => {
  // WP-503 — 비멤버에겐 유형·상태 등이 흐리게만 보여 「기능이 없다」고 받아들였다(VOC WPV-8).
  test('유형 배지 옆 「멤버만 변경」을 누르면 이유와 코멘트 안내가 뜬다', async () => {
    const { user } = await openReporterDetail()
    expect(screen.getByTestId('issue-type-trigger')).toBeDisabled()
    const hint = screen.getByTestId('issue-workflow-locked-hint')
    expect(hint).toHaveTextContent(/^멤버만 변경$/)
    await user.click(hint)
    expect(await screen.findByTestId('issue-workflow-locked-popover')).toHaveTextContent(
      '이슈 속성(유형·상태·일정 등)은 프로젝트 멤버만 바꿀 수 있어요. 바꿔야 하면 코멘트로 알려 주세요.',
    )
  })

  // 서버가 멤버만 허용하는 라벨·관계·커스텀 필드·AI 제안을 비멤버에겐 막는다 — 예전엔 열려 있어 누르면 403(WP-503).
  test('라벨·관계·커스텀 필드는 꺼져 있고 AI 제안 버튼은 없다', async () => {
    const { user } = await openReporterDetail([
      http.get(`/api/v1/projects/${KEY}/fields`, () =>
        HttpResponse.json([{ id: 11, name: '고객사', type: 'TEXT', options: null, position: 0 }]),
      ),
    ])
    expect(screen.getByTestId('issue-workflow-locked-hint')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /AI 제안/ })).not.toBeInTheDocument()
    await user.click(within(screen.getByTestId('property-group-classification')).getByRole('button', { name: /분류/ }))
    expect(await screen.findByTestId('label-picker-trigger')).toBeDisabled()
    await user.click(within(screen.getByTestId('property-group-relations')).getByRole('button', { name: /^관계(\s*\d+)?$/ }))
    expect(await screen.findByTestId('issue-relations-section')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-relation-add')).not.toBeInTheDocument()
    await user.click(within(screen.getByTestId('property-group-custom-fields')).getByRole('button', { name: /커스텀 필드/ }))
    expect(await screen.findByTestId('field-input-11')).toBeDisabled()
  })
})
