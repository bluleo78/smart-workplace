// 리포트 저장 위치 고르기 창(WP-1654) — 제외 갈래(「템플릿」·옮긴 템플릿·AI 페이지), 「지금 위치」·「최상위」, 고르고 저장,
// 검색, 「새 페이지」 입력 줄(Enter·Esc·IME·빈 제목·실패), 트리 403 안내를 MSW 로 본다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { WikiPageSummary } from '@/types/wiki'

import { wikiPageDetail, wikiPageSummary } from '../../../e2e/factories/wiki.factory'
import { ReportLocationDialog } from './ReportLocationDialog'

const SPACE = 7
const API = `/api/v1/wiki/spaces/${SPACE}/pages`

const p = (id: number, parentId: number | null, title: string, position: number, ai = false): WikiPageSummary =>
  wikiPageSummary({ id, parentId, title, position, aiLastUsedAt: ai ? '2026-11-10T09:00:00Z' : null })

/**
 * 리포트(10) ─ 11월 2주차(11, AI)
 * 템플릿(20) ─ 정기 리포트(21)
 * 회의록(30) ─ 주간 보고(31)
 *           └ 옮긴 템플릿(32) ─ 템플릿 메모(33)
 * AI 정리(40, AI) ─ 하위(41)
 */
function tree(): WikiPageSummary[] {
  return [
    p(10, null, '리포트', 0),
    p(11, 10, '11월 2주차', 0, true),
    p(20, null, '템플릿', 1),
    p(21, 20, '정기 리포트', 0),
    p(30, null, '회의록', 2),
    p(31, 30, '주간 보고', 0),
    p(32, 30, '옮긴 템플릿', 1),
    p(33, 32, '템플릿 메모', 0),
    p(40, null, 'AI 정리', 3, true),
    p(41, 40, 'AI 하위', 0),
  ]
}

