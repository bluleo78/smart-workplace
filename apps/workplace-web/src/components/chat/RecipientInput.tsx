// 새 메시지 compose 의 "받는 사람" 인라인 입력 — 칩 + 검색 입력이 한 줄에 있고, 입력에 포커스하면
// 바로 아래에 후보 목록이 열린다(메일 "받는 사람" 패턴, #883).
//
// 공용 MemberSearchPopover 를 쓰지 않는 이유: 팝오버는 포커스를 자기 안의 검색창으로 가져가므로
// "입력 포커스 = 목록 열림 / 포커스 이탈 = 닫힘" 과 Backspace 칩 제거를 자연스럽게 만들 수 없다.
// 여기서는 포커스가 항상 이 입력에 남고, 목록은 포털 없이 입력 아래에 절대 배치한다.
//
// - 포커스 시 열림, 포커스 이탈 시 닫힘. Esc 는 목록만 닫고 포커스는 유지(타이핑·↓·클릭으로 다시 열림)
// - ↑↓ 이동 + Enter/클릭 선택(cmdk). 선택 후 검색어만 비우고 목록은 유지 — 연달아 고를 수 있다
// - 입력이 비었을 때 Backspace 로 마지막 칩 제거
// - 이미 고른 상대는 목록에서 숨긴다. 상한에 도달하면 목록 대신 안내 문구를 보여준다
//   (입력을 disabled 로 만들면 포커스·Backspace 제거가 죽으므로 입력은 살려 둔다)
import { Command as CommandPrimitive } from 'cmdk'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { AgentBadge } from '@/components/users/AgentBadge'
import type { MemberPickerCandidate } from '@/hooks/queries/useUserSearch'
import { useUserSearch } from '@/hooks/queries/useUserSearch'
import { useDebounceValue } from '@/hooks/useDebounceValue'
import type { UserKind } from '@/types/user'

type KindFilter = 'ALL' | UserKind

const KIND_LABEL: Record<KindFilter, string> = { ALL: '전체', HUMAN: '사람', AGENT: '에이전트' }

export interface RecipientInputProps {
  selected: MemberPickerCandidate[]
  onAdd: (user: MemberPickerCandidate) => void
  onRemove: (id: number) => void
  // 선택 가능한 최대 인원. 도달하면 목록 대신 안내 문구를 보여준다.
  max: number
  // 후보에서 완전히 제외할 사용자 id(본인).
  excludeUserIds?: Set<number>
  // 마운트 시 입력에 포커스해 목록을 바로 연다.
  autoFocus?: boolean
  // Tab 으로 다음 칸(메시지 입력)에 직접 포커스 — 포커스를 옮겼으면 true. 입력창 앞의 ＋ 버튼을 건너뛰게 한다(#883, WP-235).
  onTabOut?: () => boolean
}

