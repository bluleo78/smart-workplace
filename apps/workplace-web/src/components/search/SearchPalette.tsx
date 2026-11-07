// 통합 검색 팔레트(WP-1353) — 화면 가운데 모달. 입력 + 앱 종류 탭 + 결과(종류 탭은 한 앱 20건씩, 「전체」는 앱별 3건 묶음).
// 상단 이슈 전용 펼침 검색(WP-1324)을 대체한다. 열릴 때마다 본문이 새로 마운트돼 탭=지금 앱·검색어=빈 값으로 시작한다.
// 다른 화면이 openSearchPalette({ q, app }) 로 열면 그 검색어·탭으로 시작한다(WP-1356, 드라이브 「드라이브 전체에서 찾기」).
// 휴대폰(lg 미만, WP-1354)에서는 같은 본문을 전체 화면으로 그린다 — 맨 위 입력 + 「취소」, 결과 목록을 터치로 밀면 키보드를 내린다.
// 히스토리는 데스크톱에서 쓰지 않고, 휴대폰은 호스트(SearchPaletteHost)가 항목 하나를 넣어 뒤로 가기로 닫히게 한다 —
// 그래서 결과로 이동할 때 그 항목이 남아 있으면 그 위에 쌓지 않고 대체한다(이동한 화면에서 뒤로 가면 검색 전 화면).
// 한글 조합 중(isComposing)에는 모든 키를 무시한다.
import { Search } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { type KeyboardEvent, useContext, useEffect, useId, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useOptionalAssistant } from '@/components/ai/AIAssistantContext'
import { RawSheetContent } from '@/components/mobile/RawSheetContent'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ChatSessionContext } from '@/hooks/chat-session-context'
import { useDebounceValue } from '@/hooks/useDebounceValue'
import { useIsMobile } from '@/hooks/useIsMobile'
import { chatLinkSessionId, withChatParam } from '@/lib/aiChatLink'
import { hasLiveStateMark } from '@/lib/historyParam'
import { isImeComposing } from '@/lib/imeKey'
import { SEARCH_QUERY_MAX_LENGTH } from '@/lib/searchLimits'
import { cn } from '@/lib/utils'

import { pushRecent } from './recentSearches'
import { RecentSearchList } from './RecentSearchList'
import { SearchAllResults } from './SearchAllResults'
import { currentAppFromPath, groupOrder, SEARCH_TABS, type SearchTabId } from './searchApps'
import { SearchKindResults } from './SearchKindResults'
import { SEARCH_PALETTE_HISTORY_KEY, type SearchPaletteSession } from './searchPaletteStore'
import type { SearchHit } from './searchProviders'
import { SearchResultRow } from './SearchResultRow'
import { moveActive, newTabHint, SEARCH_DEBOUNCE_MS } from './searchRules'
import { useSearchQueries } from './useSearchQueries'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 연 세션 — 처음 검색어·탭을 정하고, 세션이 바뀌면 본문을 새로 마운트한다. 없으면 빈 검색어·지금 앱 탭. */
  session?: SearchPaletteSession | null
  /**
   * 팔레트가 닫힌 뒤(휴대폰: 히스토리 항목을 걷어 낸 뒤) 할 일을 맡긴다 — 「AI에게 검색 요청하기」가 AI 시트를 여는 데 쓴다.
   * 걷어 내기(history.back)는 비동기라 그 전에 AI 시트가 자기 항목을 넣으면 함께 되돌려져 닫힌다. 없으면 바로 실행한다(데스크톱).
   */
  afterClose?: (fn: () => void) => void
}

/** 팔레트 껍데기 — 대화상자(배경·포커스 가두기·Esc)만 맡고 상태는 열릴 때마다 새로 만드는 본문에 둔다. 휴대폰은 전체 화면 껍데기. */
export function SearchPalette({ open, onOpenChange, session, afterClose }: Props) {
  const isMobile = useIsMobile()
  // Esc — AI 패널의 전역 Esc 처리까지 닿지 않게 기본 동작을 막고(defaultPrevented) 검색만 닫는다. 조합 중 Esc 는 조합 취소 몫.
  const onEscapeKeyDown = (e: globalThis.KeyboardEvent) => {
    e.preventDefault()
    if (!e.isComposing) onOpenChange(false)
  }
  const body = (
    <>
      <DialogTitle className="sr-only">통합 검색</DialogTitle>
      <DialogDescription className="sr-only">대화·메일·작업·드라이브·노트·연락처를 앱 종류별로 찾습니다.</DialogDescription>
      <PaletteBody
        key={session?.id}
        initialQ={session?.q ?? ''}
        initialTab={session?.app ?? null}
        onClose={() => onOpenChange(false)}
        afterClose={afterClose ?? ((fn) => fn())}
        mobile={isMobile}
      />
    </>
  )
  if (isMobile) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          {/* 원시 Content — ui/DialogContent 의 data-slot 이 붙으면 index.css 의 휴대폰 대화상자 규칙(탭바 위 가운데·키보드 열림 시 가운데·
              max-height·바깥 스크롤)이 전체 화면을 줄이고 옮긴다. 「채팅·이슈로 보내기」 전체 화면(SendToChatMobileFrame)과 같은 방식으로
              보이는 뷰포트(--vv-top·--vvh)에 붙여 키보드가 올라와도 입력·결과가 가려지지 않게 한다. 입력 autoFocus 를 막지 않는다(키보드). */}
          <RawSheetContent
            data-testid="global-search"
            onEscapeKeyDown={onEscapeKeyDown}
            className="fixed inset-x-0 top-[var(--vv-top,0px)] z-50 flex h-[var(--vvh,100dvh)] flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none [:root[data-keyboard-open]_&]:pb-0"
          >
            {body}
          </RawSheetContent>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="global-search"
        showCloseButton={false}
        // 화면 가운데·폭 min(680px, 100vw-32px)·높이 약 60vh(내부 스크롤).
        className="flex h-[60vh] w-[min(680px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        onEscapeKeyDown={onEscapeKeyDown}
      >
        {body}
      </DialogContent>
    </Dialog>
  )
}

