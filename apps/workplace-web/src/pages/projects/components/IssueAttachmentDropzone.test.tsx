// 이슈 첨부 드롭존(WP-2118) — 업로드 중에는 「· n개 남음」을 숨기고 드롭·클릭을 막는다.
import { createEvent, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { BLOCKED_UPLOAD_TOAST_ID } from '../../../lib/issueAttachmentUpload'
import { IssueAttachmentDropzone } from './IssueAttachmentDropzone'

const { toastInfo } = vi.hoisted(() => ({ toastInfo: vi.fn() }))
vi.mock('sonner', () => ({ toast: { info: toastInfo } }))
const { mutate, state } = vi.hoisted(() => ({ mutate: vi.fn(), state: { isPending: false } }))
vi.mock('@/hooks/queries/useUploadIssueAttachments', () => ({
  useUploadIssueAttachments: () => ({ mutate, isPending: state.isPending }),
}))

const drop = (files: File[]) =>
  fireEvent.drop(screen.getByTestId('attachment-dropzone'), { dataTransfer: { files } })

const dragEvt = (type: 'dragOver' | 'drop', files: File[] = []) => {
  const ev = createEvent[type](screen.getByTestId('attachment-dropzone'), { dataTransfer: { files } })
  fireEvent(screen.getByTestId('attachment-dropzone'), ev)
  return ev as Event & { dataTransfer?: { dropEffect?: string } }
}

describe('IssueAttachmentDropzone — 막힌 때에도 브라우저 기본 동작(파일 열기)을 막는다', () => {
  beforeEach(() => {
    mutate.mockClear()
    state.isPending = false
  })

  it.each([
    ['업로드 중', true, 17],
    ['한도 도달', false, 20],
  ])('%s: dragover·drop 모두 defaultPrevented, 업로드 호출 없음', (_n, pending, count) => {
    state.isPending = pending
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={count} disabled={count >= 20} />)
    expect(dragEvt('dragOver').defaultPrevented).toBe(true)
    expect(dragEvt('drop', [new File(['x'], 'a.log')]).defaultPrevented).toBe(true)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('업로드 중에는 cursor-not-allowed', () => {
    state.isPending = true
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    const cls = screen.getByTestId('attachment-dropzone').className
    expect(cls).toContain('cursor-not-allowed')
    expect(cls).not.toContain('cursor-pointer')
  })
})

// 막힌 안내 토스트는 고정 id 로 띄운다(반복해도 쌓이지 않게).
const BLOCKED_OPTS = { id: BLOCKED_UPLOAD_TOAST_ID }

describe('IssueAttachmentDropzone — 막힌 드롭 안내(WP-2118)', () => {
  beforeEach(() => {
    mutate.mockClear()
    toastInfo.mockClear()
    state.isPending = false
  })

  it('업로드 중 드롭하면 안내 토스트, 업로드 없음', () => {
    state.isPending = true
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    drop([new File(['x'], 'a.log')])
    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('업로드 중'), BLOCKED_OPTS)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('한도 도달에서 드롭하면 한도 안내 토스트', () => {
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={20} disabled />)
    drop([new File(['x'], 'a.log')])
    expect(toastInfo).toHaveBeenCalledWith('한도 도달 · 최대 20개', BLOCKED_OPTS)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('업로드 중 클릭하면 드롭과 같은 안내 토스트, 한도 도달 클릭도 한도 안내', () => {
    state.isPending = true
    const { unmount } = renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    fireEvent.click(screen.getByTestId('attachment-dropzone'))
    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('업로드 중'), BLOCKED_OPTS)
    unmount()
    toastInfo.mockClear()
    state.isPending = false
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={20} disabled />)
    fireEvent.click(screen.getByTestId('attachment-dropzone'))
    expect(toastInfo).toHaveBeenCalledWith('한도 도달 · 최대 20개', BLOCKED_OPTS)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('막히지 않았을 땐 클릭해도 토스트가 없다', () => {
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    fireEvent.click(screen.getByTestId('attachment-dropzone'))
    expect(toastInfo).not.toHaveBeenCalled()
  })

  it('막히면 dragover 의 dropEffect 가 none, 평소엔 copy', () => {
    state.isPending = true
    const { unmount } = renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    expect(dragEvt('dragOver').dataTransfer?.dropEffect).toBe('none')
    unmount()
    state.isPending = false
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    expect(dragEvt('dragOver').dataTransfer?.dropEffect).toBe('copy')
  })
})

describe('IssueAttachmentDropzone — 업로드 중', () => {
  beforeEach(() => {
    mutate.mockClear()
    state.isPending = false
  })

  it('평소에는 「n개 남음」이 보이고 드롭하면 업로드한다', () => {
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={17} disabled={false} />)
    expect(screen.getByTestId('attachment-dropzone')).toHaveTextContent('3개 남음')
    drop([new File(['x'], 'a.log')])
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('업로드 중에는 「n개 남음」을 숨기고 드롭을 무시한다', () => {
    state.isPending = true
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={17} disabled={false} />)
    const zone = screen.getByTestId('attachment-dropzone')
    expect(zone).toHaveTextContent('업로드 중')
    expect(zone).not.toHaveTextContent('남음')
    drop([new File(['x'], 'a.log')])
    expect(mutate).not.toHaveBeenCalled()
  })
})

describe('IssueAttachmentDropzone — 키보드(WP-2130)', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    mutate.mockClear()
    toastInfo.mockClear()
    state.isPending = false
    // 숨은 file input 의 click() 호출 횟수로 선택창 열림을 본다.
    clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
  })
  afterEach(() => clickSpy.mockRestore())

  it('Tab 으로 초점이 가고 역할이 button', async () => {
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    await userEvent.tab()
    const zone = screen.getByTestId('attachment-dropzone')
    expect(document.activeElement).toBe(zone)
    expect(screen.getByRole('button', { name: '첨부 드롭존' })).toBe(zone)
  })

  it('막히지 않았을 때 Enter·Space 가 선택창을 연다', () => {
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    const zone = screen.getByTestId('attachment-dropzone')
    fireEvent.keyDown(zone, { key: 'Enter' })
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(fireEvent.keyDown(zone, { key: ' ' })).toBe(false)
    expect(clickSpy).toHaveBeenCalledTimes(2)
    expect(toastInfo).not.toHaveBeenCalled()
    expect(zone).toHaveAttribute('aria-disabled', 'false')
  })

  it.each([
    ['업로드 중', true, 3, false, expect.stringContaining('업로드 중')],
    ['한도 도달', false, 20, true, '한도 도달 · 최대 20개'],
  ])('%s: Enter·Space 에 클릭과 같은 안내 토스트, 선택창 없음', (_n, pending, count, disabled, text) => {
    state.isPending = pending
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={count} disabled={disabled} />)
    const zone = screen.getByTestId('attachment-dropzone')
    fireEvent.keyDown(zone, { key: 'Enter' })
    fireEvent.keyDown(zone, { key: ' ' })
    expect(toastInfo).toHaveBeenCalledTimes(2)
    expect(toastInfo).toHaveBeenCalledWith(text, BLOCKED_OPTS)
    expect(clickSpy).not.toHaveBeenCalled()
    expect(zone).toHaveAttribute('aria-disabled', 'true')
    expect(zone).toHaveAttribute('tabindex', '0')
  })

  it('repeat 키는 무시', () => {
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    fireEvent.keyDown(screen.getByTestId('attachment-dropzone'), { key: 'Enter', repeat: true })
    expect(clickSpy).not.toHaveBeenCalled()
    expect(toastInfo).not.toHaveBeenCalled()
  })

  it('다른 키는 막지 않는다', () => {
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    expect(fireEvent.keyDown(screen.getByTestId('attachment-dropzone'), { key: 'Tab' })).toBe(true)
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Meta', { metaKey: true }],
  ])('%s 를 함께 누른 Enter 는 다른 단축키라 건드리지 않는다', (_n, mod) => {
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    expect(fireEvent.keyDown(screen.getByTestId('attachment-dropzone'), { key: 'Enter', ...mod })).toBe(true)
    expect(clickSpy).not.toHaveBeenCalled()
  })

  // 자식(span)에서 버블링된 Enter·Space 는 드롭존이 가로채지 않는다 — 자식의 기본 동작을 막지 않게(WP-1555 와 같은 이유).
  it.each([['Enter'], [' ']])('자식에서 올라온 %s 는 가로채지 않는다(WP-1555 와 같은 이유)', (key) => {
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={3} disabled={false} />)
    const child = screen.getByTestId('attachment-dropzone').querySelector('span')!
    expect(fireEvent.keyDown(child, { key })).toBe(true)
    expect(clickSpy).not.toHaveBeenCalled()
    expect(toastInfo).not.toHaveBeenCalled()
  })
})

