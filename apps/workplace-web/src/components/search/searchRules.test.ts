// @vitest-environment jsdom
// 통합 검색(WP-1353, 앞서 WP-1324)의 순수 판정 — 일치 강조 조각·「/」 단축키·위아래 이동.
import { describe, expect, it } from 'vitest'

import {
  allHasListbox,
  emptyResultText,
  highlightParts,
  isSearchableTerm,
  isSearchShortcut,
  kindHasListbox,
  kindIsFailed,
  kindIsLoading,
  moveActive,
  searchResultAnnouncement,
} from './searchRules'

describe('highlightParts', () => {
  it('대소문자를 무시하고 맞은 곳을 모두 나눈다(원문 글자 그대로)', () => {
    expect(highlightParts('Chat 읽음 chat', 'CHAT')).toEqual([
      { text: 'Chat', match: true },
      { text: ' 읽음 ', match: false },
      { text: 'chat', match: true },
    ])
  })

  it('소문자가 되며 길이가 바뀌는 글자(İ) 뒤에서도 맞은 곳이 어긋나지 않는다, 특수문자는 글자 그대로', () => {
    expect(highlightParts('İstanbul chat', 'chat')).toEqual([
      { text: 'İstanbul ', match: false },
      { text: 'chat', match: true },
    ])
    expect(highlightParts('a.b (c)', '(c)')).toEqual([
      { text: 'a.b ', match: false },
      { text: '(c)', match: true },
    ])
  })

  it('검색어가 비었거나 맞지 않으면 통째 하나', () => {
    expect(highlightParts('읽음 표시', '  ')).toEqual([{ text: '읽음 표시', match: false }])
    expect(highlightParts('읽음 표시', '메일')).toEqual([{ text: '읽음 표시', match: false }])
  })
})

describe('isSearchShortcut', () => {
  const key = (over: Partial<KeyboardEvent> & { target?: EventTarget | null }) =>
    ({
      key: '/',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      target: document.body,
      ...over,
    }) as KeyboardEvent

  it('글 입력 중이 아닐 때 수정 키 없는 「/」만 검색을 연다', () => {
    expect(isSearchShortcut(key({}))).toBe(true)
    expect(isSearchShortcut(key({ key: 'k', metaKey: true }))).toBe(false)
    expect(isSearchShortcut(key({ ctrlKey: true }))).toBe(false)
    expect(isSearchShortcut(key({ isComposing: true }))).toBe(false)
    expect(isSearchShortcut(key({ defaultPrevented: true }))).toBe(false)
  })

  it('대화상자·메뉴가 열려 있으면 열지 않는다(포커스를 오버레이가 쥐고 있다)', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    try {
      expect(isSearchShortcut(key({}))).toBe(false)
    } finally {
      dialog.remove()
    }
    expect(isSearchShortcut(key({}))).toBe(true)
  })

  it('입력칸·편집기에서 친 「/」는 글자다', () => {
    const input = document.createElement('input')
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    expect(isSearchShortcut(key({ target: input }))).toBe(false)
    expect(isSearchShortcut(key({ target: document.createElement('textarea') }))).toBe(false)
    // jsdom 은 isContentEditable 을 계산하지 않아 직접 준다.
    Object.defineProperty(editor, 'isContentEditable', { value: true })
    expect(isSearchShortcut(key({ target: editor }))).toBe(false)
  })
})

describe('moveActive', () => {
  it('처음 누르면 아래는 첫 줄·위는 끝 줄, 끝에서 처음으로 돈다', () => {
    expect(moveActive(-1, 1, 3)).toBe(0)
    expect(moveActive(-1, -1, 3)).toBe(2)
    expect(moveActive(2, 1, 3)).toBe(0)
    expect(moveActive(0, -1, 3)).toBe(2)
    expect(moveActive(0, 1, 0)).toBe(-1)
  })
})

describe('isSearchableTerm', () => {
  it('두 글자부터 보내고, 한 글자는 번호일 때만', () => {
    expect(isSearchableTerm('')).toBe(false)
    expect(isSearchableTerm('읽')).toBe(false)
    expect(isSearchableTerm('7')).toBe(true)
    expect(isSearchableTerm('#')).toBe(false)
    expect(isSearchableTerm('읽음')).toBe(true)
  })
})

