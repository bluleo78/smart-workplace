// 이슈 만들기 창 본문 칸(WP-1657) — 화면 테스트. 데스크톱 다이얼로그·모바일 시트의 본문 칸이 본문 모드 RichInput(칸 안 이미지)이 된 뒤에도
// 보내는 본문이 다듬지 않은 원문(앞뒤 공백·빈 줄·![이름](url))인지, 업로드 중 생성 막기·버림 확인, Cmd+Enter 제출, Esc 의 멘션 팝업 우선,
// 다시 열면 빈 칸, AI 제안이 칸 원문을 보내는지, 모바일 제목 Enter → 본문 포커스를 본다.
// 모바일은 뷰포트를 바꾸지 않고(한 파일 = 뷰포트 하나, src/test/viewport.ts) 시트(MobileIssueCreateSheet)를 바로 띄운다.
// 실제 키 입력·클립보드·390px 가로 넘침은 E2E(@input·@layout)가 본다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { memberKeys } from '@/hooks/queries/useProjectMembers'
import { IssueCreateDialog } from '@/pages/projects/components/IssueCreateDialog'
import { MobileIssueCreateSheet } from '@/pages/projects/components/mobile/MobileIssueCreateSheet'
import { renderMobileScreen } from '@/test/kits/mobile/mobileScreen'
import { editorOf } from '@/test/kits/richEditor'
import { renderScreen } from '@/test/renderScreen'

import { createIssue } from '../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import { seedStatuses } from '../../../e2e/factories/projectStatus.factory'

// 다 올린 이미지의 인증 요청은 끊고 고정 blob 주소를 준다 — 칸 안 <img> 가 그려진 상태를 보려고.
vi.mock('@/hooks/queries/useApiBlobUrl', () => ({
  useApiBlobUrl: (path: string | null | undefined) => ({ url: path ? 'blob:fixed' : null, isError: false, blob: null }),
}))
// 업로드는 기본으로 끝나지 않게 두어 「업로드 중」 상태를 만든다 — 끝내야 하는 테스트는 upload.next 를 바꾼다.
const upload = vi.hoisted(() => ({
  next: (): Promise<{ url: string; name: string }> => new Promise(() => {}),
}))
vi.mock('@/api/issueImages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/issueImages')>()),
  uploadIssueImage: () => upload.next(),
}))

const KEY = 'WP'
const IMG_URL = `/api/v1/projects/${KEY}/issue-images/7`
const MEMBERS = [{ userId: 7, username: 'kim', name: '김개발', kind: 'HUMAN' }]

/** 이 테스트에서 업로드가 바로 끝나게(url·이름) 한다 — 끝나면 다시 끝나지 않는 업로드로 돌린다. */
function uploadsFinishWith(result: { url: string; name: string }) {
  upload.next = () => Promise.resolve(result)
  onTestFinished(() => {
    upload.next = () => new Promise(() => {})
  })
}

/** 만들기 창이 부르는 API — POST 생성·AI 분류 요청 본문은 posts·classified 에 쌓는다. */
function createApi() {
  const posts: Record<string, unknown>[] = []
  const classified: Record<string, unknown>[] = []
  const handlers = [
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY }))),
    http.get(`/api/v1/projects/${KEY}/statuses`, () => HttpResponse.json(seedStatuses())),
    http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
    http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json(MEMBERS)),
    http.get(`/api/v1/projects/${KEY}/components`, () => HttpResponse.json([])),
    http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
    http.post(`/api/v1/projects/${KEY}/issues`, async ({ request }) => {
      posts.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json(createIssue({ id: 99, number: 99, projectKey: KEY, title: 'new' }), { status: 201 })
    }),
    http.post(`/api/v1/projects/${KEY}/issues/ai-classify`, async ({ request }) => {
      classified.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json({ type: 'BUG', priority: 'HIGH', reason: '버그로 보임', labels: [] })
    }),
  ]
  return { handlers, posts, classified }
}

/** 편집칸에 일반 글자를 붙여넣는다(본문 모드 붙여넣기 — 줄 단위 그대로). */
function pasteText(el: HTMLElement, text: string) {
  const clipboardData = {
    getData: (type: string) => (type === 'text/plain' ? text : ''),
    types: ['text/plain'],
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
  }
  act(() => {
    fireEvent.paste(el, { clipboardData })
  })
}

