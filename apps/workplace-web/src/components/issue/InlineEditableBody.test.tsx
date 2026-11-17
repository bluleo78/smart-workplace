// InlineEditableBody 컴포넌트 테스트(WP-1656) — 화면 테스트로 만들기 어려운 상태만 본다:
// 편집 중 권한이 없어졌을 때(disabled) 편집칸의 비활성 모양, 바깥 모달이 막은 Esc 가 업로드 중엔 편집을 닫지 않는 것,
// 입력칸 접근성 상태(5만 자 초과·비활성), 업로드 중 초안 자동 저장, \r\n 원문 저장.
// 저장·취소·초안·업로드 흐름 자체는 이슈 상세 페이지 테스트(issueDetailEdit·issueBodyImages)가 본다.
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { editorOf } from '@/test/kits/richEditor'
import { renderWithProviders } from '@/test/renderWithProviders'

import { InlineEditableBody } from './InlineEditableBody'

// 멤버 조회는 끊는다(멘션 후보 없음). 업로드는 기본으로 끝나지 않게 두어 「업로드 중」 상태를 만든다 — 끝내야 하는 테스트는 upload.next 를 바꾼다.
vi.mock('@/hooks/queries/useProjectMembers', () => ({ useProjectMembers: () => ({ data: [] }) }))
// 다 올린 이미지의 인증 요청은 끊고 고정 blob 주소를 준다.
vi.mock('@/hooks/queries/useApiBlobUrl', () => ({
  useApiBlobUrl: (path: string | null | undefined) => ({ url: path ? 'blob:fixed' : null, isError: false, blob: null }),
}))
const upload = vi.hoisted(() => ({
  next: (): Promise<{ url: string; name: string }> => new Promise(() => {}),
}))
vi.mock('@/api/issueImages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/issueImages')>()),
  uploadIssueImage: () => upload.next(),
}))

type Props = Parameters<typeof InlineEditableBody>[0]

/** 본문 「원본 본문」 의 편집기를 띄운다. */
function renderBody(props: Partial<Props> = {}) {
  const base: Props = {
    body: '원본 본문',
    onSave: vi.fn(async () => true),
    disabled: false,
    projectKey: 'WP',
    issueNumber: 1,
    ...props,
  }
  const view = renderWithProviders(<InlineEditableBody {...base} />)
  return { ...view, base }
}

/** 이 이슈(WP-1)의 로컬 초안 — 키의 사용자·워크스페이스 부분은 테스트 인증에 따르므로 끝(프로젝트·번호)으로 찾는다. */
function storedDraft(): string | null {
  const key = Object.keys(localStorage).find((k) => k.endsWith(':WP:1'))
  return key ? localStorage.getItem(key) : null
}

/** 초안 자동 저장(600ms 디바운스)이 지날 만큼 기다린다. */
async function passDraftDebounce() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700))
  })
}

/** 문서 캡처 단계에서 Esc 를 막는다 — 개인 작업 상세 모달(Radix onEscapeKeyDown 의 preventDefault)과 같은 자리. */
function blockEscapeAtDocument() {
  const block = (e: KeyboardEvent) => {
    if (e.key === 'Escape') e.preventDefault()
  }
  document.addEventListener('keydown', block, true)
  onTestFinished(() => document.removeEventListener('keydown', block, true))
}