/** 창을 띄운다 — 받은 만들기 요청 바디를 모으고, 만들면 트리에 넣어 다시 받은 목록에 보이게 한다. */
function open({
  treeStatus = 200,
  createStatus = 200,
  currentPageId = 10,
  pages = tree(),
}: { treeStatus?: number; createStatus?: number; currentPageId?: number; pages?: WikiPageSummary[] } = {}) {
  const creates: unknown[] = []
  const moves: unknown[] = []
  const onSave = vi.fn()
  const onClose = vi.fn()
  const view = renderScreen(
    <ReportLocationDialog
      open
      spaceId={SPACE}
      currentPageId={currentPageId}
      blockedRootIds={[20, 32]}
      onClose={onClose}
      onSave={onSave}
    />,
    {
      handlers: [
        http.get(API, () =>
          treeStatus === 200 ? HttpResponse.json(pages) : HttpResponse.json({ message: 'forbidden' }, { status: treeStatus }),
        ),
        http.post(API, async ({ request }) => {
          const body = (await request.json()) as { parentId: number | null; title: string }
          creates.push(body)
          if (createStatus !== 200) return HttpResponse.json({ message: '만들 수 없음' }, { status: createStatus })
          pages.push(p(50, body.parentId, body.title, 9))
          return HttpResponse.json(wikiPageDetail({ id: 50, spaceId: SPACE, parentId: body.parentId, title: body.title }))
        }),
        // 만든 뒤 첫 자리로 옮기는 요청 — 서버처럼 그 형제들의 맨 앞에 둔다.
        http.patch('/api/v1/wiki/pages/:id/move', async ({ params, request }) => {
          const body = (await request.json()) as { parentId: number | null; position: number }
          moves.push({ id: Number(params.id), ...body })
          const pg = pages.find((x) => x.id === Number(params.id))
          if (pg) pg.position = body.position - 1
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    },
  )
  return { ...view, creates, moves, onSave, onClose }
}

const list = () => screen.getByRole('listbox', { name: '저장 위치' })
const option = (name: string | RegExp) => within(list()).getByRole('option', { name })
const saveButton = () => screen.getByRole('button', { name: '저장' })

describe('ReportLocationDialog', () => {
  test('「템플릿」 갈래·옮긴 템플릿 갈래·AI 페이지 갈래는 목록에 없고 나머지는 남는다', async () => {
    open()
    await screen.findByRole('option', { name: /회의록/ })
    const names = within(list())
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(names).toEqual(['최상위', '리포트지금 위치', '회의록', '주간 보고'])
    expect(screen.getByRole('dialog', { name: '리포트 저장 위치' })).toBeInTheDocument()
    expect(screen.getByText('새 리포트를 고른 페이지 아래에 만들어요. 이미 만든 리포트는 그대로 둬요.')).toBeInTheDocument()
  })

  test('사람이 AI 로 다듬어 AI 표시가 붙은 지금 위치와 그 조상은 빼지 않는다 — 다른 AI 갈래는 그대로 뺀다', async () => {
    // 회의록(30)·주간 보고(31, 지금 위치) 둘 다 AI 로 다듬은 페이지
    const pages = tree().map((pg) =>
      pg.id === 30 || pg.id === 31 ? { ...pg, aiLastUsedAt: '2026-11-12T09:00:00Z' } : pg,
    )
    open({ currentPageId: 31, pages })
    await screen.findByRole('option', { name: /회의록/ })
    const names = within(list())
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(names).toEqual(['최상위', '리포트', '회의록', '주간 보고지금 위치'])
  })

  test('「최상위」를 고르면 저장이 잠기고, 처음엔 아무것도 고르지 않아 잠겨 있다', async () => {
    const { user } = open()
    await screen.findByRole('option', { name: /회의록/ })
    expect(saveButton()).toBeDisabled()
    await user.click(option('최상위'))
    expect(option('최상위')).toHaveAttribute('aria-selected', 'true')
    expect(saveButton()).toBeDisabled()
  })

  test('페이지를 고르고 저장하면 onSave(id), 지금 위치를 그대로 저장하면 요청 없이 닫는다', async () => {
    const { user, onSave, onClose } = open()
    await user.click(await screen.findByRole('option', { name: /주간 보고/ }))
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledWith(31)

    onSave.mockClear()
    await user.click(option(/리포트/))
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  test('검색하면 맞는 제목만 남고 「최상위」는 숨는다, 없으면 안내', async () => {
    const { user } = open()
    await screen.findByRole('option', { name: /회의록/ })
    await user.type(screen.getByPlaceholderText('페이지 검색'), '주간')
    expect(within(list()).getAllByRole('option').map((o) => o.textContent)).toEqual(['주간 보고'])
    await user.clear(screen.getByPlaceholderText('페이지 검색'))
    await user.type(screen.getByPlaceholderText('페이지 검색'), '없는말')
    expect(within(list()).queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('맞는 페이지가 없습니다')).toBeInTheDocument()
  })

  test('고른 페이지 아래 「새 페이지」 → Enter 로 만들고 「새로 만듦」으로 골라져 저장할 수 있다', async () => {
    const { user, creates, moves, onSave } = open()
    await user.click(await screen.findByRole('option', { name: /^회의록/ }))
    await user.click(screen.getByTestId('report-location-new'))
    const input = screen.getByRole('textbox', { name: '새 페이지 제목' })
    // 회의록(「최상위」 아래 깊이 1) 바로 아래 한 단계 깊게 — 첫 하위 자리
    expect(screen.getByTestId('report-location-new-row')).toHaveStyle({ paddingLeft: '40px' })
    expect(saveButton()).toBeDisabled()
    await user.type(input, '주간 리포트 모음{Enter}')
    await waitFor(() => expect(creates).toEqual([{ parentId: 30, title: '주간 리포트 모음' }]))
    const created = await screen.findByTestId('report-location-option-50')
    expect(created).toHaveTextContent('주간 리포트 모음새로 만듦')
    expect(created).toHaveAttribute('aria-selected', 'true')
    // 입력 줄이 있던 자리 그대로 — 회의록의 첫 하위로 옮겨 서버 순서도 맞춘다.
    expect(moves).toEqual([{ id: 50, parentId: 30, position: 0 }])
    await waitFor(() =>
      expect(within(list()).getAllByRole('option').map((o) => o.textContent)).toEqual([
        '최상위',
        '리포트지금 위치',
        '회의록',
        '주간 리포트 모음새로 만듦',
        '주간 보고',
      ]),
    )
    expect(screen.queryByRole('textbox', { name: '새 페이지 제목' })).not.toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledWith(50)
  })

  test('아무것도 고르지 않고 「새 페이지」 → 최상위에 만든다', async () => {
    const { user, creates, moves } = open()
    await screen.findByRole('option', { name: /회의록/ })
    await user.click(screen.getByTestId('report-location-new'))
    await user.type(screen.getByRole('textbox', { name: '새 페이지 제목' }), '보관함{Enter}')
    await waitFor(() => expect(creates).toEqual([{ parentId: null, title: '보관함' }]))
    await waitFor(() => expect(moves).toEqual([{ id: 50, parentId: null, position: 0 }]))
  })

  test('「최상위」 아래로 최상위 페이지는 한 단계, 그 하위는 두 단계 들여 쓴다 — 검색 중엔 「최상위」가 없어 원래 깊이', async () => {
    const { user } = open()
    await screen.findByRole('option', { name: /회의록/ })
    expect(option('최상위')).toHaveStyle({ paddingLeft: '8px' })
    expect(option(/^회의록/)).toHaveStyle({ paddingLeft: '24px' })
    expect(option(/주간 보고/)).toHaveStyle({ paddingLeft: '40px' })
    // 고른 게 없으면 입력 줄은 「최상위」 아래 첫 자리(깊이 1)
    await user.click(screen.getByTestId('report-location-new'))
    expect(screen.getByTestId('report-location-new-row')).toHaveStyle({ paddingLeft: '24px' })
    await user.keyboard('{Escape}')
    await user.type(screen.getByPlaceholderText('페이지 검색'), '주간')
    expect(option(/주간 보고/)).toHaveStyle({ paddingLeft: '24px' })
  })

  test('Esc 는 입력 줄만 지우고 창은 열려 있다', async () => {
    const { user, onClose } = open()
    await screen.findByRole('option', { name: /회의록/ })
    await user.click(screen.getByTestId('report-location-new'))
    await user.type(screen.getByRole('textbox', { name: '새 페이지 제목' }), '임시')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: '새 페이지 제목' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '리포트 저장 위치' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  test('IME 조합 중 Enter·빈 제목 Enter 는 만들지 않는다', async () => {
    const { user, creates } = open()
    await screen.findByRole('option', { name: /회의록/ })
    await user.click(screen.getByTestId('report-location-new'))
    const input = screen.getByRole('textbox', { name: '새 페이지 제목' })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: '회의' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    await new Promise((r) => setTimeout(r, 50))
    expect(creates).toEqual([])
    expect(input).toBeInTheDocument()
  })

  test('만들기에 실패하면 입력 줄이 남는다', async () => {
    const { user, creates } = open({ createStatus: 400 })
    await screen.findByRole('option', { name: /회의록/ })
    await user.click(screen.getByTestId('report-location-new'))
    await user.type(screen.getByRole('textbox', { name: '새 페이지 제목' }), '실패할 제목{Enter}')
    await waitFor(() => expect(creates).toHaveLength(1))
    expect(await screen.findByText('만들 수 없음')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '새 페이지 제목' })).toHaveValue('실패할 제목')
  })

  test('트리를 못 읽으면(403) 안내하고 저장이 잠긴다', async () => {
    open({ treeStatus: 403 })
    expect(await screen.findByText('노트 공간 구성원만 저장 위치를 고를 수 있어요.')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })
})
