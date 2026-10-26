// 메일 상세의 이슈 승격(#520·WP-954·#859)·첨부 뷰어 주소 상태(WP-280)·변환 미리보기 404(WP-432) — 화면 테스트(WP-984, WP-995).
// 승격 대화상자 사전채움·담당/보고자 payload·409 뒤 배지 갱신, 첨부를 열 때만 받기·딥링크·찾을 수 없음 안내·
// 404 의 오류/미지원 구분은 브라우저 없이 판정되므로 mail-to-issue.spec.ts·mail-attachment-viewer.spec.ts·
// mail-converted-preview.spec.ts 에서 옮겼다. PDF 그리기·다운로드·포커스 복원·토스트 쌓임은 그 E2E(@platform·@input·@layout)가 지킨다.
// 메일 모듈만 renderScreen 으로 띄운다(testkit-b4).
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { detail, mailAccount, summary } from '../../../e2e/factories/mail.factory'
import { record, renderMail } from './testkit-b4'

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))

// ── 메일 → 이슈 승격(mail-to-issue) ─────────────────────────────────────────────

/** AI 켠 계정 + 7번 메일(목록·상세·요약) + 연결 이슈(기본 없음). */
function issueHandlers(linked: () => string | null = () => null) {
  return [
    http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary({ id: 7, subject: '정산 자료 검토 요청' })])),
    http.get('/api/v1/mail/messages/7', () => HttpResponse.json(detail({ id: 7, subject: '정산 자료 검토 요청', bodyText: '본문' }))),
    http.get('/api/v1/mail/messages/7/summary', () => HttpResponse.json({ summary: '요약' })),
    http.get('/api/v1/mail/messages/7/linked-issue', () => HttpResponse.json({ issueKey: linked() })),
  ]
}
const draftHandler = (draft: object) => http.post('/api/v1/mail/messages/7/issue-draft', () => HttpResponse.json(draft))
const membersHandler = (members: object[] = []) => http.get('/api/v1/projects/:key/members', () => HttpResponse.json(members))

/** 7번 메일을 열고 「AI 이슈 생성」 대화상자를 띄운다. */
async function openIssueDialog(handlers: NonNullable<Parameters<typeof renderMail>[1]>['handlers'], linked?: () => string | null) {
  const view = renderMail('/mail/1', { accounts: [mailAccount({ aiEnabled: true })], handlers: [...(handlers ?? []), ...issueHandlers(linked)] })
  await view.user.click(await screen.findByTestId('mail-row-7'))
  await screen.findByTestId('mail-detail')
  return view
}

test('AI 이슈 생성 → 초안으로 사전채움 → 담당을 AI 비서로 바꾸면 assigneeIds 에 9 를 실어 만든다', async () => {
  const promote = record('post', '/api/v1/mail/messages/7/issue', () => HttpResponse.json({ issueKey: 'FIN-12' }))
  const { user } = await openIssueDialog([
    promote.handler,
    draftHandler({
      title: '정산 자료 검토',
      body: '- 5월 자료 확인',
      priority: 'HIGH',
      suggestedProjectKey: 'FIN',
      candidateProjects: [{ key: 'FIN', name: '재무' }, { key: 'PERSONAL', name: '내 작업' }],
    }),
    membersHandler([
      { userId: 1, username: 'me', name: '나', kind: 'HUMAN', role: 'OWNER', createdAt: null },
      { userId: 9, username: 'ai', name: 'AI 비서', kind: 'AGENT', role: 'MEMBER', createdAt: null },
    ]),
  ])
  // AI 버튼은 ai-accent 보조 컬러(디자인시스템 §7.2 — 아이콘+색).
  expect(screen.getByTestId('mail-ai-issue').className).toMatch(/text-ai-accent/)
  await user.click(screen.getByTestId('mail-ai-issue'))
  expect(await screen.findByTestId('mail-to-issue-dialog')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('issue-draft-title')).toHaveValue('정산 자료 검토'))
  await user.click(screen.getByTestId('issue-draft-assignee'))
  await user.click(await screen.findByRole('option', { name: /AI 비서/ }))
  await user.click(screen.getByTestId('mail-to-issue-submit'))
  expect(await screen.findByText('이슈 FIN-12 를 만들었어요')).toBeInTheDocument()
  expect(promote.last().body).toMatchObject({ projectKey: 'FIN', title: '정산 자료 검토', priority: 'HIGH', assigneeIds: [9] })
})

