// 메일 작성창 「서식」 토글(WP-1524) — 처음엔 접힘, 펼침 기억, 저장소 실패 대체, 1행 단추 구성을 본다.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { AiDraftToolbarButton } from './MailAiDraft'
import { MailComposer, type MailComposerHandle } from './MailComposer'

describe('MailComposer 서식 토글', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('처음엔 접혀 있고, 서식을 누르면 둘째 줄이 열리며 기억한다', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MailComposer onChange={vi.fn()} layout="dock" />)
    expect(screen.queryByTestId('mail-composer-format-row')).toBeNull()
    await user.click(screen.getByRole('button', { name: '서식' }))
    expect(screen.getByTestId('mail-composer-format-row')).toBeInTheDocument()
    expect(localStorage.getItem('mail.composer.formatRowOpen')).toBe('1')
    await user.click(screen.getByRole('button', { name: '서식' }))
    expect(screen.queryByTestId('mail-composer-format-row')).toBeNull()
    expect(localStorage.getItem('mail.composer.formatRowOpen')).toBe('0')
  })

  it('기억한 펼침은 다른 배치(fill)로 새로 열어도 이어진다', () => {
    localStorage.setItem('mail.composer.formatRowOpen', '1')
    renderWithProviders(<MailComposer onChange={vi.fn()} layout="fill" />)
    expect(screen.getByTestId('mail-composer-format-row')).toBeInTheDocument()
  })

  it('저장소가 던져도 토글은 이 탭 안에서 동작한다', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const user = userEvent.setup()
    renderWithProviders(<MailComposer onChange={vi.fn()} layout="dock" />)
    await user.click(screen.getByRole('button', { name: '서식' }))
    expect(screen.getByTestId('mail-composer-format-row')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '서식' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('1행은 지금과 같은 다섯 단추 + 서식', () => {
    renderWithProviders(<MailComposer onChange={vi.fn()} layout="dock" />)
    const toolbar = screen.getByTestId('mail-composer-toolbar')
    expect(within(toolbar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      '굵게',
      '기울임',
      '글머리 목록',
      '번호 목록',
      '링크',
      '서식',
    ])
  })

  it('모바일에서는 펼침을 기억하면 데스크톱 둘째 줄 대신 서식판이 열려 있다', () => {
    localStorage.setItem('mail.composer.formatRowOpen', '1')
    renderWithProviders(<MailComposer onChange={vi.fn()} layout="mobile" />)
    expect(screen.queryByTestId('mail-composer-format-row')).toBeNull()
    expect(screen.getByTestId('mail-format-sheet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '서식' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('모바일 줄 끝에 표 넣기·서식 단추가 있고 서식이 서식판을 연다(기억 키 공유)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MailComposer onChange={vi.fn()} layout="mobile" toolbarEnd={<span>끝</span>} />)
    const toolbar = screen.getByTestId('mail-composer-toolbar')
    expect(within(toolbar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      '굵게',
      '기울임',
      '글머리 목록',
      '번호 목록',
      '링크',
      '표 넣기',
      '서식',
    ])
    // toolbarEnd 는 서식 단추 뒤 맨 끝.
    expect(toolbar.lastElementChild).toHaveTextContent('끝')
    expect(screen.queryByTestId('mail-format-sheet')).toBeNull()
    await user.click(within(toolbar).getByRole('button', { name: '서식' }))
    expect(screen.getByTestId('mail-format-sheet')).toBeInTheDocument()
    expect(localStorage.getItem('mail.composer.formatRowOpen')).toBe('1')
    await user.click(within(toolbar).getByRole('button', { name: '서식' }))
    expect(screen.queryByTestId('mail-format-sheet')).toBeNull()
    expect(localStorage.getItem('mail.composer.formatRowOpen')).toBe('0')
  })

  it('모바일 표 넣기는 6×6 격자 패널을 열고, 서식판과 동시에 열리지 않으며 탭하면 표를 넣고 닫힌다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<MailComposer onChange={onChange} layout="mobile" />)
    const toolbar = screen.getByTestId('mail-composer-toolbar')
    await user.click(within(toolbar).getByRole('button', { name: '서식' }))
    await user.click(within(toolbar).getByRole('button', { name: '표 넣기' }))
    // 표 패널을 열면 서식판은 닫힌다.
    const panel = screen.getByTestId('mail-table-panel')
    expect(screen.queryByTestId('mail-format-sheet')).toBeNull()
    expect(within(toolbar).getByRole('button', { name: '표 넣기' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(panel).getAllByRole('button')).toHaveLength(36)
    // 서식을 다시 열면 표 패널이 닫힌다.
    await user.click(within(toolbar).getByRole('button', { name: '서식' }))
    expect(screen.queryByTestId('mail-table-panel')).toBeNull()
    expect(screen.getByTestId('mail-format-sheet')).toBeInTheDocument()
    await user.click(within(toolbar).getByRole('button', { name: '표 넣기' }))
    await user.click(within(screen.getByTestId('mail-table-panel')).getByRole('button', { name: '2행 3열 표' }))
    expect(screen.queryByTestId('mail-table-panel')).toBeNull()
    const html = onChange.mock.calls.at(-1)?.[0] as string
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelectorAll('table tr')).toHaveLength(2)
    expect(doc.querySelectorAll('table tr')[0].children).toHaveLength(3)
  })

  it('모바일 서식판·표 패널이 열린 동안은 표 막대 고정 줄을 숨겨 겹치지 않는다', async () => {
    const ref = createRef<MailComposerHandle>()
    const user = userEvent.setup()
    renderWithProviders(
      <MailComposer
        ref={ref}
        onChange={vi.fn()}
        layout="mobile"
        initialHtml="<p>앞</p><table><tbody><tr><th><p>머리</p></th></tr><tr><td><p>칸</p></td></tr></tbody></table>"
      />,
    )
    act(() => ref.current?.focusEnd())
    await waitFor(() => expect(screen.getByTestId('mail-table-toolbar')).toBeInTheDocument())
    const toolbar = screen.getByTestId('mail-composer-toolbar')
    await user.click(within(toolbar).getByRole('button', { name: '서식' }))
    expect(screen.getByTestId('mail-format-sheet')).toBeInTheDocument()
    expect(screen.queryByTestId('mail-table-toolbar')).toBeNull()
    await user.click(within(toolbar).getByRole('button', { name: '표 넣기' }))
    expect(screen.getByTestId('mail-table-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('mail-table-toolbar')).toBeNull()
    // 패널을 닫으면 표 막대가 돌아온다.
    await user.click(within(toolbar).getByRole('button', { name: '표 넣기' }))
    expect(screen.getByTestId('mail-table-toolbar')).toBeInTheDocument()
  })

  it('모바일 서식판·표 패널이 열린 동안만 본문 아래에 패널 높이만큼 빈 자리를 깐다(데스크톱은 없음)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MailComposer onChange={vi.fn()} layout="mobile" />)
    const toolbar = screen.getByTestId('mail-composer-toolbar')
    expect(screen.queryByTestId('mail-mobile-panel-reserve')).toBeNull()
    await user.click(within(toolbar).getByRole('button', { name: '서식' }))
    expect(screen.getByTestId('mail-mobile-panel-reserve').className).toContain('h-[calc(var(--vvh,100dvh)*0.45)]')
    await user.click(within(toolbar).getByRole('button', { name: '표 넣기' }))
    expect(screen.getByTestId('mail-mobile-panel-reserve')).toBeInTheDocument()
    await user.click(within(toolbar).getByRole('button', { name: '표 넣기' }))
    expect(screen.queryByTestId('mail-mobile-panel-reserve')).toBeNull()
  })

  it('모바일 표 막대 고정 줄이 보이는 동안만 그 높이만큼 본문 아래 빈 자리를 깐다', async () => {
    const user = userEvent.setup()
    const ref = createRef<MailComposerHandle>()
    renderWithProviders(
      <MailComposer
        ref={ref}
        onChange={vi.fn()}
        layout="mobile"
        initialHtml="<p>앞</p><table><tbody><tr><th><p>머리</p></th></tr><tr><td><p>칸</p></td></tr></tbody></table>"
      />,
    )
    // 표 밖(첫 문단)에서는 막대도 빈 자리도 없다.
    expect(screen.queryByTestId('mail-mobile-table-row-reserve')).toBeNull()
    // 커서가 표 안(마지막 칸)이면 막대와 함께 빈 자리가 생긴다.
    act(() => ref.current?.focusEnd())
    await waitFor(() => expect(screen.getByTestId('mail-table-toolbar')).toBeInTheDocument())
    expect(screen.getByTestId('mail-mobile-table-row-reserve').className).toContain('h-[calc(2.75rem+1px)]')
    // 서식판이 열려 막대가 감춰지면 표 막대 몫 빈 자리도 걷힌다(서식판 몫만 남는다).
    const toolbar = screen.getByTestId('mail-composer-toolbar')
    await user.click(within(toolbar).getByRole('button', { name: '서식' }))
    expect(screen.queryByTestId('mail-table-toolbar')).toBeNull()
    expect(screen.queryByTestId('mail-mobile-table-row-reserve')).toBeNull()
    // 닫으면 막대와 빈 자리가 함께 돌아온다.
    await user.click(within(toolbar).getByRole('button', { name: '서식' }))
    expect(screen.getByTestId('mail-table-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('mail-mobile-table-row-reserve')).toBeInTheDocument()
  })

  it('모바일 패널을 열면 패널 뒤에 가린 커서만큼 본문 스크롤 영역을 내린다', async () => {
    const user = userEvent.setup()
    // 작성 스크롤 영역(MailComposeDock 의 overflow-y-auto 본문)을 흉내 낸다.
    const view = renderWithProviders(
      <div data-testid="scroller" style={{ overflowY: 'auto' }}>
        <MailComposer onChange={vi.fn()} layout="mobile" initialHtml="<p>본문</p>" />
      </div>,
    )
    const scroller = view.getByTestId('scroller')
    // jsdom 은 좌표가 없다 — 커서 아래끝 600px, 패널 윗변 500px 로 둔다.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 500 } as DOMRect)
    const { EditorView } = await import('@tiptap/pm/view')
    vi.spyOn(EditorView.prototype, 'coordsAtPos').mockReturnValue({ top: 580, bottom: 600, left: 0, right: 0 })
    await user.click(within(screen.getByTestId('mail-composer-toolbar')).getByRole('button', { name: '서식' }))
    await waitFor(() => expect(scroller.scrollTop).toBe(108))
  })

  it('모바일 AI로 쓰기는 아이콘 단추로 aria-label 이 남는다', () => {
    renderWithProviders(
      <MailComposer
        onChange={vi.fn()}
        layout="mobile"
        toolbarEnd={<AiDraftToolbarButton touch expanded={false} marked onClick={vi.fn()} />}
      />,
    )
    const ai = screen.getByRole('button', { name: 'AI로 쓰기' })
    expect(ai).toHaveAttribute('data-testid', 'mail-ai-compose-open')
    expect(ai).toHaveAttribute('aria-label', 'AI로 쓰기')
    // 글자는 그리지 않고 아이콘만 — 390px 줄에 여덟 칸이 들어가게.
    expect(ai).toHaveTextContent('')
    expect(ai.querySelector('svg')).not.toBeNull()
    expect(ai.className).toContain('size-11')
  })

  it('데스크톱 AI로 쓰기는 지금처럼 글자를 보인다', () => {
    renderWithProviders(
      <MailComposer
        onChange={vi.fn()}
        layout="dock"
        toolbarEnd={<AiDraftToolbarButton touch={false} expanded={false} marked onClick={vi.fn()} />}
      />,
    )
    const ai = screen.getByTestId('mail-ai-compose-open')
    expect(ai).toHaveTextContent('AI로 쓰기')
    expect(ai).not.toHaveAttribute('aria-label')
  })

  it('fill 에서는 두 줄 감싸개가 sticky 를 진다', () => {
    renderWithProviders(<MailComposer onChange={vi.fn()} layout="fill" />)
    expect(screen.getByTestId('mail-composer-toolbars').className).toContain('sticky')
    expect(screen.getByTestId('mail-composer-toolbar').className).not.toContain('sticky')
  })

  it('dock 두 줄 감싸개도 fill 처럼 세로 flex + 간격을 가져 두 줄이 붙지 않는다', () => {
    renderWithProviders(<MailComposer onChange={vi.fn()} layout="dock" />)
    const cls = screen.getByTestId('mail-composer-toolbars').className
    expect(cls).toContain('flex-col')
    expect(cls).toContain('gap-1.5')
    expect(cls).not.toContain('sticky')
  })

  it('모바일에서 표 안에 커서를 두면 표 막대(고정 줄)가 보인다', async () => {
    const ref = createRef<MailComposerHandle>()
    // 본문이 표로 끝나면 focusEnd 가 마지막 셀 안에 커서를 둔다.
    renderWithProviders(
      <MailComposer
        ref={ref}
        onChange={vi.fn()}
        layout="mobile"
        initialHtml="<p>앞</p><table><tbody><tr><th><p>머리</p></th></tr><tr><td><p>칸</p></td></tr></tbody></table>"
      />,
    )
    expect(screen.queryByTestId('mail-table-toolbar')).toBeNull()
    act(() => ref.current?.focusEnd())
    await waitFor(() => expect(screen.getByTestId('mail-table-toolbar')).toBeInTheDocument())
    expect(within(screen.getByTestId('mail-table-toolbar')).getAllByRole('button')).toHaveLength(7)
  })

  it('표 안에 커서를 둔 채 같은 작성창이 fill → mobile 로 바뀌어도 죽지 않고 고정 줄로 바뀐다', async () => {
    const ref = createRef<MailComposerHandle>()
    const html = '<p>앞</p><table><tbody><tr><th><p>머리</p></th></tr><tr><td><p>칸</p></td></tr></tbody></table>'
    // 셸 전환(MailComposeDock)은 같은 MailComposer 의 layout 만 바꾼다 — 떠 있는 막대(BubbleMenu)를 빼면 React 가 떼어진 DOM 을 지우다 던진다.
    const view = renderWithProviders(<MailComposer ref={ref} onChange={vi.fn()} layout="fill" initialHtml={html} />)
    act(() => ref.current?.focusEnd())
    // 데스크톱 떠 있는 막대가 실제로 뜰 때까지(tippy 가 막대 DOM 을 문서에 다시 붙인다) 기다린다.
    await waitFor(() => expect(screen.getByTestId('mail-table-toolbar')).toBeInTheDocument())
    view.rerender(<MailComposer ref={ref} onChange={vi.fn()} layout="mobile" initialHtml={html} />)
    await waitFor(() => expect(screen.getByTestId('mail-table-toolbar').className).toContain('fixed'))
    expect(screen.getByTestId('mail-composer-body')).toBeInTheDocument()
  })
})
