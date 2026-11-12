// 도움말 절 본문 그리기(WP-1505) — 코드 복사 단추가 자리표시를 채운 글을 복사하는지, help: 절 링크·figure: 그림이 react-markdown 의
// 주소 정리(urlTransform)에 지워지지 않고 동작하는지, 없는 그림·로드 실패는 alt 글로 보이는지,
// 굵은 화면 문구에 마우스를 올리면 패널 밖 같은 이름의 화면 버튼만 강조하는지, 포커스한 화면 단추 이름과 같은 굵은 글자를 강조하는지(WP-1506) 본다.
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { HelpActiveControlContext } from './helpActiveControl'
import type { HelpFigure, HelpSection } from './helpBundle'
import { HelpMarkdown } from './HelpMarkdown'
import type { HelpValues } from './helpMarkup'
import { findScreenControls } from './helpScreenControls'

// 복사는 클립보드 대신 받은 글만 본다(copyToClipboard 가 쓰는 copyText 를 바꾼다).
const copyText = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>())
vi.mock('@/lib/copyText', () => ({ copyText }))

/** 본문만 다른 절 하나. */
function section(markdown: string, figures: HelpFigure[] = []): HelpSection {
  return { id: 'agent.run', label: '실행', title: '실행', parent: null, level: 2, markdown, figures, links: [] }
}

const noValues: HelpValues = { placeholders: {}, conditions: {} }