describe('InlineEditableBody 편집칸', () => {
  it('편집 중 disabled 가 되면 편집칸이 흐려지고 입력이 막힌다(inert), 풀리면 원래 모양', async () => {
    const { base, rerender } = renderBody()
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    const frame = screen.getByTestId('issue-body-editor-frame')
    expect(frame).not.toHaveClass('opacity-50')
    expect(frame).not.toHaveAttribute('inert')

    rerender(<InlineEditableBody {...base} disabled />)
    expect(frame).toHaveClass('opacity-50', 'cursor-not-allowed')
    expect(frame).toHaveAttribute('inert')
    expect(frame).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('issue-body-save')).toBeDisabled()

    rerender(<InlineEditableBody {...base} />)
    expect(frame).not.toHaveClass('opacity-50')
  })

  it('편집 중 disabled 가 되면 입력칸 자체에 aria-disabled 가 달리고, 풀리면 빠진다', async () => {
    const { base, rerender } = renderBody()
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    const textbox = screen.getByTestId('issue-body-textarea')
    expect(textbox).not.toHaveAttribute('aria-disabled')
    rerender(<InlineEditableBody {...base} disabled />)
    expect(textbox).toHaveAttribute('aria-disabled', 'true')
    rerender(<InlineEditableBody {...base} />)
    expect(textbox).not.toHaveAttribute('aria-disabled')
  })

  it('5만 자를 넘으면 입력칸이 aria-invalid 이고 안내 문구를 가리킨다, 줄이면 빠진다', async () => {
    renderBody()
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    const textbox = screen.getByTestId('issue-body-textarea')
    expect(textbox).not.toHaveAttribute('aria-invalid')
    expect(textbox).not.toHaveAttribute('aria-describedby')
    act(() => {
      editorOf(textbox).commands.insertContentAt(1, 'a'.repeat(50_000))
    })
    expect(textbox).toHaveAttribute('aria-invalid', 'true')
    expect(textbox).toHaveAttribute('aria-describedby', 'issue-body-limit-error')
    expect(document.getElementById('issue-body-limit-error')).toBeInTheDocument()
    act(() => {
      editorOf(textbox).commands.deleteRange({ from: 1, to: 50_001 })
    })
    expect(textbox).not.toHaveAttribute('aria-invalid')
    expect(textbox).not.toHaveAttribute('aria-describedby')
  })

  it('최소 높이는 본문 모드 하나(min-h-40)만, 데스크톱 최대 높이는 70vh·모바일은 상한 없음', async () => {
    const { unmount } = renderBody()
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    const desktop = screen.getByTestId('issue-body-textarea')
    expect(desktop).toHaveClass('min-h-40', 'max-h-[70vh]')
    expect(desktop.className).not.toContain('min-h-[160px]')
    unmount()
    renderBody({ mobile: true })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    const mobile = screen.getByTestId('issue-body-textarea')
    expect(mobile).toHaveClass('min-h-40')
    expect(mobile.className).not.toMatch(/max-h-|min-h-\[160px\]/)
  })

  it('바깥이 막은 Esc — 업로드 중엔 편집을 닫지 않는다', async () => {
    blockEscapeAtDocument()
    renderBody()
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    const editor = screen.getByTestId('issue-body-textarea')
    await userEvent.upload(screen.getByTestId('issue-body-image-input'), new File(['x'], 'a.png', { type: 'image/png' }))
    expect(await screen.findByText('업로드 중…')).toBeInTheDocument()
    act(() => {
      fireEvent.keyDown(editor, { key: 'Escape' })
    })
    expect(screen.getByTestId('issue-body-textarea')).toBeInTheDocument()
  })

  it('바깥이 막은 Esc — 업로드가 없으면 편집을 취소한다', async () => {
    blockEscapeAtDocument()
    renderBody()
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    act(() => {
      fireEvent.keyDown(screen.getByTestId('issue-body-textarea'), { key: 'Escape' })
    })
    expect(screen.queryByTestId('issue-body-textarea')).not.toBeInTheDocument()
  })

  it('업로드 중엔 이미지가 빠진 원문으로 초안을 덮어쓰지 않고, 업로드가 끝나면 이미지가 든 원문으로 쓴다', async () => {
    let finish: (v: { url: string; name: string }) => void = () => {}
    upload.next = () => new Promise((resolve) => (finish = resolve))
    onTestFinished(() => {
      upload.next = () => new Promise(() => {})
    })
    renderBody()
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    const editor = editorOf(screen.getByTestId('issue-body-textarea'))
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' 수정')
    })
    await passDraftDebounce()
    expect(storedDraft()).toBe('원본 본문 수정')

    await userEvent.upload(screen.getByTestId('issue-body-image-input'), new File(['x'], 'a.png', { type: 'image/png' }))
    expect(await screen.findByText('업로드 중…')).toBeInTheDocument()
    await passDraftDebounce()
    expect(storedDraft()).toBe('원본 본문 수정')

    await act(async () => finish({ url: '/api/v1/projects/WP/issue-images/9', name: 'a.png' }))
    await passDraftDebounce()
    expect(storedDraft()).toBe('원본 본문 수정\n![a.png](/api/v1/projects/WP/issue-images/9)\n')
  })

  // PR #1413 리뷰: 불러오기는 편집칸을 새로 만들어 올리던 이미지가 안내 없이 사라진다 — 저장·취소처럼 업로드 중엔 막는다.
  it('업로드 중엔 초안 배너의 「불러오기」가 막히고 올리던 이미지가 그대로 남는다', async () => {
    // 먼저 초안을 남겨 둔다(편집 → 고침 → 자동 저장 → 화면을 닫음).
    const first = renderBody()
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    const firstEditor = editorOf(screen.getByTestId('issue-body-textarea'))
    act(() => {
      firstEditor.commands.insertContentAt(firstEditor.state.doc.content.size - 1, ' 초안')
    })
    await passDraftDebounce()
    expect(storedDraft()).toBe('원본 본문 초안')
    first.unmount()

    renderBody()
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    const restore = screen.getByTestId('issue-body-draft-restore')
    expect(restore).toBeEnabled()
    await userEvent.upload(screen.getByTestId('issue-body-image-input'), new File(['x'], 'a.png', { type: 'image/png' }))
    expect(await screen.findByText('업로드 중…')).toBeInTheDocument()
    expect(restore).toBeDisabled()
    act(() => {
      fireEvent.click(restore)
    })
    expect(screen.getByText('업로드 중…')).toBeInTheDocument()
    expect(screen.getByTestId('issue-body-draft-banner')).toBeInTheDocument()
  })

  it('저장이 실패하면 고친 원문 그대로 편집칸이 다시 열린다', async () => {
    const { base } = renderBody({ onSave: vi.fn(async () => false) })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    const editor = editorOf(screen.getByTestId('issue-body-textarea'))
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' 수정')
    })
    await userEvent.click(screen.getByTestId('issue-body-save'))
    expect(base.onSave).toHaveBeenCalledWith('원본 본문 수정')
    const reopened = await screen.findByTestId('issue-body-textarea')
    expect(editorOf(reopened).state.doc.textContent).toBe('원본 본문 수정')
  })

  it('\\r\\n 원문을 열고 그대로 저장하면(버튼·Ctrl+Enter) 저장 요청이 없다', async () => {
    const { base } = renderBody({ body: '첫 줄\r\n둘째' })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    act(() => {
      fireEvent.keyDown(screen.getByTestId('issue-body-textarea'), { key: 'Enter', ctrlKey: true })
    })
    expect(screen.queryByTestId('issue-body-textarea')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    await userEvent.click(screen.getByTestId('issue-body-save'))
    expect(base.onSave).not.toHaveBeenCalled()
  })

  it('\\r\\n 원문의 한 글자를 고쳐 저장하면 \\n 줄 + 그 글자다(공백이 끼지 않는다)', async () => {
    const { base } = renderBody({ body: '첫 줄\r\n둘째' })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    const textbox = screen.getByTestId('issue-body-textarea')
    act(() => {
      editorOf(textbox).commands.insertContentAt(4, '!') // 「첫 줄」 끝
    })
    await userEvent.click(screen.getByTestId('issue-body-save'))
    expect(base.onSave).toHaveBeenCalledWith('첫 줄!\n둘째')
  })
})
