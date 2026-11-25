// InlineEditableBody 컴포넌트 테스트(WP-1656) — 화면 테스트로 만들기 어려운 상태만 본다:
// 편집 중 권한이 없어졌을 때(disabled) 편집칸의 비활성 모양, 바깥 모달이 막은 Esc 가 업로드 중엔 편집을 닫지 않는 것,
// 입력칸 접근성 상태(5만 자 초과·비활성), 업로드 중 초안 자동 저장, \r\n 원문 저장.
// 저장·취소·초안·업로드 흐름 자체는 이슈 상세 페이지 테스트(issueDetailEdit·issueBodyImages)가 본다.
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { readIssueBodyDraftEntry } from '@/lib/issueBodyDraft'
import { ISSUE_BODY_MAX_LENGTH } from '@/lib/validations/issue'
import { editorOf } from '@/test/kits/richEditor'
import { renderWithProviders } from '@/test/renderWithProviders'

import { bodySaveBlock } from './bodySaveBlock'
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
  return key ? (readIssueBodyDraftEntry(key)?.text ?? null) : null
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

describe('InlineEditableBody 충돌 안내(WP-2095)', () => {
  const conflict = { latest: '남의 최신 본문', latestVersion: 9 }

  it('conflict 가 있으면 안내가 보이고 [최신 본문으로 다시 쓰기] 뒤 편집칸이 최신 값이며 내 글이 초안 저장소에 남는다', async () => {
    const onTakeLatest = vi.fn(() => '남의 최신 본문')
    renderBody({ conflict, onTakeLatest })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    expect(screen.getByTestId('issue-edit-conflict-body')).toBeInTheDocument()
    act(() => {
      const editor = editorOf(screen.getByTestId('issue-body-textarea'))
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' 내 글')
    })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-body-take-latest'))
    expect(onTakeLatest).toHaveBeenCalledTimes(1)
    const reopened = await screen.findByTestId('issue-body-textarea')
    expect(editorOf(reopened).state.doc.textContent).toBe('남의 최신 본문')
    expect(storedDraft()).toBe('원본 본문 내 글')
    // 600ms 디바운스가 지나도 최신 값이 내 글 초안을 덮어쓰지 않는다.
    await passDraftDebounce()
    expect(storedDraft()).toBe('원본 본문 내 글')
    expect(screen.getByTestId('issue-body-draft-banner')).toBeInTheDocument()
  })

  it('최신 본문으로 다시 쓴 뒤 글자를 고쳐도 디바운스가 지나면 내 글 초안이 그대로 남는다', async () => {
    const onTakeLatest = vi.fn(() => '남의 최신 본문')
    renderBody({ conflict, onTakeLatest })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    act(() => {
      const editor = editorOf(screen.getByTestId('issue-body-textarea'))
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' 내 글')
    })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-body-take-latest'))
    // 최신 본문에 내 글을 붙여 넣는 흐름 — 한 글자라도 고치면 draft 가 최신 값과 달라진다.
    act(() => {
      const editor = editorOf(screen.getByTestId('issue-body-textarea'))
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' 보탠 글')
    })
    await passDraftDebounce()
    // 배너가 떠 있는 동안은 자동 저장이 멈춰 [불러오기] 가 처음 내 글을 되살린다.
    expect(storedDraft()).toBe('원본 본문 내 글')
    await userEvent.click(screen.getByTestId('issue-body-draft-restore'))
    expect(editorOf(await screen.findByTestId('issue-body-textarea')).state.doc.textContent).toBe('원본 본문 내 글')
  })

  // 코드 리뷰 지적 2 — 다시 쓰기 뒤 바뀐 것 없이 저장·취소하면 배너가 되살리겠다던 내 글 초안을 지우던 문제.
  // 서버 본문이 이미 최신으로 바뀐 상황(body prop = 최신 값)이라 다시 쓴 편집칸 그대로 저장하면 「바뀐 것 없음」 분기로 간다.
  it('최신 본문으로 다시 쓴 뒤 바꾸지 않고 저장해도 내 글 초안이 남는다', async () => {
    const { base, rerender } = renderBody({ conflict, onTakeLatest: vi.fn(() => '원본 본문') })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    act(() => {
      const editor = editorOf(screen.getByTestId('issue-body-textarea'))
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' 내 글')
    })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-body-take-latest'))
    expect(screen.getByTestId('issue-body-draft-banner')).toBeInTheDocument()
    // 실제 화면은 다시 쓰기로 충돌이 지워진다 — 그 상태에서 저장한다.
    rerender(<InlineEditableBody {...base} conflict={null} />)
    await userEvent.click(screen.getByTestId('issue-body-save'))
    expect(base.onSave).not.toHaveBeenCalled()
    expect(storedDraft()).toBe('원본 본문 내 글')
    // 다시 들어가면 초안 배너로 내 글을 되살릴 수 있다.
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    await userEvent.click(screen.getByTestId('issue-body-draft-restore'))
    expect(editorOf(await screen.findByTestId('issue-body-textarea')).state.doc.textContent).toBe('원본 본문 내 글')
  })

  it('최신 본문으로 다시 쓴 뒤 취소해도 내 글 초안이 남는다', async () => {
    renderBody({ conflict, onTakeLatest: vi.fn(() => '남의 최신 본문') })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    act(() => {
      const editor = editorOf(screen.getByTestId('issue-body-textarea'))
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' 내 글')
    })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-body-take-latest'))
    await userEvent.click(screen.getByTestId('issue-body-cancel'))
    expect(storedDraft()).toBe('원본 본문 내 글')
  })

  it('최신 본문으로 다시 쓴 편집칸을 고쳐 저장해도 내 글 초안을 덮어쓰거나 지우지 않는다', async () => {
    const { base, rerender } = renderBody({ conflict, onTakeLatest: vi.fn(() => '남의 최신 본문') })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    act(() => {
      const editor = editorOf(screen.getByTestId('issue-body-textarea'))
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' 내 글')
    })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-body-take-latest'))
    rerender(<InlineEditableBody {...base} conflict={null} />)
    await userEvent.click(screen.getByTestId('issue-body-save'))
    expect(base.onSave).toHaveBeenCalledWith('남의 최신 본문')
    expect(storedDraft()).toBe('원본 본문 내 글')
  })

  it('초안 배너를 [버리기] 한 뒤 취소하면 초안이 남지 않는다(평소 취소와 같다)', async () => {
    renderBody({ conflict, onTakeLatest: vi.fn(() => '남의 최신 본문') })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    act(() => {
      const editor = editorOf(screen.getByTestId('issue-body-textarea'))
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' 내 글')
    })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-body-take-latest'))
    await userEvent.click(screen.getByTestId('issue-body-draft-discard'))
    await userEvent.click(screen.getByTestId('issue-body-cancel'))
    expect(storedDraft()).toBeNull()
  })

  it('onTakeLatest 가 null 을 돌려주면 편집칸과 초안을 그대로 둔다', async () => {
    renderBody({ conflict, onTakeLatest: vi.fn(() => null) })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    act(() => {
      const editor = editorOf(screen.getByTestId('issue-body-textarea'))
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' 내 글')
    })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-body-take-latest'))
    expect(editorOf(screen.getByTestId('issue-body-textarea')).state.doc.textContent).toBe('원본 본문 내 글')
    expect(screen.queryByTestId('issue-body-draft-banner')).not.toBeInTheDocument()
  })

  it('덮어쓰기 확인 → onOverwrite 뒤 onSave(내 글) 를 부른다', async () => {
    const calls: string[] = []
    const onOverwrite = vi.fn(() => calls.push('overwrite'))
    const onSave = vi.fn(async () => {
      calls.push('save')
      return true
    })
    renderBody({ conflict, onOverwrite, onSave })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    act(() => {
      const editor = editorOf(screen.getByTestId('issue-body-textarea'))
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' 내 글')
    })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-body-overwrite'))
    expect(onSave).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: '덮어쓰기' }))
    expect(onSave).toHaveBeenCalledWith('원본 본문 내 글')
    expect(calls).toEqual(['overwrite', 'save'])
  })

  it('덮어쓰기 확인 뒤 길이 초과면 onOverwrite·onSave 를 부르지 않고 충돌 안내가 남는다', async () => {
    const onOverwrite = vi.fn()
    const onSave = vi.fn(async () => true)
    renderBody({ conflict, onOverwrite, onSave })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    act(() => {
      const editor = editorOf(screen.getByTestId('issue-body-textarea'))
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, 'x'.repeat(ISSUE_BODY_MAX_LENGTH + 1))
    })
    await userEvent.click(screen.getByTestId('issue-edit-conflict-body-overwrite'))
    await userEvent.click(await screen.findByRole('button', { name: '덮어쓰기' }))
    expect(onOverwrite).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('issue-edit-conflict-body')).toBeInTheDocument()
  })

  it('bodySaveBlock 판정 표', () => {
    const body = '원본'
    expect(bodySaveBlock('새 글', { uploading: true, body })).toBe('uploading')
    expect(bodySaveBlock('x'.repeat(ISSUE_BODY_MAX_LENGTH + 1), { uploading: false, body })).toBe('too-long')
    expect(bodySaveBlock('![업로드 중… #1](x)', { uploading: false, body })).toBe('pending-token')
    expect(bodySaveBlock('원본', { uploading: false, body })).toBe('unchanged')
    expect(bodySaveBlock('새 글', { uploading: false, body })).toBeNull()
    expect(bodySaveBlock('', { uploading: false, body: null })).toBe('unchanged')
  })

  it('편집 중 그사이 바뀜은 최신 값 보기만 있는 안내를 띄운다', async () => {
    renderBody({ changedWhileEditing: { latest: '남의 새 본문' } })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    expect(screen.getByTestId('issue-edit-stale-body')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-edit-conflict-body')).not.toBeInTheDocument()
  })

  it('취소·저장 성공은 onEditEnd 를 부르고, 저장 실패는 부르지 않는다', async () => {
    const onEditEnd = vi.fn()
    const onSave = vi.fn(async () => false)
    renderBody({ onEditEnd, onSave })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    act(() => {
      editorOf(screen.getByTestId('issue-body-textarea')).commands.insertContentAt(editorOf(screen.getByTestId('issue-body-textarea')).state.doc.content.size - 1, '!')
    })
    await userEvent.click(screen.getByTestId('issue-body-save'))
    await screen.findByTestId('issue-body-textarea')
    expect(onEditEnd).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('issue-body-cancel'))
    expect(onEditEnd).toHaveBeenCalledTimes(1)
  })
})

