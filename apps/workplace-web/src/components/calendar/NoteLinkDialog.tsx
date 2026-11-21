// 「노트 연결」 창(WP-1701) — 일정 제목으로 노트를 찾아 하나 고르고 「연결」.
// 열면 검색 칸에 일정 제목을 채워 전체 선택하고 바로 찾는다. 입력이 300ms 멈추면 다시 찾고(이전 요청은 취소),
// 행을 누르면 고르고, 두 번 누르거나 고른 행에서 Enter 면 바로 잇는다. 잇기 실패는 창 안에 보이고 창은 열린 채 둔다.
import { useQuery } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { type ReactNode, type RefObject, useRef, useState } from 'react'

import { wikiApi } from '@/api/wiki'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormError } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { useDebounceValue } from '@/hooks/useDebounceValue'
import { extractApiError } from '@/lib/api-error'
import { noteMetaLine } from '@/lib/eventNote'
import { cn } from '@/lib/utils'
import type { WikiSearchResult } from '@/types/wiki'

import { NoteSummary } from './NoteSummary'

/** 입력이 멈춘 뒤 이만큼 기다렸다가 찾는다 */
const SEARCH_DEBOUNCE_MS = 300
/** 한 번에 보여 줄 결과 수 */
const SEARCH_SIZE = 20

interface NoteLinkDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** 검색 칸에 미리 채울 말 — 일정 제목 */
  initialQuery: string
  /** 고른 노트를 잇는다 — 거절하면 창 안에 오류를 보이고 열어 둔다 */
  onLink: (page: WikiSearchResult) => Promise<void>
  /** 결과가 없을 때 곁들일 단추(WP-1702 「회의록 만들기」 자리) */
  emptyAction?: ReactNode
}

/** 창 본문 — 열릴 때마다 새로 마운트되어 검색어·고른 행·오류가 처음 상태로 시작한다. */
function NoteLinkBody({
  initialQuery,
  onLink,
  onClose,
  emptyAction,
  inputRef,
}: Pick<NoteLinkDialogProps, 'initialQuery' | 'onLink' | 'emptyAction'> & {
  onClose: () => void
  inputRef: RefObject<HTMLInputElement | null>
}) {
  const [query, setQuery] = useState(initialQuery)
  // 디바운스된 검색어 — 훅은 처음 값을 그대로 돌려주므로 열자마자 일정 제목으로 바로 찾고, 이후 입력만 300ms 기다린다(WP-1701)
  const debounced = useDebounceValue(query.trim(), SEARCH_DEBOUNCE_MS)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 검색어를 다 지우면 요청 없이 안내만 — 이전 결과도 비운다
  const hasQuery = query.trim() !== '' && debounced !== ''
  const { data, isFetching } = useQuery({
    queryKey: ['wiki', 'note-link-search', debounced],
    // react-query 가 검색어가 바뀌면 signal 로 이전 요청을 취소한다
    queryFn: ({ signal }) => wikiApi.search(debounced, undefined, { size: SEARCH_SIZE, signal }).then((r) => r.data),
    enabled: debounced !== '',
    retry: false,
  })
  const results = hasQuery ? (data ?? []) : []
  const selected = results.find((r) => r.id === selectedId) ?? null

  async function link(page: WikiSearchResult | null) {
    if (!page || linking) return
    setLinking(true)
    setError(null)
    try {
      await onLink(page)
      onClose()
    } catch (e) {
      setError(extractApiError(e, '노트를 연결하지 못했습니다'))
    } finally {
      setLinking(false)
    }
  }

  return (
    <>
      <div className="relative">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="노트 제목 검색"
          aria-label="노트 제목 검색"
          autoComplete="off"
          className="pr-9"
          data-testid="note-link-search"
        />
        {query && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute top-1/2 right-1.5 -translate-y-1/2"
            aria-label="검색어 지우기"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="max-h-72 min-h-24 overflow-y-auto" data-testid="note-link-results">
        {!hasQuery ? (
          <p className="py-6 text-center text-sm text-muted-foreground">노트 제목 검색</p>
        ) : results.length === 0 ? (
          isFetching ? null : (
            <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground">
              <p>검색 결과 없음</p>
              {emptyAction}
            </div>
          )
        ) : (
          <ul role="listbox" aria-label="노트 검색 결과" className="space-y-1">
            {results.map((r) => {
              const isSelected = r.id === selectedId
              return (
                <li
                  key={r.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  data-testid="note-link-result"
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected ? 'border-primary bg-accent' : 'border-transparent hover:bg-accent/50',
                  )}
                  onClick={() => setSelectedId(r.id)}
                  onDoubleClick={() => void link(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void link(r)
                    } else if (e.key === ' ') {
                      e.preventDefault()
                      setSelectedId(r.id)
                    }
                  }}
                >
                  <NoteSummary title={r.title} meta={noteMetaLine(r)} />
                  {isSelected && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <FormError data-testid="note-link-error">{error}</FormError>

      {/* 390px 에서 단추가 세로로 쌓이고 「연결」이 위 — 공용 DialogFooter 의 flex-col-reverse */}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} data-testid="note-link-cancel">
          취소
        </Button>
        <Button type="button" disabled={!selected || linking} onClick={() => void link(selected)} data-testid="note-link-submit">
          연결
        </Button>
      </DialogFooter>
    </>
  )
}

export function NoteLinkDialog({ open, onOpenChange, initialQuery, onLink, emptyAction }: NoteLinkDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="note-link-dialog"
        // 열자마자 검색 칸에 포커스 + 채운 제목 전체 선택 — 바로 새 말로 덮어쓸 수 있게
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
          inputRef.current?.select()
        }}
      >
        <DialogHeader>
          <DialogTitle>노트 연결</DialogTitle>
          <DialogDescription className="sr-only">일정에 연결할 노트를 찾아 고릅니다</DialogDescription>
        </DialogHeader>
        <NoteLinkBody
          initialQuery={initialQuery}
          onLink={onLink}
          emptyAction={emptyAction}
          onClose={() => onOpenChange(false)}
          inputRef={inputRef}
        />
      </DialogContent>
    </Dialog>
  )
}