test('보고자: 기본은 보낸 사람, 볼 수 없는 프로젝트로 바꾸면 막히고 「나」, 다시 돌아와 만들면 reporter=SENDER(WP-954)', async () => {
  const promote = record('post', '/api/v1/mail/messages/7/issue', () => HttpResponse.json({ issueKey: 'FIN-13' }))
  const { user } = await openIssueDialog([
    promote.handler,
    draftHandler({
      title: '정산 자료 검토',
      body: '- 5월 자료 확인',
      priority: 'HIGH',
      suggestedProjectKey: 'FIN',
      candidateProjects: [
        { key: 'FIN', name: '재무', senderSelectable: true, senderDefault: true },
        { key: 'PERSONAL', name: '내 작업', senderSelectable: false, senderDefault: false },
      ],
      sender: { address: 'kim@corp.example', name: '김보냄', member: true, self: false },
    }),
    membersHandler(),
  ])
  await user.click(screen.getByTestId('mail-ai-issue'))
  expect(await screen.findByTestId('mail-to-issue-reporter')).toHaveTextContent('보낸 사람 (김보냄)')
  await waitFor(() => expect(screen.getByTestId('mail-to-issue-reporter-sender')).toBeChecked())

  await user.click(screen.getByTestId('issue-draft-project'))
  await user.click(await screen.findByRole('option', { name: '내 작업' }))
  await waitFor(() => expect(screen.getByTestId('mail-to-issue-reporter-sender')).toBeDisabled())
  expect(screen.getByTestId('mail-to-issue-reporter-me')).toBeChecked()
  expect(screen.getByTestId('mail-to-issue-reporter-reason')).toHaveTextContent('보낸 사람이 이 프로젝트를 볼 수 없어 고를 수 없어요')

  await user.click(screen.getByTestId('issue-draft-project'))
  await user.click(await screen.findByRole('option', { name: '재무' }))
  await waitFor(() => expect(screen.getByTestId('mail-to-issue-reporter-sender')).toBeChecked())
  await user.click(screen.getByTestId('mail-to-issue-submit'))
  expect(await screen.findByText('이슈 FIN-13 를 만들었어요')).toBeInTheDocument()
  expect(promote.last().body).toMatchObject({ projectKey: 'FIN', reporter: 'SENDER' })
})

test('보고자: 외부 발신자는 「보낸 사람」을 고를 수 없고 reporter 없이(나) 만든다(WP-954)', async () => {
  const promote = record('post', '/api/v1/mail/messages/7/issue', () => HttpResponse.json({ issueKey: 'FIN-14' }))
  const { user } = await openIssueDialog([
    promote.handler,
    draftHandler({
      title: '외부 요청',
      body: '',
      priority: 'MID',
      suggestedProjectKey: 'FIN',
      candidateProjects: [{ key: 'FIN', name: '재무', senderSelectable: false, senderDefault: false }],
      sender: { address: 'partner@outside.example', name: null, member: false, self: false },
    }),
    membersHandler(),
  ])
  await user.click(screen.getByTestId('mail-ai-issue'))
  expect(await screen.findByTestId('mail-to-issue-reporter')).toHaveTextContent('보낸 사람 (partner@outside.example)')
  expect(screen.getByTestId('mail-to-issue-reporter-sender')).toBeDisabled()
  expect(screen.getByTestId('mail-to-issue-reporter-reason')).toHaveTextContent('보낸 사람이 워크스페이스 구성원이 아니라 고를 수 없어요')
  await waitFor(() => expect(screen.getByTestId('issue-draft-title')).toHaveValue('외부 요청'))
  await user.click(screen.getByTestId('mail-to-issue-submit'))
  expect(await screen.findByText('이슈 FIN-14 를 만들었어요')).toBeInTheDocument()
  expect(promote.last().body).not.toHaveProperty('reporter')
})