/** 편집칸에 이미지 파일만 붙여넣는다(스크린샷 붙여넣기). */
function pasteImage(el: HTMLElement, file: File) {
  const clipboardData = {
    getData: () => '',
    types: ['Files'],
    files: [file] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
  }
  act(() => {
    fireEvent.paste(el, { clipboardData })
  })
}

/** 편집칸 끝에 글자를 넣고 멘션 제안이 돌 틈을 준다. */
async function typeAtEnd(editor: Editor, text: string) {
  await act(async () => {
    editor.commands.focus('end')
    editor.commands.insertContent(text)
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
}

/** 멘션 팝업이 보이지 않는다 — 없거나(닫혀 내려감) tippy 가 숨겼다(jsdom 은 전환 끝 이벤트가 없어 숨긴 채 남는다). */
function expectMentionPopupHidden() {
  const popup = screen.queryByTestId('chat-mention-popover')
  if (popup) expect(popup).not.toBeVisible()
}

const png = (name = 'a.png') => new File(['x'], name, { type: 'image/png' })

/** 데스크톱 만들기 창 — 닫힌 뒤 「다시 열기」로 다시 연다(만든 뒤 다시 열면 빈 칸인지 보려고). */
function DesktopHarness() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        다시 열기
      </button>
      <IssueCreateDialog projectKey={KEY} open={open} onOpenChange={setOpen} />
    </>
  )
}

/** 데스크톱 만들기 창을 띄운다(jsdom 은 matchMedia 가 없어 데스크톱 폭). */
async function openDesktop() {
  const api = createApi()
  const view = renderScreen(<DesktopHarness />, { path: `/projects/${KEY}`, handlers: api.handlers })
  const dialog = await screen.findByRole('dialog')
  const title = document.getElementById('issue-title') as HTMLInputElement
  const body = () => screen.getByTestId('issue-body')
  return { ...view, api, dialog, title, body }
}