/** 이 이슈의 로컬 초안을 직접 쓴다 — 키는 이미 저장된 초안의 키를 따른다. */
function writeDraftForTest(value: string) {
  const key = Object.keys(localStorage).find((k) => k.endsWith(':WP:1'))
  if (key) localStorage.setItem(key, value)
}

describe('InlineEditableBody 초안 기준 version(WP-2095)', () => {
  const type = (t: string) =>
    act(() => {
      const editor = editorOf(screen.getByTestId('issue-body-textarea'))
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, t)
    })
  const edit = () => userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
  const restore = async () => userEvent.click(await screen.findByTestId('issue-body-draft-restore'))

  /** 기준 version 으로 초안을 남기고(자동 저장) 편집칸을 닫지 않은 채 화면을 내린다. */
  async function leaveDraft(base: number) {
    const view = renderBody({ draftBaseVersion: () => base, currentVersion: base })
    await edit()
    type(' 내 글')
    await passDraftDebounce()
    view.unmount()
  }

  it('(a) 초안 기준 version 과 지금 version 이 같으면 되살려도 충돌을 다시 열지 않는다', async () => {
    await leaveDraft(7)
    const onRestoreMine = vi.fn()
    renderBody({ currentVersion: 7, onRestoreMine })
    await edit()
    await restore()
    expect(onRestoreMine).not.toHaveBeenCalled()
  })

  it('(f) 상태 등 다른 필드만 바뀌어 version 만 오르고 본문은 그대로면 되살려도 충돌을 열지 않는다', async () => {
    await leaveDraft(5)
    const onRestoreMine = vi.fn()
    renderBody({ currentVersion: 7, onRestoreMine })
    await edit()
    await restore()
    expect(onRestoreMine).not.toHaveBeenCalled()
  })

  it('(b) 초안 기준 version 이 지금보다 낮고 글이 본문과 다르면 지금 본문으로 한 번 불린다', async () => {
    await leaveDraft(5)
    const onRestoreMine = vi.fn()
    renderBody({ body: '남이 바꾼 본문', currentVersion: 7, onRestoreMine })
    await edit()
    await restore()
    expect(onRestoreMine).toHaveBeenCalledTimes(1)
    expect(onRestoreMine).toHaveBeenCalledWith('남이 바꾼 본문')
  })

  /** 충돌 → [최신 본문으로 다시 쓰기](기준이 5→9 로 옮겨짐) 까지 — 내 글 초안은 옮기기 전 기준 5 로 남아야 한다. */
  async function takeLatestFrom5(onRestoreMine: () => void) {
    let v = 5
    const props: Partial<Props> = {
      conflict: { latest: '남의 최신 본문', latestVersion: 9 },
      draftBaseVersion: () => v,
      onTakeLatest: () => {
        v = 9
        return '남의 최신 본문'
      },
      onRestoreMine,
    }
    const view = renderBody({ ...props, currentVersion: 5 })
    await edit()
    type(' 내 글')
    await userEvent.click(screen.getByTestId('issue-edit-conflict-body-take-latest'))
    await screen.findByTestId('issue-body-draft-banner')
    return { view, props }
  }

  it('(c) 다시 쓰기 → 취소 → 다시 편집 → [불러오기] 하면 충돌을 다시 연다(기준 5 로 저장됨)', async () => {
    const onRestoreMine = vi.fn()
    const { view, props } = await takeLatestFrom5(onRestoreMine)
    await userEvent.click(screen.getByTestId('issue-body-cancel'))
    view.rerender(<InlineEditableBody {...view.base} {...props} conflict={null} currentVersion={9} body="남의 최신 본문" />)
    await edit()
    await restore()
    expect(onRestoreMine).toHaveBeenCalledTimes(1)
    expect(onRestoreMine).toHaveBeenCalledWith('남의 최신 본문')
  })

  it('(d) 다시 쓴 최신 본문을 저장 성공한 뒤 다시 편집해 [불러오기] 해도 충돌을 다시 연다', async () => {
    const onRestoreMine = vi.fn()
    const { view, props } = await takeLatestFrom5(onRestoreMine)
    view.rerender(<InlineEditableBody {...view.base} {...props} conflict={null} currentVersion={9} body="남의 최신 본문" />)
    type('!')
    await userEvent.click(screen.getByTestId('issue-body-save'))
    await screen.findByRole('button', { name: '본문 편집' })
    view.rerender(<InlineEditableBody {...view.base} {...props} conflict={null} currentVersion={10} body="남의 최신 본문!" />)
    await edit()
    await restore()
    expect(onRestoreMine).toHaveBeenCalledTimes(1)
  })

  it('(e) 되살려 충돌이 다시 열린 동안 자동 저장해도 초안 기준은 올라가지 않아 떠났다 돌아와 불러오면 또 충돌이 열린다', async () => {
    await leaveDraft(5)
    const first = vi.fn()
    // 지금 version 7 — 훅의 기준도 편집 진입 때 7 로 고정돼 있다.
    const view = renderBody({ body: '남이 바꾼 본문', currentVersion: 7, draftBaseVersion: () => 7, onRestoreMine: first })
    await edit()
    await restore()
    expect(first).toHaveBeenCalledTimes(1)
    // 충돌을 풀지 않은 채 자동 저장이 돈다.
    await passDraftDebounce()
    view.unmount()
    const second = vi.fn()
    renderBody({ body: '남이 바꾼 본문', currentVersion: 7, draftBaseVersion: () => 7, onRestoreMine: second })
    await edit()
    await restore()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('InlineEditableBody 되살린 내 글 저장(WP-2095)', () => {
  const conflict = { latest: '남의 최신 본문', latestVersion: 9 }
  const type = (t: string) =>
    act(() => {
      const editor = editorOf(screen.getByTestId('issue-body-textarea'))
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, t)
    })
  /** 내 글을 쓰고 [최신으로 다시 쓰기] 로 초안을 남긴 상태까지. */
  async function takeLatest(props: Partial<Props>) {
    const view = renderBody({ conflict, onTakeLatest: () => '남의 최신 본문', ...props })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    type(' 내 글')
    await userEvent.click(screen.getByTestId('issue-edit-conflict-body-take-latest'))
    await screen.findByTestId('issue-body-draft-banner')
    return view
  }

  it('초안 [불러오기] 로 최신 값과 다른 내 글을 되살리면 onRestoreMine 이 받은 최신 값으로 불린다', async () => {
    const onRestoreMine = vi.fn()
    await takeLatest({ onRestoreMine })
    await userEvent.click(screen.getByTestId('issue-body-draft-restore'))
    expect(onRestoreMine).toHaveBeenCalledTimes(1)
    expect(onRestoreMine).toHaveBeenCalledWith('남의 최신 본문')
  })

  it('되살린 내 글이 최신 값과 같으면 onRestoreMine 을 부르지 않는다', async () => {
    const onRestoreMine = vi.fn()
    renderBody({ conflict, onTakeLatest: () => '원본 본문', onRestoreMine })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    type(' 내 글')
    await userEvent.click(screen.getByTestId('issue-edit-conflict-body-take-latest'))
    // 최신 값이 서버 본문과 같아도 내 글 초안은 남는다 — 되살리는 글이 최신 값과 같을 때만 따로 확인한다.
    writeDraftForTest('원본 본문')
    await userEvent.click(await screen.findByTestId('issue-body-draft-restore'))
    expect(onRestoreMine).not.toHaveBeenCalled()
  })

  it('conflict 가 있는 동안 저장 단추·Cmd+Enter 는 onSave 를 부르지 않고 토스트를 띄우며 편집을 유지한다, 취소는 된다', async () => {
    const onSave = vi.fn(async () => true)
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => '')
    onTestFinished(() => toastError.mockRestore())
    renderBody({ conflict, onSave })
    await userEvent.click(screen.getByRole('button', { name: '본문 편집' }))
    type(' 내 글')
    await userEvent.click(screen.getByTestId('issue-body-save'))
    expect(toastError).toHaveBeenCalledWith('다른 사람이 먼저 저장한 본문이 있습니다. 덮어쓰려면 [내 글로 덮어쓰기…]를 눌러 주세요')
    fireEvent.keyDown(screen.getByTestId('issue-body-textarea'), { key: 'Enter', ctrlKey: true, metaKey: true })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('issue-body-textarea')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('issue-body-cancel'))
    expect(screen.queryByTestId('issue-body-textarea')).not.toBeInTheDocument()
  })
})