test('연결된 이슈가 있으면 상세에 키 배지가, 없으면 배지가 없다', async () => {
  const { unmount } = await openIssueDialog([], () => 'FIN-12')
  expect(await screen.findByTestId('mail-linked-issue')).toHaveTextContent(/FIN-12/)
  unmount()
  await openIssueDialog([], () => null)
  await wait(100)
  expect(screen.queryByTestId('mail-linked-issue')).not.toBeInTheDocument()
})

test('승격 대화상자의 취소는 대화상자를 닫는다', async () => {
  const { user } = await openIssueDialog([
    draftHandler({ title: '초안 제목', body: '초안 본문', priority: 'MID', suggestedProjectKey: 'FIN', candidateProjects: [{ key: 'FIN', name: '재무' }] }),
    membersHandler(),
  ])
  await user.click(screen.getByTestId('mail-ai-issue'))
  const dlg = await screen.findByTestId('mail-to-issue-dialog')
  await user.click(within(dlg).getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('mail-to-issue-dialog')).not.toBeInTheDocument())
})

test('이미 전환한 메일이면 409 문구를 토스트로 보이고 연결 이슈 배지를 다시 받아 드러낸다(#859)', async () => {
  let promoted = false
  const { user } = await openIssueDialog(
    [
      http.post('/api/v1/mail/messages/7/issue', () => {
        promoted = true
        return HttpResponse.json({ status: 409, message: '이미 이 메일로 만든 이슈가 있습니다: FIN-3' }, { status: 409 })
      }),
      draftHandler({ title: '정산 자료 검토', body: '본문', priority: 'MID', suggestedProjectKey: 'FIN', candidateProjects: [{ key: 'FIN', name: '재무' }] }),
      membersHandler(),
    ],
    () => (promoted ? 'FIN-3' : null),
  )
  expect(screen.queryByTestId('mail-linked-issue')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('mail-ai-issue'))
  await waitFor(() => expect(screen.getByTestId('issue-draft-title')).toHaveValue('정산 자료 검토'))
  await user.click(screen.getByTestId('mail-to-issue-submit'))
  expect(await screen.findByText('이미 이 메일로 만든 이슈가 있습니다: FIN-3')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('mail-linked-issue')).toHaveTextContent(/FIN-3/))
})

// ── 첨부 뷰어 주소 상태(mail-attachment-viewer, WP-280) ─────────────────────────────────────────────

const MEMO_TEXT = '회의 메모 본문입니다'

/** 10번 메일(인라인 이미지 5 + PDF 6 + 텍스트 7) + 11번 — 첨부 콘텐츠 요청은 기록한다(E2E stubMailWithAttachments 와 같은 구성). */
function viewerHandlers() {
  const contents = record('get', '/api/v1/mail/attachments/:id/content', ({ url }) => {
    const id = Number(url.pathname.split('/').at(-2))
    if (id === 7) return new HttpResponse(MEMO_TEXT, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
    if (id === 5) return new HttpResponse(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { 'content-type': 'image/png' } })
    return new HttpResponse(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { headers: { 'content-type': 'application/pdf' } })
  })
  return {
    contents,
    handlers: [
      contents.handler,
      http.get('/api/v1/mail/accounts/1/messages', () =>
        HttpResponse.json([summary(), summary({ id: 11, subject: '점심 메뉴', seen: true })]),
      ),
      http.get('/api/v1/mail/messages/10', () =>
        HttpResponse.json(
          detail({
            bodyText: null,
            bodyHtml: '<p>안내</p><img id="inline" src="cid:logo.png">',
            attachments: [
              { id: 5, filename: 'logo.png', contentType: 'image/png', sizeBytes: 4, contentId: null },
              { id: 6, filename: '안건.pdf', contentType: 'application/pdf', sizeBytes: 4, contentId: null },
              { id: 7, filename: 'memo.txt', contentType: 'Text/Plain; charset=utf-8', sizeBytes: 30, contentId: null },
            ],
          }),
        ),
      ),
      http.get('/api/v1/mail/messages/11', () => HttpResponse.json(detail({ id: 11, subject: '점심 메뉴', attachments: [] }))),
    ],
  }
}