describe('searchResultAnnouncement', () => {
  // 기본 입력 — 각 테스트가 필요한 칸만 덮어쓴다.
  const base = {
    showResults: true,
    settled: true,
    tabLabel: '작업',
    isAll: false,
    count: 0,
    more: false,
    failed: false,
    term: '회차',
  }

  it('결과 화면이 아니거나 아직 확정되지 않았으면 알리지 않는다', () => {
    expect(searchResultAnnouncement({ ...base, showResults: false })).toBe('')
    expect(searchResultAnnouncement({ ...base, settled: false, count: 5 })).toBe('')
  })

  it('종류 탭은 「탭 결과 N건」, 더 있으면 「이상」을 붙인다', () => {
    expect(searchResultAnnouncement({ ...base, count: 20, more: true })).toBe('작업 결과 20건 이상')
    expect(searchResultAnnouncement({ ...base, count: 3, more: false })).toBe('작업 결과 3건')
  })

  it('전체 탭은 「전체 결과 N건」', () => {
    expect(searchResultAnnouncement({ ...base, tabLabel: '전체', isAll: true, count: 7, more: false })).toBe(
      '전체 결과 7건',
    )
  })

  it('실패하고 건수가 0이면 불러오지 못했다고 알린다, 건수가 있으면 건수를 우선한다', () => {
    expect(searchResultAnnouncement({ ...base, count: 0, failed: true })).toBe('검색 결과를 불러오지 못했어요')
    expect(searchResultAnnouncement({ ...base, count: 4, failed: true })).toBe('작업 결과 4건')
  })

  it('결과가 없으면 전체 탭과 종류 탭 문구가 다르다', () => {
    expect(searchResultAnnouncement({ ...base, tabLabel: '전체', isAll: true, count: 0 })).toBe(
      '모든 앱에 「회차」와 맞는 것이 없어요',
    )
    expect(searchResultAnnouncement({ ...base, tabLabel: '드라이브', isAll: false, count: 0 })).toBe(
      '드라이브에 「회차」와 맞는 것이 없어요',
    )
  })
})

describe('emptyResultText', () => {
  it('전체 탭은 모든 앱, 종류 탭은 그 탭 이름으로 없음 문구를 만든다', () => {
    expect(emptyResultText(true, '전체', '배포')).toBe('모든 앱에 「배포」와 맞는 것이 없어요')
    expect(emptyResultText(false, '노트', '배포')).toBe('노트에 「배포」와 맞는 것이 없어요')
  })
})

describe('kindHasListbox', () => {
  const done = { isPending: false, isError: false, fetchStatus: 'idle' }
  it('줄이 있을 때만 listbox 를 그린다', () => {
    expect(kindHasListbox(done, 2)).toBe(true)
    expect(kindHasListbox(done, 0)).toBe(false)
  })
  it('로딩 skeleton·실패 안내 화면에는 listbox 가 없다', () => {
    expect(kindHasListbox({ isPending: true, isError: false, fetchStatus: 'fetching' }, 0)).toBe(false)
    expect(kindHasListbox({ isPending: false, isError: true, fetchStatus: 'idle' }, 0)).toBe(false)
  })
  it('다음 쪽 실패여도 이미 받은 줄이 있으면 listbox 를 그린다', () => {
    expect(kindHasListbox({ isPending: false, isError: true, fetchStatus: 'idle' }, 3)).toBe(true)
  })
})

describe('allHasListbox', () => {
  const ok = (n: number) => ({ isPending: false, isError: false, fetchStatus: 'idle', data: { hits: new Array(n).fill(0) } })
  const loading = { isPending: true, isError: false, fetchStatus: 'fetching' }
  const skipped = { isPending: true, isError: false, fetchStatus: 'idle' }
  const failed = { isPending: false, isError: true, fetchStatus: 'idle' }
  it('한 묶음이라도 줄이 있으면 그린다', () => {
    expect(allHasListbox([ok(0), ok(2)])).toBe(true)
  })
  it('로딩 중이거나 묶음이 실패했으면 줄이 0건이어도 그린다(skeleton·다시 시도)', () => {
    expect(allHasListbox([loading, ok(0)])).toBe(true)
    expect(allHasListbox([failed, ok(0)])).toBe(true)
  })
  it('모두 끝났는데 한 건도 없고 실패도 없으면(건너뛴 앱 포함) 그리지 않는다', () => {
    expect(allHasListbox([ok(0), skipped])).toBe(false)
  })
})

describe('kindIsLoading·kindIsFailed', () => {
  it('첫 응답을 기다리는 중만 로딩이다(조회하지 않는 idle 은 아님)', () => {
    expect(kindIsLoading({ isPending: true, isError: false, fetchStatus: 'fetching' })).toBe(true)
    expect(kindIsLoading({ isPending: true, isError: false, fetchStatus: 'idle' })).toBe(false)
  })
  it('받은 줄 없이 실패했을 때만 실패 화면이다', () => {
    const err = { isPending: false, isError: true, fetchStatus: 'idle' }
    expect(kindIsFailed(err, 0)).toBe(true)
    expect(kindIsFailed(err, 1)).toBe(false)
  })
})
