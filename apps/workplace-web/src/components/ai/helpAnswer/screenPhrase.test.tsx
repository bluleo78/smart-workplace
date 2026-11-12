// AI 답의 굵은 화면 문구(WP-1511) — 같은 이름의 화면 단추가 있으면 링크 모양이 되고, AI 패널 안 단추는 맞추지 않는다.
// 실제 호버 강조 색·스크롤은 브라우저가 필요해 라이브 캡처로 본다(계획 — 이 계획에 E2E 없음).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MarkdownMessage } from '@/components/ai/MarkdownMessage'

import type { HelpAnswerActions } from './helpAnswerContext'

let actions: HelpAnswerActions
beforeEach(() => {
  document.body.innerHTML = ''
  actions = { openHelpSection: vi.fn(), focusScreenControl: vi.fn(), openDialog: vi.fn(() => 'opened' as const) }
})

/** 화면(페이지) 단추들 + AI 패널 안 단추들을 둔 문서에 답을 그린다. */
function setup(page: string, panel = '') {
  const host = document.createElement('div')
  host.innerHTML = `<div data-ai-page-root>${page}</div>`
  document.body.append(host)
  const ai = document.createElement('div')
  ai.setAttribute('data-ai-panel', '')
  ai.innerHTML = panel
  document.body.append(ai)
  const mount = document.createElement('div')
  ai.append(mount)
  return render(<MarkdownMessage helpAnswer={{ actions }}>{'**토큰 다시 넣기** 를 누릅니다.'}</MarkdownMessage>, { container: mount })
}

/** 첫 판정은 한가한 때(타이머)로 미뤄 일괄 처리된다 — 그 판정이 끝날 만큼 기다린다. */
const settle = () => new Promise((r) => setTimeout(r, 80))

describe('ScreenPhrase', () => {
  it('같은 이름 화면 단추가 있으면 링크 모양, 누르면 focusScreenControl', async () => {
    setup('<button>토큰 다시 넣기</button>')
    const phrase = screen.getByText('토큰 다시 넣기', { selector: 'strong' })
    await waitFor(() => expect(phrase).toHaveAttribute('role', 'button'))
    fireEvent.click(phrase)
    expect(actions.focusScreenControl).toHaveBeenCalledWith('토큰 다시 넣기')
  })

  it('맞는 단추가 없으면 굵은 글자만', async () => {
    setup('<button>다른 단추</button>')
    await settle()
    const phrase = screen.getByText('토큰 다시 넣기', { selector: 'strong' })
    expect(phrase).not.toHaveAttribute('role')
    fireEvent.click(phrase)
    expect(actions.focusScreenControl).not.toHaveBeenCalled()
  })

  it('AI 패널 안 같은 이름 단추는 맞추지 않는다', async () => {
    setup('<button>다른 단추</button>', '<button>토큰 다시 넣기</button>')
    await settle()
    expect(screen.getByText('토큰 다시 넣기', { selector: 'strong' })).not.toHaveAttribute('role')
  })

  it('전체 화면 AI(data-ai-panel 을 단 루트)의 단추도 맞추지 않는다', async () => {
    // 전체 화면은 페이지 본문(main) 안에 그려지지만 AI 표면이다 — 「새 대화」 같은 자기 단추를 화면 단추로 잡으면 안 된다.
    const host = document.createElement('div')
    host.innerHTML = '<div data-ai-page-root><main><button>다른 단추</button><div data-ai-panel data-testid="ai-fullscreen"><button>새 대화</button><div id="m"></div></div></main></div>'
    document.body.append(host)
    render(<MarkdownMessage helpAnswer={{ actions }}>{'**새 대화** 를 누릅니다.'}</MarkdownMessage>, { container: host.querySelector('#m')! })
    await settle()
    expect(screen.getByText('새 대화', { selector: 'strong' })).not.toHaveAttribute('role')
  })

  it('맞는 단추가 둘이면 호버 때 둘 다 data-help-highlight, 떠나면 거둔다', () => {
    setup('<button id="a">토큰 다시 넣기</button><a href="/x" id="b">토큰 다시 넣기</a>')
    const phrase = screen.getByText('토큰 다시 넣기', { selector: 'strong' })
    fireEvent.mouseEnter(phrase)
    expect(document.getElementById('a')).toHaveAttribute('data-help-highlight')
    expect(document.getElementById('b')).toHaveAttribute('data-help-highlight')
    fireEvent.mouseLeave(phrase)
    expect(document.getElementById('a')).not.toHaveAttribute('data-help-highlight')
  })

  it('굵은 글자가 여럿이어도 첫 판정은 문서를 한 번만 훑는다', async () => {
    const host = document.createElement('div')
    host.innerHTML = '<div data-ai-page-root><button>하나</button><button>둘</button></div>'
    document.body.append(host)
    const mount = document.createElement('div')
    host.append(mount)
    const qsa = vi.spyOn(document, 'querySelectorAll')
    render(<MarkdownMessage helpAnswer={{ actions }}>{'**하나** 와 **둘** 과 **셋** 과 **넷**'}</MarkdownMessage>, { container: mount })
    await waitFor(() => expect(screen.getByText('둘', { selector: 'strong' })).toHaveAttribute('role', 'button'))
    expect(screen.getByText('하나', { selector: 'strong' })).toHaveAttribute('role', 'button')
    expect(screen.getByText('셋', { selector: 'strong' })).not.toHaveAttribute('role')
    // 컨트롤 훑기(셸 범위 찾기 + 후보 조회)가 글자 수(4)에 비례하지 않는다 — 4개면 8 이상이 됐을 것.
    expect(qsa.mock.calls.filter(([sel]) => String(sel).includes('data-ai-page-root')).length).toBe(1)
    qsa.mockRestore()
  })

  it('나중에 생긴 화면 단추도 호버하면 링크 모양이 된다', async () => {
    setup('')
    await settle()
    const phrase = screen.getByText('토큰 다시 넣기', { selector: 'strong' })
    expect(phrase).not.toHaveAttribute('role')
    const late = document.createElement('button')
    late.textContent = '토큰 다시 넣기'
    document.querySelector('[data-ai-page-root]')!.append(late)
    fireEvent.mouseEnter(phrase)
    expect(phrase).toHaveAttribute('role', 'button')
  })
})