test('딥링크 — 있는 첨부(텍스트)는 바로 열려 2 / 2 로 보이고, 이 메일에 없는 첨부는 찾을 수 없음 안내', async () => {
  const first = renderMail('/mail/1?messageId=10&preview=mail:7', { handlers: viewerHandlers().handlers })
  expect(await screen.findByTestId('preview-body', {}, { timeout: 5000 })).toHaveTextContent(MEMO_TEXT)
  expect(screen.getByTestId('preview-meta')).toHaveTextContent('2 / 2')
  first.unmount()
  renderMail('/mail/1?messageId=10&preview=mail:99', { handlers: viewerHandlers().handlers })
  expect(await screen.findByTestId('preview-not-found')).toBeInTheDocument()
  expect(screen.queryByTestId('attachment-viewer')).not.toBeInTheDocument()
})

test('칩을 그리기만 해서는 첨부를 받지 않는다 — 인라인 이미지(5)만 받고, 텍스트(7)는 열 때 받는다', async () => {
  const { contents, handlers } = viewerHandlers()
  const { user } = renderMail('/mail/1', { handlers })
  await user.click(await screen.findByTestId('mail-row-10'))
  expect(await screen.findByTestId('mail-attachment-open-6')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-attachment-open-5')).not.toBeInTheDocument()
  await waitFor(() => expect(contents.calls.map((c) => c.url.pathname)).toEqual(['/api/v1/mail/attachments/5/content']))
  await user.click(screen.getByTestId('mail-attachment-open-7'))
  expect(await screen.findByTestId('preview-body', {}, { timeout: 5000 })).toHaveTextContent(MEMO_TEXT)
  expect(contents.calls.map((c) => c.url.pathname)).toContain('/api/v1/mail/attachments/7/content')
})

test('다른 메일 주소로 바뀌면(?preview 그대로) 앞 메일 첨부를 계속 보여 주지 않고 찾을 수 없음 안내', async () => {
  const { user } = renderMail('/mail/1', { handlers: viewerHandlers().handlers })
  await user.click(await screen.findByTestId('mail-row-10'))
  await user.click(await screen.findByTestId('mail-attachment-open-7'))
  expect(await screen.findByTestId('preview-body', {}, { timeout: 5000 })).toHaveTextContent(MEMO_TEXT)
  // 손으로 고친 URL(메일만 11 로 바꾼)을 앱 안 내비게이션으로 재현 — 새로고침 없이 같은 화면 인스턴스가 받는다.
  act(() => {
    window.history.pushState(window.history.state, '', '/mail/1?messageId=11&preview=mail:7')
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  })
  expect(await screen.findByTestId('preview-not-found')).toBeInTheDocument()
  expect(screen.queryByTestId('attachment-viewer')).not.toBeInTheDocument()
})

test('메일 없이 남은 ?preview 는 찾을 수 없음 안내 후 Esc 로 닫으면 주소에서 지운다', async () => {
  const { user, location } = renderMail('/mail/1?preview=mail:7', { handlers: viewerHandlers().handlers })
  expect(await screen.findByTestId('preview-not-found')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('preview-not-found')).not.toBeInTheDocument())
  await waitFor(() => expect(location()).toBe('/mail/1'))
})