describe('IssueAttachmentDropzone — 상태 문구를 설명으로(WP-2130)', () => {
  beforeEach(() => {
    state.isPending = false
  })

  it('평소에는 「n개 남음」, 한도 도달에는 「한도 도달」을 접근 가능한 설명으로 읽는다', () => {
    const { unmount } = renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={17} disabled={false} />)
    expect(screen.getByTestId('attachment-dropzone')).toHaveAccessibleDescription(/3개 남음/)
    unmount()
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={20} disabled />)
    expect(screen.getByTestId('attachment-dropzone')).toHaveAccessibleDescription(/한도 도달/)
  })
})

describe('IssueAttachmentDropzone — 한도 상태에서도 초점 링이 흐려지지 않는다(WP-2130)', () => {
  beforeEach(() => {
    state.isPending = false
  })

  // 루트(초점 링)는 늘 흐리지 않고, 한도 도달에서만 아이콘·상태 문구를 흐리고 테두리를 흐린 색으로 막힘을 보인다.
  it.each([
    ['한도 도달', false, 20, true],
    ['업로드 중', true, 3, false],
    ['평소', false, 3, false],
  ])('%s: 루트는 흐리지 않고 내용 흐림은 한도 도달에서만', (name, pending, count, disabled) => {
    state.isPending = pending
    renderWithProviders(<IssueAttachmentDropzone projectKey="P" number={1} currentCount={count} disabled={disabled} />)
    const zone = screen.getByTestId('attachment-dropzone')
    const limit = name === '한도 도달'
    const status = document.getElementById(zone.getAttribute('aria-describedby')!)!
    expect(zone.className.includes('opacity-50')).toBe(false)
    expect(status.className.includes('opacity-50')).toBe(limit)
    expect(zone.querySelector('svg')!.getAttribute('class')!.includes('opacity-50')).toBe(limit)
    expect(zone.className.includes('border-input/50')).toBe(limit)
  })
})
