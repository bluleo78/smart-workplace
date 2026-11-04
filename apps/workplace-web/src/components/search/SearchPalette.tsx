// 통합 검색 팔레트(WP-1353) — 화면 가운데 모달. 입력 + 앱 종류 탭 + 결과(종류 탭은 한 앱 20건씩, 「전체」는 앱별 3건 묶음).
// 상단 이슈 전용 펼침 검색(WP-1324)을 대체한다. 열릴 때마다 본문이 새로 마운트돼 탭=지금 앱·검색어=빈 값으로 시작한다.
// 열림 상태는 히스토리에 넣지 않는다(useSearchPalette). 한글 조합 중(isComposing)에는 모든 키를 무시한다.
import { Search } from 'lucide-react'
import { type KeyboardEvent, useContext, useEffect, useId, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useOptionalAssistant } from '@/components/ai/AIAssistantContext'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ChatSessionContext } from '@/hooks/chat-session-context'
import { useDebounceValue } from '@/hooks/useDebounceValue'
import { SEARCH_QUERY_MAX_LENGTH } from '@/lib/searchLimits'
import { cn } from '@/lib/utils'

import { pushRecent } from './recentSearches'
import { RecentSearchList } from './RecentSearchList'
import { SearchAllResults } from './SearchAllResults'
import { currentAppFromPath, groupOrder, SEARCH_TABS, type SearchTabId } from './searchApps'
import { SearchKindResults } from './SearchKindResults'
import type { SearchHit } from './searchProviders'
import { SearchResultRow } from './SearchResultRow'
import { isSearchableTerm, moveActive, SEARCH_DEBOUNCE_MS, shortcutHint } from './searchRules'
import { useSearchQueries } from './useSearchQueries'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 팔레트 껍데기 — 대화상자(배경·포커스 가두기·Esc)만 맡고 상태는 열릴 때마다 새로 만드는 본문에 둔다. */
export function SearchPalette({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="global-search"
        showCloseButton={false}
        // 화면 가운데·폭 min(680px, 100vw-32px)·높이 약 60vh(내부 스크롤).
        className="flex h-[60vh] w-[min(680px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        // Esc — AI 패널의 전역 Esc 처리까지 닿지 않게 기본 동작을 막고(defaultPrevented) 검색만 닫는다. 조합 중 Esc 는 조합 취소 몫.
        // 트리거 버튼을 눌러도 바깥 누름으로 닫혔다가 다시 열리지 않게(깜빡임·상태 초기화) 제외한다.
        onInteractOutside={(e) => {
          if (e.target instanceof Element && e.target.closest('[data-testid="global-search-toggle"]')) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          e.preventDefault()
          if (!e.isComposing) onOpenChange(false)
        }}
      >
        <DialogTitle className="sr-only">통합 검색</DialogTitle>
        <DialogDescription className="sr-only">대화·메일·작업·드라이브·노트·연락처를 앱 종류별로 찾습니다.</DialogDescription>
        <PaletteBody onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

/** 한글 조합 중인 키인가 — Safari 는 조합이 끝난 직후 keydown 에도 isComposing=false, keyCode=229 를 준다. */
function isComposingKey(e: KeyboardEvent<HTMLInputElement>): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  // 열 때의 현재 앱 — 탭 초기값과 「전체」 묶음 순서의 기준(열려 있는 동안 고정).
  const [current] = useState(() => currentAppFromPath(location.pathname))
  const [tab, setTab] = useState<SearchTabId>(current ?? 'all')
  const [q, setQ] = useState('')
  const [active, setActive] = useState(-1)
  const [order] = useState(() => groupOrder(current))

  // AI 표면 — 없으면(비서 없는 워크스페이스·테스트) 「AI에게 검색 요청하기」를 숨긴다.
  const ai = useOptionalAssistant()
  const chat = useContext(ChatSessionContext)
  const canAskAi = ai != null && chat != null

  const trimmed = q.trim()
  const term = useDebounceValue(trimmed, SEARCH_DEBOUNCE_MS)
  const searchable = isSearchableTerm(term)
  const { kind, groups, visible, fetching } = useSearchQueries(tab, term, searchable, order)
  // 입력이 디바운스·응답보다 앞서 있으면 보이는 줄은 이전 검색어의 결과다 — 그동안 Enter 로 엉뚱한 곳을 열지 않게 막는다.
  const settled = term === trimmed && !fetching
  const showResults = searchable && trimmed.length > 0

  // 고른 줄이 보이게 스크롤(jsdom 에는 없어 optional).
  useEffect(() => {
    if (active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, listId])

  const changeTab = (next: SearchTabId) => {
    setTab(next)
    setActive(-1)
  }

  const pick = (hit: SearchHit, newTab: boolean) => {
    pushRecent(trimmed)
    if (newTab) {
      // 새 탭 — 팔레트는 유지해 다음 결과도 이어 연다.
      window.open(hit.href, '_blank', 'noopener')
      return
    }
    onClose()
    // 전체 화면 AI 가 콘텐츠를 덮고 있으면 이동한 화면이 보이지 않는다 — 히스토리를 건드리지 않고 옆 패널로 내린다.
    if (ai?.mode === 'fullscreen') ai.dismiss('side')
    navigate(hit.href)
  }

  const askAi = () => {
    if (!canAskAi || !trimmed) return
    onClose()
    if (ai.mode === 'closed') ai.open('side')
    chat.newSession()
    void chat.submitQuery(`「${trimmed}」 검색해 줘`)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(e)) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const down = e.key === 'ArrowDown'
      // 종류 탭에서 ↓ 가 마지막 줄에 닿으면 처음으로 돌지 않고 다음 쪽을 받는다.
      if (down && tab !== 'all' && active === visible.length - 1 && kind.hasNextPage) {
        if (!kind.isFetchingNextPage) void kind.fetchNextPage()
        return
      }
      setActive((cur) => moveActive(cur, down ? 1 : -1, visible.length))
    } else if (e.key === 'Tab') {
      // 다음/이전 탭 — 기본 포커스 이동은 막아 입력 포커스를 유지한다.
      e.preventDefault()
      const i = SEARCH_TABS.findIndex((t) => t.id === tab)
      const n = SEARCH_TABS.length
      changeTab(SEARCH_TABS[(i + (e.shiftKey ? -1 : 1) + n) % n].id)
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        e.preventDefault()
        askAi()
        return
      }
      const target = showResults && settled ? visible[active >= 0 ? active : 0] : undefined
      if (target) {
        e.preventDefault()
        pick(target, e.metaKey || e.ctrlKey)
      }
    }
  }

  /** 결과 줄 하나 — 보이는 줄 전체에서의 인덱스로 활성·id 를 정한다. */
  const rowFor = (hit: SearchHit) => {
    const i = visible.findIndex((v) => v.key === hit.key)
    return (
      <SearchResultRow
        key={hit.key}
        hit={hit}
        q={term}
        id={`${listId}-${i}`}
        active={i === active}
        onPick={pick}
        onHover={() => setActive(i)}
      />
    )
  }

  const hint = shortcutHint()
  return (
    <>
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          autoFocus
          data-testid="global-search-input"
          role="combobox"
          aria-label="통합 검색"
          aria-expanded={showResults}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          placeholder="모든 앱에서 찾기"
          // GET 요청 줄 길이 상한(WP-732) — 긴 본문을 붙여 넣어도 서버가 요청을 거절하지 않게 자른다.
          maxLength={SEARCH_QUERY_MAX_LENGTH}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            // 검색어가 바뀌면 고른 줄을 처음으로 — 이전 결과의 인덱스가 새 결과에 남지 않게.
            setActive(-1)
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline" title={`새 탭으로 열기: ${hint.newTab}`}>
          ↑↓ · ↵ · Tab · esc
        </span>
      </div>
      <div role="tablist" aria-label="검색할 앱" className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5">
        {SEARCH_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            tabIndex={-1}
            aria-selected={t.id === tab}
            data-testid={`global-search-tab-${t.id}`}
            // 클릭해도 입력 포커스를 빼앗기지 않게.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => changeTab(t.id)}
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-xs',
              t.id === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={listId} className="flex min-h-0 flex-1 flex-col">
        {!showResults ? (
          <RecentSearchList
            hasInput={trimmed.length > 0}
            onPick={(r) => {
              setQ(r)
              setActive(-1)
              inputRef.current?.focus()
            }}
          />
        ) : tab === 'all' ? (
          <SearchAllResults order={order} groups={groups} term={term} rowFor={rowFor} onOpenTab={changeTab} />
        ) : (
          <SearchKindResults
            app={tab}
            term={term}
            current={current}
            query={kind}
            hits={visible}
            rowFor={rowFor}
            onGoAll={() => changeTab('all')}
          />
        )}
        {showResults && canAskAi && (
          <button
            type="button"
            data-testid="global-search-ask-ai"
            onMouseDown={(e) => e.preventDefault()}
            onClick={askAi}
            className="shrink-0 border-t px-3 py-2 text-left text-sm text-primary hover:bg-accent"
          >
            AI에게 검색 요청하기
          </button>
        )}
      </div>
    </>
  )
}
