// @vitest-environment jsdom
import { wikiSchemaExtensions } from '@smart-workplace/wiki-editor-schema'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import type { AppLinkCard } from '@/api/appLinks'

import { appLinkChipsKey, appLinkChipTargets, chipSource, collectAppLinkRanges, MAX_WIKI_APP_LINK_CHIPS, refreshAppLinkChips, WikiAppLinkChips } from './wikiAppLinkChips'

// 노트 본문 앱 링크 칩(WP-1147) — 어느 글자가 칩이 되는지, 받은 카드로만 칩을 그리고 원래 글자를 숨기는지, 편집 중 커서가 닿으면
// 원래 글자를 드러내는지, 칩이 공유 문서(Yjs)에 들어가지 않는지 브라우저 없이 본다.

const HOST = 'app.example.com'
// 앱의 currentAppHosts 처럼 바뀌지 않으면 같은 배열 — 새 배열이면 플러그인이 호스트가 바뀐 것으로 보고 매번 다시 모은다.
const HOSTS = [HOST]
const ISSUE = `https://${HOST}/projects/WP/issues/12`
const PAGE = `https://${HOST}/wiki/spaces/3/pages/45`

const ISSUE_CARD: AppLinkCard = { kind: 'ISSUE', title: '로그인 오류 고치기', issueKey: 'WP-12', statusName: '진행 중', statusCategory: 'IN_PROGRESS' }
const PAGE_CARD: AppLinkCard = { kind: 'PAGE', title: '회의록', spaceName: '팀' }

const editors: Editor[] = []
function makeEditor(content: string, opts: { editable?: boolean; doc?: Y.Doc; hosts?: () => readonly string[] } = {}) {
  const editor = new Editor({
    extensions: [
      ...wikiSchemaExtensions(),
      ...(opts.doc ? [Collaboration.configure({ document: opts.doc, field: 'default' })] : []),
      WikiAppLinkChips.configure({ appHosts: opts.hosts ?? (() => HOSTS) }),
    ],
    content: opts.doc ? undefined : content,
    editable: opts.editable ?? false,
  })
  editors.push(editor)
  return { editor }
}

/** 카드를 받은 것처럼 플러그인에 넘긴다. */
function receive(editor: Editor, cards: Record<string, AppLinkCard>) {
  refreshAppLinkChips(editor.view, new Map(Object.entries(cards)))
}

const chips = (editor: Editor) => [...editor.view.dom.querySelectorAll<HTMLElement>('[data-testid="wiki-app-link-chip"]')]
const hiddenSources = (editor: Editor) => editor.view.dom.querySelectorAll('[data-app-link-src]').length

afterEach(() => {
  editors.splice(0).forEach((e) => {
    if (!e.isDestroyed) e.destroy()
  })
})

describe('collectAppLinkRanges — 칩이 되는 글자', () => {
  const ranges = (html: string) => {
    const { editor } = makeEditor(html)
    return collectAppLinkRanges(editor.state.doc, [HOST]).map((r) => [editor.state.doc.textBetween(r.from, r.to), r.link.to])
  }

  it('맨 주소와 글자가 주소 그대로인 링크는 칩 자리가 된다', () => {
    expect(ranges(`<p>보세요 ${ISSUE} 그리고 <a href="${PAGE}">${PAGE}</a></p>`)).toEqual([
      [ISSUE, '/projects/WP/issues/12'],
      [PAGE, '/wiki/spaces/3/pages/45'],
    ])
  })

  it('굵게 등으로 갈린 주소 링크도 한 자리다', () => {
    const half = PAGE.length / 2
    expect(ranges(`<p><a href="${PAGE}">${PAGE.slice(0, half)}<strong>${PAGE.slice(half)}</strong></a></p>`)).toEqual([
      [PAGE, '/wiki/spaces/3/pages/45'],
    ])
  })

  it('링크 글자 끝에 공백이 붙었으면 칩으로 바꾸지 않는다 — 공백까지 숨겨 다음 말에 붙지 않게', () => {
    expect(ranges(`<p><a href="${ISSUE}">${ISSUE} </a>뒤</p>`)).toEqual([])
  })

  it('누르면 갈 경로는 쓴 주소의 경로·질의·조각 그대로다(#댓글 등)', () => {
    const { editor } = makeEditor(`<p>${ISSUE}#comment-9</p>`)
    expect(collectAppLinkRanges(editor.state.doc, [HOST]).map((r) => [r.link.to, r.nav])).toEqual([
      ['/projects/WP/issues/12', '/projects/WP/issues/12#comment-9'],
    ])
  })

  it('소문자 키로 붙인 주소도 카드와 같은 경로(키 대문자)로 간다 — 조각만 덧붙인다', () => {
    const { editor } = makeEditor(`<p>https://${HOST}/projects/wp/issues/12?tab=x#comment-3</p>`)
    expect(collectAppLinkRanges(editor.state.doc, [HOST]).map((r) => [r.link.to, r.nav])).toEqual([
      ['/projects/WP/issues/12', '/projects/WP/issues/12#comment-3'],
    ])
  })

  it('글자를 따로 적은 링크·다른 호스트·코드 안 주소·앱 화면이 아닌 경로는 그대로 둔다', () => {
    expect(
      ranges(
        `<p><a href="${ISSUE}">여기</a> https://other.example.com/projects/WP/issues/1 <code>${ISSUE}</code> https://${HOST}/settings</p><pre><code>${PAGE}</code></pre>`,
      ),
    ).toEqual([])
  })
})

