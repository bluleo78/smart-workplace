import { useQuery } from '@tanstack/react-query'
import { Command } from 'cmdk'
import { XIcon } from 'lucide-react'
import { useRef, useState } from 'react'

import { platformUsers } from '../api/platformUsers'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import type { PlatformUserSearchItem } from '../types/platform'
import { inputClassName } from './ui/input'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'

/** 검색을 시작하는 최소 글자 수 — 서버(PlatformUserService.MIN_QUERY_LENGTH)와 맞춘다. */
const MIN_QUERY_LENGTH = 2

interface UserComboboxProps {
  id?: string
  value: PlatformUserSearchItem | null
  onChange: (user: PlatformUserSearchItem | null) => void
  /** 입력 중인 검색어 변경 알림 — "쳤지만 고르지 않은" 상태를 부모가 제출 시 막는 데 쓴다. */
  onQueryChange?: (query: string) => void
  placeholder?: string
  /** 부모 폼이 이 필드에 오류를 띄웠는지 — 다른 입력창처럼 붉은 테두리(aria-invalid)로 표시한다. */
  invalid?: boolean
  'data-testid'?: string
}

// 사용자 자동완성 콤보박스(WP-337, 시안 A).
// 입력창 자체가 검색창 — 타이핑하면 아래에 후보 목록이 뜨고, 고르면 입력창이 "선택된 사용자 카드"로 바뀐다(✕ 로 해제).
// 키보드 ↑↓/Enter 는 cmdk 가 처리한다. 서버가 이미 필터·정렬하므로 cmdk 자체 필터는 끈다(shouldFilter=false).
// 목록은 비모달 Radix Popover 로 띄운다 — 다이얼로그 위의 레이어가 되므로 Esc·바깥 클릭이 목록에만 먹고
// 다이얼로그는 그대로 남는다(호스트 쪽에 별도 처리 불필요). 포커스는 입력창에 남겨 계속 타이핑할 수 있게 한다.
export function UserCombobox({
  id,
  value,
  onChange,
  onQueryChange,
  placeholder,
  invalid,
  'data-testid': testId,
}: UserComboboxProps) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  // Esc·바깥 클릭으로 목록만 닫은 상태 — 입력한 글자는 남기고, 다시 타이핑·포커스·클릭하면 풀린다.
  const [dismissed, setDismissed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const clearRef = useRef<HTMLButtonElement>(null)

  const changeQuery = (next: string) => {
    setQuery(next)
    setDismissed(false)
    onQueryChange?.(next)
  }

  const trimmed = query.trim()
  const debounced = useDebouncedValue(trimmed, 250)
  const searchable = debounced.length >= MIN_QUERY_LENGTH

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['platform-user-search', debounced],
    queryFn: () => platformUsers.search(debounced),
    enabled: searchable,
    staleTime: 30_000,
  })

  // 선택 완료 — 카드 표시. ✕ 로 해제하면 입력창으로 돌아가 바로 다시 검색할 수 있게 포커스를 옮긴다.
  // 입력창이 사라지므로 라벨(htmlFor=id)은 ✕ 버튼이 받는다.
  if (value) {
    return (
      <div
        className="border-input dark:bg-input/30 flex min-h-9 items-center gap-2.5 rounded-md border px-2.5 py-1.5"
        data-testid={testId ? `${testId}-selected` : undefined}
      >
        <UserAvatar name={value.name} />
        <UserLines user={value} />
        <button
          ref={clearRef}
          id={id}
          type="button"
          aria-label="소유자 선택 해제"
          className="text-muted-foreground hover:text-foreground hover:bg-accent -my-1 -mr-1 ml-auto flex size-10 shrink-0 items-center justify-center rounded-md md:size-8"
          onClick={() => {
            onChange(null)
            changeQuery('')
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
          data-testid={testId ? `${testId}-clear` : undefined}
        >
          <XIcon className="size-4" />
        </button>
      </div>
    )
  }

  const open = focused && !dismissed && trimmed.length > 0
  // 디바운스가 따라잡기 전(타이핑 직후)엔 보이는 결과가 직전 검색어의 것이다 — 목록은 깜빡이지 않게 남기되
  // 고를 수 없게(disabled) 해서 지금 입력과 맞지 않는 사용자가 Enter 로 선택되는 일을 막는다.
  const stale = trimmed !== debounced
  const pending = stale || isFetching
  const hint =
    trimmed.length < MIN_QUERY_LENGTH
      ? `${MIN_QUERY_LENGTH}글자 이상 입력하세요`
      : results.length > 0
        ? null
        : pending
          ? '검색 중…'
          : '일치하는 사용자가 없습니다'

  return (
    <Popover open={open} onOpenChange={(next) => !next && setDismissed(true)}>
      <Command shouldFilter={false} loop>
        <PopoverAnchor asChild>
          <Command.Input
            ref={inputRef}
            id={id}
            value={query}
            onValueChange={changeQuery}
            // Esc 로 닫은 목록은 다시 포커스하거나 클릭하면 열린다.
            onFocus={() => {
              setFocused(true)
              setDismissed(false)
            }}
            onClick={() => setDismissed(false)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            autoComplete="off"
            // 1Password 등 비밀번호 관리자가 계정 필드로 오인해 아이콘을 붙이지 않게 한다.
            data-1p-ignore
            aria-invalid={invalid || undefined}
            data-testid={testId}
            className={inputClassName}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) p-1"
          // 열릴 때 포커스를 목록으로 빼앗지 않는다 — 입력창에서 계속 타이핑.
          onOpenAutoFocus={(e) => e.preventDefault()}
          // 입력창(앵커) 클릭은 바깥 클릭이 아니다.
          onInteractOutside={(e) => {
            if (inputRef.current?.contains(e.target as Node)) e.preventDefault()
          }}
          // 항목 클릭 시 입력창 blur 로 목록이 먼저 닫히지 않게 mousedown 기본동작을 막는다.
          onMouseDown={(e) => e.preventDefault()}
        >
          <Command.List
            className="max-h-64 overflow-y-auto"
            data-testid={testId ? `${testId}-list` : undefined}
          >
            {hint ? (
              <Hint>{hint}</Hint>
            ) : (
              results.map((user) => (
                <Command.Item
                  key={user.id}
                  value={String(user.id)}
                  disabled={stale}
                  onSelect={() => {
                    onChange(user)
                    changeQuery('')
                    // 입력창이 카드로 바뀌며 사라지므로 포커스를 ✕ 버튼으로 옮긴다(키보드 흐름 유지).
                    requestAnimationFrame(() => clearRef.current?.focus())
                  }}
                  className="data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground flex min-h-11 cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 md:min-h-0"
                  data-testid={testId ? `${testId}-option` : undefined}
                >
                  <UserAvatar name={user.name} />
                  <UserLines user={user} highlight={debounced} />
                </Command.Item>
              ))
            )}
          </Command.List>
        </PopoverContent>
      </Command>
    </Popover>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="text-muted-foreground px-2 py-2 text-xs">{children}</div>
}

// 이름 첫 글자 원형 아바타.
function UserAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="bg-primary/15 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium"
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

// 이름(1줄) + 보조줄(이메일, 없으면 "아이디 · 이메일 없음"). 긴 값은 말줄임.
// 이 서비스는 아이디가 곧 이메일인 사용자가 많아, 이메일이 있으면 아이디는 굳이 반복하지 않는다.
// 이메일이 없으면 긴 아이디만 말줄임하고 "· 이메일 없음" 꼬리는 항상 보이게 떼어 둔다(모바일 폭에서 상태 정보가 잘리지 않게).
function UserLines({ user, highlight }: { user: PlatformUserSearchItem; highlight?: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-sm font-medium" title={user.name}>
        <Highlight text={user.name} query={highlight} />
      </span>
      {user.email ? (
        <span className="text-muted-foreground truncate text-xs" title={user.email}>
          <Highlight text={user.email} query={highlight} />
        </span>
      ) : (
        <span className="text-muted-foreground flex min-w-0 text-xs">
          <span className="truncate" title={user.username}>
            아이디 <Highlight text={user.username} query={highlight} />
          </span>
          <span className="shrink-0">&nbsp;· 이메일 없음</span>
        </span>
      )}
    </span>
  )
}

// 검색어와 일치하는 첫 구간을 강조(대소문자 무시).
function Highlight({ text, query }: { text: string; query?: string }) {
  if (!query) return <>{text}</>
  const at = text.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="text-primary bg-transparent font-semibold">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  )
}