function PaletteBody({
  initialQ,
  initialTab,
  onClose,
  afterClose,
  mobile,
}: {
  /** 처음 검색어 — 바깥에서 검색어를 정해 연 경우(WP-1356). 보통은 빈 값. */
  initialQ: string
  /** 처음 탭 — 바깥에서 앱을 정해 연 경우. null 이면 지금 앱(없으면 전체). */
  initialTab: SearchTabId | null
  onClose: () => void
  /** 닫힌 뒤 할 일 맡기기 — Props.afterClose 참고. */
  afterClose: (fn: () => void) => void
  /** 휴대폰 전체 화면인가 — 「취소」 버튼·목록 터치 시 키보드 내리기. */
  mobile: boolean
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  // 열 때의 현재 앱 — 탭 초기값과 「전체」 묶음 순서의 기준(열려 있는 동안 고정).
  const [current] = useState(() => currentAppFromPath(location.pathname))
  const [tab, setTab] = useState<SearchTabId>(initialTab ?? current ?? 'all')
  // 바깥에서 준 검색어도 입력 길이 상한을 지킨다 — 입력란 maxLength 는 타이핑에만 걸린다.
  const [q, setQ] = useState(() => initialQ.slice(0, SEARCH_QUERY_MAX_LENGTH))
  const [active, setActive] = useState(-1)
  const [order] = useState(() => groupOrder(current))

  // AI 표면 — 없으면(비서 없는 워크스페이스·테스트) 「AI에게 검색 요청하기」를 숨긴다.
  const ai = useOptionalAssistant()
  const chat = useContext(ChatSessionContext)
  const canAskAi = ai != null && chat != null

  const trimmed = q.trim()
  const term = useDebounceValue(trimmed, SEARCH_DEBOUNCE_MS)
  // 검색 가능 여부와 앱별 최소 길이 판정은 각 provider 의 isSearchable 에 있고, 어느 앱이든 보낼 만하면 결과 영역을 연다.
  const { kind, groups, visible, indexByKey, searchable, fetching } = useSearchQueries(tab, term, order)
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
    // 휴대폰에서 연 팔레트의 히스토리 항목이 아직 있으면 그 위에 쌓지 않고 대체한다 — 쌓으면 이동한 화면에서 뒤로 갈 때
    // 같은 주소의 빈 항목(검색이 열렸던 자리)을 한 번 더 거친다. 대체했으니 닫기 쪽(useSheetHistory)은 걷어 낼 항목이 없어 되돌리지 않는다.
    // 데스크톱은 항목이 없어 그대로 push 다.
    const replace = hasLiveStateMark(SEARCH_PALETTE_HISTORY_KEY)
    onClose()
    // 전체 화면 AI 가 콘텐츠를 덮고 있으면 이동한 화면이 보이지 않는다 — 히스토리를 건드리지 않고 옆 패널로 내린다.
    if (ai?.mode === 'fullscreen') ai.dismiss('side')
    // AI 대화 결과 — 화면은 그대로 두고 aiChat 파라미터만 붙여 AI 패널이 그 대화를 복원하게 한다(AiChatDeepLink).
    const chatId = chatLinkSessionId(hit.href)
    if (chatId) {
      navigate({ search: withChatParam(location.search, chatId) }, { replace })
      return
    }
    navigate(hit.href, { replace })
  }

  const askAi = () => {
    if (!canAskAi || !trimmed) return
    onClose()
    // AI 시트 열기는 팔레트가 닫힌 뒤로 미룬다(휴대폰: 검색 히스토리 항목을 걷어 낸 뒤 — 먼저 열면 AI 항목까지 함께 되돌려진다).
    const assistant = ai
    afterClose(() => {
      if (assistant.mode === 'closed') assistant.open('side')
    })
    chat.newSession()
    void chat.submitQuery(`「${trimmed}」 검색해 줘`)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(e.nativeEvent)) return
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
  const rowFor = (hit: SearchHit, compact?: boolean) => {
    const i = indexByKey.get(hit.key) ?? -1
    return (
      <SearchResultRow
        key={hit.key}
        hit={hit}
        q={term}
        id={`${listId}-${i}`}
        active={i === active}
        onPick={pick}
        onHover={() => setActive(i)}
        compact={compact}
      />
    )
  }

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
        {/* 휴대폰 전체 화면은 Esc·바깥이 없으니 닫는 길을 입력 줄 오른쪽에 둔다(시스템 뒤로 가기와 같은 닫기). */}
        {mobile && (
          <button
            type="button"
            data-testid="global-search-cancel"
            onClick={onClose}
            className="-my-2 h-11 shrink-0 px-2 text-sm text-primary"
          >
            취소
          </button>
        )}
        {/* 키 안내는 키보드가 있는 데스크톱(lg 이상)에만. */}
        <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline" title={`새 탭으로 열기: ${newTabHint()}`}>
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
      <div
        id={listId}
        className="flex min-h-0 flex-1 flex-col"
        // 휴대폰 — 결과를 손가락으로 밀면 입력을 놓아 키보드를 내린다(안쪽 어느 스크롤 영역이든 여기까지 올라온다).
        // onScroll 이 아닌 이유: 무한 스크롤·고른 줄 scrollIntoView 도 스크롤을 일으켜 타이핑 중 키보드가 내려간다.
        onTouchMove={mobile ? () => inputRef.current?.blur() : undefined}
      >
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