describe('appLinkChipTargets — 카드를 받을 대상', () => {
  it('같은 대상은 한 번, 문서 순서로 상한까지이고 대상이 그대로면 같은 배열이다', () => {
    const many = Array.from({ length: MAX_WIKI_APP_LINK_CHIPS + 5 }, (_, i) => `https://${HOST}/projects/WP/issues/${i + 1}`)
    const { editor } = makeEditor(`<p>${ISSUE} ${PAGE} ${ISSUE}</p><p>${many.join(' ')}</p>`, { editable: true })
    const targets = appLinkChipTargets(editor.state)
    expect(targets).toHaveLength(MAX_WIKI_APP_LINK_CHIPS)
    expect(targets.slice(0, 3).map((l) => l.to)).toEqual(['/projects/WP/issues/12', '/wiki/spaces/3/pages/45', '/projects/WP/issues/1'])
    editor.commands.insertContentAt(1, '앞 ')
    expect(appLinkChipTargets(editor.state)).toBe(targets)
  })
})

describe('WikiAppLinkChips — 칩 그리기', () => {
  it('카드를 받기 전에는 원래 링크 그대로, 받으면 그 자리에 칩을 그리고 원래 글자를 숨긴다', () => {
    const { editor } = makeEditor(`<p>이슈 ${ISSUE} 와 노트 ${PAGE}</p>`)
    expect(chips(editor)).toHaveLength(0)
    expect(hiddenSources(editor)).toBe(0)

    receive(editor, { '/projects/WP/issues/12': ISSUE_CARD, '/wiki/spaces/3/pages/45': PAGE_CARD })

    const [issue, page] = chips(editor)
    expect(issue.dataset.appLinkTo).toBe('/projects/WP/issues/12')
    expect(issue.textContent).toBe('WP-12로그인 오류 고치기')
    expect(issue.title).toBe('이슈 WP-12 로그인 오류 고치기 · 진행 중')
    expect(issue.querySelector('.bg-info')).not.toBeNull()
    expect(page.dataset.appLinkTo).toBe('/wiki/spaces/3/pages/45')
    expect(page.textContent).toBe('회의록')
    expect(hiddenSources(editor)).toBe(2)
    // 본문(문서)은 주소 그대로다.
    expect(editor.getText()).toBe(`이슈 ${ISSUE} 와 노트 ${PAGE}`)
  })

  it('볼 수 없는 대상(카드 없음)은 원래 링크로 남는다 — 제목이 새지 않는다', () => {
    const { editor } = makeEditor(`<p>${ISSUE} ${PAGE}</p>`)
    receive(editor, { '/wiki/spaces/3/pages/45': PAGE_CARD })
    expect(chips(editor).map((c) => c.dataset.appLinkTo)).toEqual(['/wiki/spaces/3/pages/45'])
    expect(hiddenSources(editor)).toBe(1)
    expect(editor.view.dom.textContent).toContain(ISSUE)
  })

  it('편집 중 커서가 그 링크에 닿으면 원래 글자를 드러내고, 벗어나면 다시 칩이다', () => {
    const { editor } = makeEditor(`<p>앞 ${ISSUE} 뒤</p>`, { editable: true })
    receive(editor, { '/projects/WP/issues/12': ISSUE_CARD })
    expect(chips(editor)).toHaveLength(1)

    const [range] = collectAppLinkRanges(editor.state.doc, [HOST])
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, range.from + 3)))
    expect(chips(editor)).toHaveLength(0)
    expect(hiddenSources(editor)).toBe(0)

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)))
    expect(chips(editor)).toHaveLength(1)
  })

  it('편집 가능으로 바뀌면(거래 없이) 커서가 닿은 링크를 드러낸다', async () => {
    const { editor } = makeEditor(`<p>${ISSUE}</p>`)
    receive(editor, { '/projects/WP/issues/12': ISSUE_CARD })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)))
    expect(chips(editor)).toHaveLength(1)
    editor.setEditable(true)
    await Promise.resolve()
    expect(chips(editor)).toHaveLength(0)
  })

  it('보기 전용이면 선택이 닿아도 칩 그대로다', () => {
    const { editor } = makeEditor(`<p>${ISSUE}</p>`)
    receive(editor, { '/projects/WP/issues/12': ISSUE_CARD })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)))
    expect(chips(editor)).toHaveLength(1)
  })

  it('칩이 가린 원래 자리 — 주소에 건 링크면 그 <a>, 맨 주소면 없음(터치 편집 중 칩을 누를 때 쓴다)', () => {
    const { editor } = makeEditor(`<p>앞 ${ISSUE} 그리고 <a href="${PAGE}">${PAGE}</a></p>`, { editable: true })
    receive(editor, { '/projects/WP/issues/12': ISSUE_CARD, '/wiki/spaces/3/pages/45': PAGE_CARD })
    const ranges = collectAppLinkRanges(editor.state.doc, [HOST])
    const [bare, linked] = chips(editor).map((c) => chipSource(editor.view, c))
    expect(bare.pos).toBe(ranges[0].from)
    expect(bare.anchor).toBeNull()
    expect(linked.pos).toBe(ranges[1].from)
    expect(linked.anchor?.getAttribute('href')).toBe(PAGE)
  })

  it('이슈 상태 점은 상태 배지와 같은 공용 색이다 — 완료는 success, 할 일은 테두리만', () => {
    const { editor } = makeEditor(`<p>${ISSUE} ${ISSUE.replace('12', '13')}</p>`)
    receive(editor, {
      '/projects/WP/issues/12': { ...ISSUE_CARD, statusCategory: 'DONE' },
      '/projects/WP/issues/13': { ...ISSUE_CARD, issueKey: 'WP-13', statusCategory: 'TODO' },
    })
    const [done, todo] = chips(editor).map((c) => c.querySelector('.rounded-full')!.className)
    expect(done).toContain('bg-success')
    expect(todo).toContain('border-muted-foreground')
    expect(todo).not.toContain('bg-')
  })

  it('선택만 바뀌면 커서가 칩 경계를 넘을 때만 칩을 다시 만든다(WP-1185)', () => {
    const { editor } = makeEditor(`<p>앞쪽 글자 ${ISSUE} 뒤</p>`, { editable: true })
    receive(editor, { '/projects/WP/issues/12': ISSUE_CARD })
    const decos = () => appLinkChipsKey.getState(editor.state)!.decos
    const select = (pos: number) => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
    const [range] = collectAppLinkRanges(editor.state.doc, [HOST])

    select(1)
    const before = decos()
    select(3)
    // 링크 밖에서 움직였으니 같은 장식 그대로다.
    expect(decos()).toBe(before)
    expect(chips(editor)).toHaveLength(1)

    // 링크에 닿으면 다시 만들어 원래 글자를 드러낸다 — 링크 안에서 움직이는 동안은 그대로다.
    select(range.from + 2)
    const inside = decos()
    expect(inside).not.toBe(before)
    expect(chips(editor)).toHaveLength(0)
    select(range.from + 5)
    expect(decos()).toBe(inside)
  })

  it('한글 조합이 끝나면 조합 중 미룬 칩을 다시 고른다 — 조합 뒤 문서가 더 바뀌지 않아도 칩이 생긴다(WP-1185)', async () => {
    const { editor } = makeEditor('<p>앞</p>', { editable: true })
    receive(editor, { '/projects/WP/issues/12': ISSUE_CARD })
    const input = (editor.view as unknown as { input: { composing: boolean } }).input
    input.composing = true
    editor.view.dispatch(editor.state.tr.insertText(` ${ISSUE} 끝`, 2))
    // 조합 중에는 칩을 다시 고르지 않는다(조합 중인 글자 옆 DOM 을 바꾸지 않게).
    expect(chips(editor)).toHaveLength(0)

    editor.view.dom.dispatchEvent(new Event('compositionend', { bubbles: true }))
    await vi.waitFor(() => expect(chips(editor)).toHaveLength(1))
    expect(editor.view.composing).toBe(false)
  })

  it('칩은 공유 문서(Yjs)에 들어가지 않는다', () => {
    const doc = new Y.Doc()
    const { editor } = makeEditor('', { doc })
    editor.commands.insertContent(`<p>${ISSUE}</p>`)
    receive(editor, { '/projects/WP/issues/12': ISSUE_CARD })
    expect(chips(editor)).toHaveLength(1)
    const shared = doc.getXmlFragment('default').toString()
    expect(shared).toContain(ISSUE)
    expect(shared).not.toContain('로그인 오류 고치기')
  })
})

describe('앱 호스트가 늦게 바뀔 때(WP-1165)', () => {
  it('공개 호스트가 더해지면 문서가 그대로여도 다시 고르는 거래에서 자리를 다시 모은다', () => {
    // 내부 주소로 연 노트 — 처음엔 공개 호스트(HOST)를 몰라 공개 주소 링크가 대상이 아니다.
    let hosts: readonly string[] = ['10.0.0.5']
    const { editor } = makeEditor(`<p>${ISSUE}</p>`, { hosts: () => hosts })
    expect(appLinkChipTargets(editor.state)).toEqual([])
    hosts = ['10.0.0.5', HOST]
    refreshAppLinkChips(editor.view)
    expect(appLinkChipTargets(editor.state).map((l) => l.to)).toEqual(['/projects/WP/issues/12'])
  })
})