export function RecipientInput({
  selected,
  onAdd,
  onRemove,
  max,
  excludeUserIds,
  autoFocus = false,
  onTabOut,
}: RecipientInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL')
  // cmdk 하이라이트 값(후보 id 문자열). 아래에서 현재 후보에 없는 값이면 첫 후보로 보정한다.
  const [highlighted, setHighlighted] = useState('')
  const debounced = useDebounceValue(query, 300)
  const search = useUserSearch(debounced, kindFilter)

  const selectedIds = new Set(selected.map((u) => u.id))
  const isFull = selected.length >= max
  // 백엔드가 kind/검색어로 이미 좁혔으므로 제외 대상·비활성·이미 고른 상대만 걸러낸다.
  const items = (search.data?.content ?? []).filter(
    (u) => !excludeUserIds?.has(u.id) && u.isActive !== false && !selectedIds.has(u.id),
  )
  // 방금 고른 후보는 목록에서 사라지므로 하이라이트가 허공을 가리키게 된다 — 그러면 Enter 연속 선택이
  // 끊기므로 첫 후보로 되돌린다.
  const activeValue = items.some((u) => String(u.id) === highlighted)
    ? highlighted
    : String(items[0]?.id ?? '')

  // 입력한 검색어의 결과가 아직 도착하지 않은 상태(디바운스 대기 또는 조회 중) — 화면의 목록은 이전 검색어 것이다.
  const isStale = query.trim() !== debounced.trim() || search.isFetching

  // 진입 즉시 상대를 고를 수 있게 포커스 — onFocus 가 목록을 연다.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // cmdk Input 은 aria-expanded 를 항상 true 로 덮어쓴다 — 목록을 닫을 수 있는 이 입력에서는 실제 상태로 맞춘다.
  useEffect(() => {
    inputRef.current?.setAttribute('aria-expanded', String(open))
  }, [open])

  const handleSelect = (user: MemberPickerCandidate) => {
    onAdd(user)
    setQuery('')
    // 고른 상대를 나중에 칩에서 지우면 목록에 돌아오는데, 하이라이트가 그 행으로 튀지 않게 비워 둔다.
    setHighlighted('')
  }

  const handleRemove = (id: number) => {
    onRemove(id)
    // 제거 버튼이 DOM 에서 사라지며 포커스가 body 로 빠지지 않게 입력으로 되돌린다.
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 한글 조합 중의 Backspace/Esc 는 조합 편집용 — 칩 제거·닫기로 해석하지 않는다.
    // (Safari 는 조합 확정 직후 keydown 을 isComposing=false, keyCode=229 로 보낸다.)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter') {
      // 이전 검색어의 목록이 남아 있는 동안 Enter 를 누르면 엉뚱한 상대가 추가된다 — 결과가 올 때까지 무시.
      // (cmdk 는 defaultPrevented 인 키 입력을 건너뛴다.)
      if (isStale) e.preventDefault()
    } else if (e.key === 'Home' || e.key === 'End') {
      // cmdk 가 Home/End 를 목록 처음·끝 이동으로 가로채 입력 캐럿이 움직이지 않는다 — 입력에 남겨 둔다.
      e.stopPropagation()
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation()
        setOpen(false)
      }
    } else if (e.key === 'Backspace') {
      if (query === '' && selected.length > 0) onRemove(selected[selected.length - 1].id)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      setOpen(true)
    } else if (e.key === 'Tab' && !e.shiftKey && onTabOut?.()) {
      e.preventDefault()
    }
  }

  return (
    <Command
      shouldFilter={false}
      // Ctrl+N/P/J/K 하이라이트 이동 해제 — Ctrl+K 는 AI 패널 단축키와 겹친다.
      vimBindings={false}
      label="받는 사람 검색"
      value={activeValue}
      onValueChange={setHighlighted}
      // 목록을 포털 없이 아래로 띄우므로 Command 기본 overflow-hidden·배경을 해제한다.
      className="relative h-auto overflow-visible rounded-none bg-transparent"
      // 포커스가 이 영역(입력·칩 제거 버튼·목록) 밖으로 나갈 때만 닫는다.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <div
        data-testid="new-message-recipients"
        className="flex min-h-9 cursor-text flex-wrap items-center gap-1 rounded-md border border-input px-2 py-0.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30"
        // 라벨·칩·빈 곳 어디를 눌러도 입력에 포커스 — 그대로 두면 포커스가 cmdk root(tabIndex=-1)로 빠져
        // 목록은 열려 있는데 타이핑이 먹지 않는다. 입력과 칩 제거 버튼은 제 동작을 하게 둔다.
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest('input, button')) {
            e.preventDefault()
            inputRef.current?.focus()
          }
        }}
      >
        {/* 모바일은 입력 글자(16px)와 격차가 커 보여 한 단계 키운다(M3). */}
        <span className="text-xs text-muted-foreground max-lg:text-sm">받는 사람:</span>
        {selected.map((u) => (
          <span
            key={u.id}
            data-testid={`recipient-chip-${u.id}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-sm"
          >
            <span className="truncate">{u.name}</span>
            {/* AGENT 수신자면 보라색 봇 배지 표시 */}
            {u.kind === 'AGENT' && <AgentBadge size="xs" />}
            {/* hover 피드백 + 클릭 영역 확보 (p-0.5 → 최소 16×16px, rounded-full + transition) */}
            <button
              type="button"
              aria-label={`${u.name} 제거`}
              onClick={() => handleRemove(u.id)}
              className="rounded-full p-0.5 outline-hidden transition-colors hover:bg-accent-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <CommandPrimitive.Input
          ref={inputRef}
          value={query}
          onValueChange={(v) => {
            setQuery(v)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          // Esc 로 닫은 뒤(포커스는 그대로) 다시 누르면 열린다.
          onClick={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="이름·아이디·이메일로 검색"
          aria-label="받는 사람 검색"
          data-testid="new-message-recipient-input"
          className="h-7 min-w-0 shrink grow basis-[180px] bg-transparent text-base outline-hidden md:text-sm placeholder:text-muted-foreground"
        />
      </div>

      {open && (
        <div
          data-testid="recipient-suggestions"
          className="absolute top-full left-0 z-50 mt-1 w-[360px] max-w-full rounded-md border bg-popover text-popover-foreground shadow-md"
          // 행·탭을 누르면 입력이 먼저 blur 되어 목록이 닫히고 클릭이 허공에 떨어진다 — 포커스 이동을 막는다.
          onMouseDown={(e) => e.preventDefault()}
        >
          {isFull ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground" data-testid="recipient-limit-notice">
              최대 {max}명까지 선택할 수 있습니다
            </p>
          ) : (
            <>
              <div className="flex gap-1 overflow-x-auto border-b p-2" role="tablist" aria-label="kind 필터">
                {(['ALL', 'HUMAN', 'AGENT'] as const).map((k) => (
                  <Button
                    key={k}
                    type="button"
                    size="sm"
                    variant={kindFilter === k ? 'default' : 'ghost'}
                    onClick={() => setKindFilter(k)}
                    role="tab"
                    aria-selected={kindFilter === k}
                    // Tab 은 입력에서 곧바로 메시지 입력창으로 넘어가야 한다 — 탭 버튼은 포인터 전용.
                    tabIndex={-1}
                    // 터치(coarse)에선 44px 터치 타깃(M3). 마우스 환경은 sm 높이 그대로.
                    className="pointer-coarse:min-h-11"
                    data-testid={`member-search-filter-${k}`}
                  >
                    {KIND_LABEL[k]}
                  </Button>
                ))}
              </div>
              {/* 모바일에서 가상 키보드 위 영역을 넘지 않게 높이를 화면 비율로도 제한한다. */}
              <CommandList className="max-h-[min(300px,35dvh)]">
                {search.isLoading ? (
                  <CommandEmpty>검색 중…</CommandEmpty>
                ) : search.isError ? (
                  <CommandEmpty className="py-6 text-center text-sm text-destructive">검색에 실패했습니다</CommandEmpty>
                ) : items.length === 0 ? (
                  <CommandEmpty>
                    {debounced.trim().length < 1 ? '추가할 수 있는 후보가 없습니다' : '결과가 없습니다'}
                  </CommandEmpty>
                ) : (
                  <CommandGroup>
                    {items.map((u) => (
                      <CommandItem
                        key={u.id}
                        value={String(u.id)}
                        onSelect={() => handleSelect(u)}
                        data-testid={`member-search-row-${u.id}`}
                        className="flex items-center gap-2 pointer-coarse:min-h-11"
                      >
                        {/* 폭이 좁으면 아이디부터 줄인다 — 이름과 에이전트 배지가 먼저 보여야 상대를 구분할 수 있다. */}
                        <span className="max-w-[60%] shrink-0 truncate font-medium">{u.name}</span>
                        {/* 아이디가 이메일이면 이미 '@' 가 있어 앞에 또 붙이면 '@a@b.com' 이 된다 — 그대로 보인다. */}
                        <span className="min-w-0 truncate text-xs text-muted-foreground">
                          {u.username.includes('@') ? u.username : `@${u.username}`}
                        </span>
                        {u.kind === 'AGENT' && <AgentBadge size="xs" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </>
          )}
        </div>
      )}
    </Command>
  )
}