test('메일 조회가 실패해 남은 ?preview 도 오류 안내와 함께 찾을 수 없음 안내', async () => {
  renderMail('/mail/1?messageId=13&preview=mail:7', {
    handlers: [...viewerHandlers().handlers, http.get('/api/v1/mail/messages/13', () => HttpResponse.json({ message: '없음' }, { status: 404 }))],
  })
  expect(await screen.findByText('메일을 불러오지 못했습니다')).toBeInTheDocument()
  expect(await screen.findByTestId('preview-not-found')).toBeInTheDocument()
})

// ── 변환 미리보기 404(mail-converted-preview, WP-432) ─────────────────────────────────────────────

const HWP_NAME = '2026년 언택트 AI R&D 과제기획 전담반 회의 참석안내.hwp'

/** 13번 메일(HWP 첨부 하나) — /preview 는 주어진 응답을 늘 돌려주고 요청을 기록한다. */
function hwpHandlers(id: number, preview: () => Response) {
  const previews = record('get', `/api/v1/mail/attachments/${id}/preview`, preview)
  const content = record('get', `/api/v1/mail/attachments/${id}/content`, () => new HttpResponse('HWP'))
  return {
    previews,
    content,
    handlers: [
      previews.handler,
      content.handler,
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary({ id: 13, subject: '문서 첨부' })])),
      http.get('/api/v1/mail/messages/13', () =>
        HttpResponse.json(
          detail({ id: 13, subject: '문서 첨부', attachments: [{ id, filename: HWP_NAME, contentType: 'application/x-hwp', sizeBytes: 48_128, contentId: null }] }),
        ),
      ),
    ],
  }
}

async function openHwp(id: number, handlers: NonNullable<Parameters<typeof renderMail>[1]>['handlers']) {
  const view = renderMail('/mail/1', { handlers })
  await view.user.click(await screen.findByTestId('mail-row-13'))
  await view.user.click(await screen.findByTestId(`mail-attachment-open-${id}`))
  expect(await screen.findByTestId('attachment-viewer')).toHaveAccessibleName(`${HWP_NAME} 미리보기`)
  return view
}

test('NOT_APPLICABLE 이 아닌 404(남의 첨부·없음)는 미지원 안내가 아니라 오류 화면이고, 다시 시도는 start=true 로 묻는다', async () => {
  const { previews, content, handlers } = hwpHandlers(44, () =>
    HttpResponse.json({ status: 404, error: 'Not Found', message: '파일을 찾을 수 없습니다' }, { status: 404 }),
  )
  const { user } = await openHwp(44, handlers)
  const error = await screen.findByTestId('preview-error', {}, { timeout: 5000 })
  expect(error).toHaveTextContent('미리보기를 불러오지 못했습니다.')
  expect(screen.queryByTestId('preview-unsupported')).not.toBeInTheDocument()
  expect(screen.queryByTestId('preview-converting')).not.toBeInTheDocument()
  expect(previews.calls[0].url.searchParams.get('start')).toBe('true')
  const before = previews.calls.length
  await user.click(within(error).getByRole('button', { name: '다시 시도' }))
  await waitFor(() => expect(previews.calls.length).toBeGreaterThan(before))
  expect(previews.last().url.searchParams.get('start')).toBe('true')
  expect(content.calls).toHaveLength(0)
})

test('NOT_APPLICABLE 404(변환 꺼짐·레거시 첨부)는 기존 미지원 안내', async () => {
  const { handlers } = hwpHandlers(45, () => HttpResponse.json({ status: 'NOT_APPLICABLE' }, { status: 404 }))
  await openHwp(45, handlers)
  expect(await screen.findByTestId('preview-unsupported', {}, { timeout: 5000 })).toBeInTheDocument()
  expect(screen.queryByTestId('preview-error')).not.toBeInTheDocument()
})