describe('데스크톱 만들기 창 본문 칸', () => {
  it('제목과 여러 줄 본문(앞뒤 공백·빈 줄 포함)을 그대로 보낸다', async () => {
    const { user, api, title, body } = await openDesktop()
    fireEvent.change(title, { target: { value: '여러 줄' } })
    pasteText(body(), '  첫 줄\n\n둘째 줄  ')
    await user.click(screen.getByRole('button', { name: '생성' }))
    await waitFor(() => expect(api.posts).toHaveLength(1))
    expect(api.posts[0].body).toBe('  첫 줄\n\n둘째 줄  ')
  })

  it('「이미지」 버튼으로 넣은 이미지가 끝나면 본문에 ![이름](url) 로 간다', async () => {
    uploadsFinishWith({ url: IMG_URL, name: 'a.png' })
    const { user, api, title, body } = await openDesktop()
    fireEvent.change(title, { target: { value: '이미지' } })
    await user.upload(screen.getByTestId('issue-body-image-input'), png())
    await waitFor(() => expect(body().querySelector('img')).not.toBeNull())
    await user.click(screen.getByRole('button', { name: '생성' }))
    await waitFor(() => expect(api.posts).toHaveLength(1))
    expect(api.posts[0].body).toContain(`![a.png](${IMG_URL})`)
  })

  it('업로드 중에는 생성 버튼이 잠기고, 폼 제출(Enter)도 토스트로 막는다', async () => {
    const { user, api, title } = await openDesktop()
    fireEvent.change(title, { target: { value: '업로드 중' } })
    await user.upload(screen.getByTestId('issue-body-image-input'), png())
    await waitFor(() => expect(screen.getByRole('button', { name: '생성' })).toBeDisabled())
    // 잠긴 버튼을 돌아가는 제출(제목 칸 Enter 등) — 폼 submit 이 훅의 마지막 막기에 걸린다.
    act(() => {
      fireEvent.submit(title.closest('form')!)
    })
    expect(await screen.findByText('이미지 업로드가 끝난 뒤 등록해 주세요')).toBeInTheDocument()
    expect(api.posts).toHaveLength(0)
  })

  it('글자 없이 이미지 업로드 중에 취소하면 버림 확인이 뜬다', async () => {
    const { user } = await openDesktop()
    await user.upload(screen.getByTestId('issue-body-image-input'), png())
    await waitFor(() => expect(screen.getByRole('button', { name: '생성' })).toBeDisabled())
    await user.click(screen.getByRole('button', { name: '취소' }))
    expect(await screen.findByTestId('issue-create-discard-dialog')).toBeInTheDocument()
  })

  it('Cmd+Enter 는 폼 제출', async () => {
    const { api, title, body } = await openDesktop()
    fireEvent.change(title, { target: { value: '단축키' } })
    pasteText(body(), '본문')
    act(() => {
      fireEvent.keyDown(body(), { key: 'Enter', metaKey: true })
    })
    await waitFor(() => expect(api.posts).toHaveLength(1))
    expect(api.posts[0]).toMatchObject({ title: '단축키', body: '본문' })
  })

  it('편집칸 Esc — 멘션 팝업이 열려 있으면 팝업만 닫고 창은 그대로, 다음 Esc 는 닫기 요청', async () => {
    const { queryClient, body } = await openDesktop()
    await waitFor(() => expect(queryClient.getQueryData(memberKeys.all(KEY))).toBeDefined())
    await typeAtEnd(editorOf(body()), '@김')
    expect(screen.getByTestId('chat-mention-popover')).toBeVisible()
    act(() => {
      fireEvent.keyDown(body(), { key: 'Escape' })
    })
    expectMentionPopupHidden()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-create-discard-dialog')).not.toBeInTheDocument()
    act(() => {
      fireEvent.keyDown(body(), { key: 'Escape' })
    })
    expect(await screen.findByTestId('issue-create-discard-dialog')).toBeInTheDocument()
  })

  it('만들고 다시 열면 본문 칸이 비어 있다', async () => {
    const { user, api, title, body } = await openDesktop()
    fireEvent.change(title, { target: { value: '한 번' } })
    pasteText(body(), '지난 본문')
    await user.click(screen.getByRole('button', { name: '생성' }))
    await waitFor(() => expect(api.posts).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '다시 열기' }))
    await screen.findByRole('dialog')
    expect(editorOf(body()).state.doc.textContent).toBe('')
  })

  // 리뷰에서 찾은 회귀 — 지난 본문 값이 폼에 남아 다시 연 창에서 제목만 넣고 만들어도 지난 본문이 함께 나갔다.
  it('본문을 넣어 만든 뒤 다시 열어 제목만 넣고 만들면 본문 없이 보낸다', async () => {
    const { user, api, title, body } = await openDesktop()
    fireEvent.change(title, { target: { value: '첫 이슈' } })
    pasteText(body(), '지난 본문')
    await user.click(screen.getByRole('button', { name: '생성' }))
    await waitFor(() => expect(api.posts).toHaveLength(1))
    expect(api.posts[0].body).toBe('지난 본문')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '다시 열기' }))
    await screen.findByRole('dialog')
    const reopenedTitle = document.getElementById('issue-title') as HTMLInputElement
    fireEvent.change(reopenedTitle, { target: { value: '둘째 이슈' } })
    await user.click(screen.getByRole('button', { name: '생성' }))
    await waitFor(() => expect(api.posts).toHaveLength(2))
    expect(api.posts[1].title).toBe('둘째 이슈')
    expect(api.posts[1].body).toBeUndefined()
  })

  it('본문을 넣고 버린 뒤 다시 열면 빈 창이라 취소가 확인 없이 닫힌다', async () => {
    const { user, body } = await openDesktop()
    pasteText(body(), '버릴 본문')
    await user.click(screen.getByRole('button', { name: '취소' }))
    await user.click(await screen.findByTestId('issue-create-discard-confirm'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '다시 열기' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByTestId('issue-create-discard-dialog')).not.toBeInTheDocument()
  })

  it('본문만 5만 자를 넘겨 제출이 막히면 포커스가 본문 편집칸으로 간다(옛 Textarea 처럼)', async () => {
    const { user, api, title, body } = await openDesktop()
    fireEvent.change(title, { target: { value: '긴 본문' } })
    pasteText(body(), 'a'.repeat(50001))
    await user.click(screen.getByRole('button', { name: '생성' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await waitFor(() => expect(body().contains(document.activeElement)).toBe(true))
    expect(api.posts).toHaveLength(0)
  })

  it('제목과 본문이 모두 틀리면 포커스는 위에 있는 제목 칸으로 간다', async () => {
    const { user, title, body } = await openDesktop()
    pasteText(body(), 'a'.repeat(50001))
    await user.click(screen.getByRole('button', { name: '생성' }))
    await screen.findAllByRole('alert')
    await waitFor(() => expect(document.activeElement).toBe(title))
  })

  it('본문과 날짜가 함께 틀리면 포커스는 위에 있는 본문 편집칸으로 간다', async () => {
    const { user, title, body } = await openDesktop()
    fireEvent.change(title, { target: { value: '날짜와 본문' } })
    pasteText(body(), 'a'.repeat(50001))
    // 시작일 > 마감일 — 시작일 칸 오류(본문 칸보다 아래).
    fireEvent.change(document.getElementById('issue-start')!, { target: { value: '2026-07-10' } })
    fireEvent.change(document.getElementById('issue-due')!, { target: { value: '2026-07-01' } })
    await user.click(screen.getByRole('button', { name: '생성' }))
    expect(await screen.findByText('시작일은 마감일보다 늦을 수 없습니다')).toBeInTheDocument()
    await waitFor(() => expect(body().contains(document.activeElement)).toBe(true))
  })

  it('AI 제안 받기는 편집칸 본문을 보낸다', async () => {
    const { user, api, title, body } = await openDesktop()
    fireEvent.change(title, { target: { value: '결제 오류' } })
    pasteText(body(), '  재현 절차\n1. 누른다')
    await user.click(screen.getByTestId('ai-classify-btn'))
    await waitFor(() => expect(api.classified).toHaveLength(1))
    expect(api.classified[0]).toEqual({ title: '결제 오류', body: '  재현 절차\n1. 누른다' })
  })
})

/** 모바일 만들기 시트를 바로 띄운다 — 「＋」가 여는 것과 같은 props. */
async function openMobile() {
  const api = createApi()
  const onOpenChange = vi.fn()
  const view = renderMobileScreen(<MobileIssueCreateSheet projectKey={KEY} open onOpenChange={onOpenChange} />, {
    path: `/projects/${KEY}`,
    handlers: api.handlers,
  })
  const sheet = await screen.findByTestId('issue-create-sheet')
  const title = screen.getByTestId('issue-create-title')
  const body = () => screen.getByTestId('issue-create-body')
  return { ...view, api, sheet, title, body, onOpenChange }
}

describe('모바일 만들기 시트 본문 칸', () => {
  it('제목 Enter 는 본문 편집칸으로 포커스를 옮긴다', async () => {
    const { title, body } = await openMobile()
    title.focus()
    act(() => {
      fireEvent.keyDown(title, { key: 'Enter' })
    })
    await waitFor(() => expect(body().contains(document.activeElement)).toBe(true))
  })

  it('편집칸 Esc — 멘션 팝업만 닫고, 팝업이 없으면 내용이 있을 때 버림 확인', async () => {
    const { queryClient, body, onOpenChange } = await openMobile()
    await waitFor(() => expect(queryClient.getQueryData(memberKeys.all(KEY))).toBeDefined())
    await typeAtEnd(editorOf(body()), '@김')
    expect(screen.getByTestId('chat-mention-popover')).toBeVisible()
    act(() => {
      fireEvent.keyDown(body(), { key: 'Escape' })
    })
    expectMentionPopupHidden()
    expect(screen.getByTestId('issue-create-sheet')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-create-discard-dialog')).not.toBeInTheDocument()
    act(() => {
      fireEvent.keyDown(body(), { key: 'Escape' })
    })
    expect(await screen.findByTestId('issue-create-discard-dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('본문에 넣은 이미지가 끝나면 POST 본문에 ![이름](url)', async () => {
    uploadsFinishWith({ url: IMG_URL, name: 'shot.png' })
    const { user, api, title, body } = await openMobile()
    fireEvent.change(title, { target: { value: '스크린샷' } })
    pasteImage(body(), png('shot.png'))
    await waitFor(() => expect(within(body()).getByRole('img')).toBeInTheDocument())
    await user.click(screen.getByTestId('issue-create-submit'))
    await waitFor(() => expect(api.posts).toHaveLength(1))
    expect(api.posts[0].body).toContain(`![shot.png](${IMG_URL})`)
  })
})