describe('HelpMarkdown', () => {
  it('코드 블록 복사 단추는 자리표시를 채운 명령을 복사한다', async () => {
    copyText.mockResolvedValue(true)
    const values: HelpValues = { placeholders: { 'app.origin': 'https://w.example' }, conditions: {} }
    render(<HelpMarkdown section={section('```\n/plugin marketplace add {app.origin}/claude/marketplace.json\n```')} values={values} vars={null} onNavigate={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '복사' }))
    expect(copyText).toHaveBeenCalledWith('/plugin marketplace add https://w.example/claude/marketplace.json')
  })

  it('절 링크를 누르면 onNavigate(id) — id 에 # 가 들어도 그대로', async () => {
    const onNavigate = vi.fn()
    render(<HelpMarkdown section={section('[저장소](help:agent.run.repo) 와 [소개](help:agents#_intro)')} values={noValues} vars={null} onNavigate={onNavigate} />)
    await userEvent.click(screen.getByRole('button', { name: '저장소' }))
    expect(onNavigate).toHaveBeenCalledWith('agent.run.repo')
    await userEvent.click(screen.getByRole('button', { name: '소개' }))
    expect(onNavigate).toHaveBeenLastCalledWith('agents#_intro')
  })

  it('갈 수 없는 절(관리자 장 등)의 링크는 글로만 보인다', () => {
    render(<HelpMarkdown section={section('[에이전트](help:agents#_intro)')} values={noValues} vars={null} onNavigate={() => {}} canNavigate={() => false} />)
    expect(screen.getByText('에이전트')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '에이전트' })).toBeNull()
  })

  it('바깥 주소는 새 탭 링크로 연다', () => {
    render(<HelpMarkdown section={section('[사이트](https://example.com/a)')} values={noValues} vars={null} onNavigate={() => {}} />)
    const link = screen.getByRole('link', { name: '사이트' })
    expect(link).toHaveAttribute('href', 'https://example.com/a')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('javascript: 처럼 주소 정리가 지운 링크는 빈 주소의 새 탭 링크가 아니라 글로만 보인다', () => {
    render(<HelpMarkdown section={section('[나쁜](javascript:alert(1)) 끝')} values={noValues} vars={null} onNavigate={() => {}} />)
    expect(screen.getByText('나쁜', { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(document.querySelector('a')).toBeNull()
  })

  it('HTML 주석(인라인·줄)은 화면 글에 보이지 않는다', () => {
    const { container } = render(
      <HelpMarkdown section={section('a <!-- 숨김 --> b\n\n<!-- 줄 주석 -->\n\n끝')} values={noValues} vars={null} onNavigate={() => {}} />,
    )
    expect(container.textContent).toContain('a')
    expect(container.textContent).toContain('끝')
    expect(container.textContent).not.toContain('숨김')
    expect(container.textContent).not.toContain('줄 주석')
    expect(container.textContent).not.toContain('<!--')
  })

  it('언어 없는 코드 블록의 code 에는 인라인 코드 스타일을 겹치지 않는다', () => {
    const { container } = render(<HelpMarkdown section={section('글 `x`\n\n```\ny\n```')} values={noValues} vars={null} onNavigate={() => {}} />)
    const inline = screen.getByText('x', { selector: 'code' })
    expect(inline).toHaveClass('bg-muted')
    const block = container.querySelector('pre code')
    expect(block).not.toBeNull()
    expect(block).not.toHaveClass('bg-muted')
  })

  it('그림은 /help/figures/<id>.png 로 그리고 누르면 크게 연다(설명 없는 대화상자 경고 없이)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fig: HelpFigure = { id: 'agent.run', src: 'figures/agent.run.png', alt: '실행 화면', marks: [] }
    render(<HelpMarkdown section={section('![실행 화면](figure:agent.run)', [fig])} values={noValues} vars={null} onNavigate={() => {}} />)
    const img = screen.getByRole('img', { name: '실행 화면' })
    expect(img).toHaveAttribute('src', '/help/figures/agent.run.png')
    await userEvent.click(screen.getByRole('button', { name: '실행 화면 크게 보기' }))
    const dialog = await screen.findByTestId('help-figure-dialog')
    expect(within(dialog).getByRole('img', { name: '실행 화면' })).toHaveAttribute('src', '/help/figures/agent.run.png')
    // Radix 는 Description 도 aria-describedby={undefined} 도 없으면 console.warn 으로 알린다.
    expect(warn.mock.calls.flat().join(' ')).not.toContain('aria-describedby')
    warn.mockRestore()
  })

  it('묶음에 없는 그림 id 는 alt 글로', () => {
    render(<HelpMarkdown section={section('![없는 그림](figure:nope)')} values={noValues} vars={null} onNavigate={() => {}} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('없는 그림')).toBeInTheDocument()
  })

  it('그림 파일을 못 받으면 alt 글로', () => {
    const fig: HelpFigure = { id: 'agent.run', src: 'figures/agent.run.png', alt: '실행 화면', marks: [] }
    render(<HelpMarkdown section={section('![실행 화면](figure:agent.run)', [fig])} values={noValues} vars={null} onNavigate={() => {}} />)
    fireEvent.error(screen.getByRole('img', { name: '실행 화면' }))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('실행 화면')).toBeInTheDocument()
  })

  it('굵은 화면 문구에 마우스를 올리면 같은 이름의 화면 버튼만 강조한다', async () => {
    render(
      <>
        <button>토큰 다시 넣기</button>
        <div aria-hidden="true"><button>토큰 다시 넣기</button></div>
        <div data-help-panel>
          <button>토큰 다시 넣기</button>
          <HelpMarkdown section={section('**토큰 다시 넣기** 를 누른다.')} values={noValues} vars={null} onNavigate={() => {}} />
        </div>
      </>,
    )
    const [outside, hidden, inside] = screen.getAllByText('토큰 다시 넣기', { selector: 'button', ignore: false })
    const strong = screen.getByText('토큰 다시 넣기', { selector: 'strong' })
    await userEvent.hover(strong)
    expect(outside).toHaveAttribute('data-help-highlight')
    expect(hidden).not.toHaveAttribute('data-help-highlight')
    expect(inside).not.toHaveAttribute('data-help-highlight')
    await userEvent.unhover(strong)
    expect(outside).not.toHaveAttribute('data-help-highlight')
  })
})

describe('HelpMarkdown — 포커스한 화면 단추 강조(WP-1506)', () => {
  it('활성 컨트롤 이름과 정규화한 굵은 글자가 같을 때만 data-help-active', () => {
    const md = section('**토큰  발급** 을 누른다. **발급 취소** 도 있다.')
    const { rerender } = render(
      <HelpActiveControlContext.Provider value="토큰 발급">
        <HelpMarkdown section={md} values={noValues} vars={null} onNavigate={() => {}} />
      </HelpActiveControlContext.Provider>,
    )
    expect(screen.getByText('토큰 발급', { selector: 'strong' })).toHaveAttribute('data-help-active')
    expect(screen.getByText('발급 취소', { selector: 'strong' })).not.toHaveAttribute('data-help-active')
    rerender(
      <HelpActiveControlContext.Provider value="발급">
        <HelpMarkdown section={md} values={noValues} vars={null} onNavigate={() => {}} />
      </HelpActiveControlContext.Provider>,
    )
    expect(screen.getByText('토큰 발급', { selector: 'strong' })).not.toHaveAttribute('data-help-active')
  })
})

describe('findScreenControls', () => {
  it('공백을 정리한 글자나 aria-label 이 같은 버튼·탭·링크를 찾는다', () => {
    document.body.innerHTML = `
      <button>  새   태스크 </button>
      <a href="/x" aria-label="새 태스크"><svg></svg></a>
      <div role="tab">새 태스크</div>
      <span>새 태스크</span>
      <div inert><button>새 태스크</button></div>
    `
    const found = findScreenControls('새 태스크')
    expect(found.map((el) => el.tagName)).toEqual(['BUTTON', 'A', 'DIV'])
  })

  it('앱 셸이 있으면 페이지 영역·상단 가운데 틀 안만 찾는다 — 그 밖(다른 포털)은 문서 전체를 훑지 않는다', () => {
    document.body.innerHTML = `
      <div data-ai-page-root><main><button>새 태스크</button></main></div>
      <div data-ai-chip><button aria-label="새 태스크"></button></div>
      <div id="portal"><button>새 태스크</button></div>
    `
    const found = findScreenControls('새 태스크')
    expect(found).toHaveLength(2)
    expect(found[0].closest('[data-ai-page-root]')).not.toBeNull()
    expect(found[1].closest('[data-ai-chip]')).not.toBeNull()
  })

  it('도움말 본문의 굵은 글자는 AI 패널 안 같은 이름 단추도 찾는다 — AI 답 쪽(excludeAiSurface)만 뺀다', () => {
    document.body.innerHTML = `
      <div data-ai-page-root><div data-ai-panel><button>새 대화</button></div><div data-help-panel><button>새 대화</button></div></div>
    `
    const found = findScreenControls('새 대화')
    expect(found).toHaveLength(1)
    expect(found[0].closest('[data-ai-panel]')).not.toBeNull()
    expect(findScreenControls('새 대화', { excludeAiSurface: true })).toHaveLength(0)
  })
})
