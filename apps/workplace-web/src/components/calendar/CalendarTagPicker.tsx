// 일정에 태그를 붙이고 떼는 팝오버 피커 (WP-714, 시안 ③).
// 이슈 라벨 피커(LabelPickerPopover, WP-394)와 같은 모양·같은 인라인 「만들기」 흐름이다. 세 조각으로 나눈다(WP-801):
// - TagPickerPopover: 화면만 — 검색/만들기 입력 + 체크 목록 + 「「이름」 태그 만들기」. 체크 상태는 바깥이 쥐고 바뀐 것만 알린다.
// - CalendarTagPicker(바로 저장): 상세 보기 머리 칩 줄. 체크할 때마다 바로 저장한다(시안 문구 「바꾸면 바로 저장」).
//   저장은 한 번에 하나씩 줄을 세운다 — 빠르게 여러 개를 체크해도 서버에는 마지막 선택이 남는다(아래 drain).
// - CalendarTagFormPicker(폼 상태): 일정 편집·새 일정 폼. 체크는 폼 값만 바꾸고, 폼의 「수정」·「저장」을 눌러야 일정과 함께 저장된다
//   (「취소」면 버린다 — 다른 칸과 같게). 새 태그 「만들기」만은 태그 자체를 바로 만든다(붙이기는 폼 저장 때).
// 트리거는 children 으로 받는다 — 상세 보기·편집 폼의 「＋ 태그」 칩.
import { Plus } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useCalendarTags, useCreateCalendarTag, useSetEventTags } from '@/hooks/queries/useCalendarTags'
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter'
import { resolvePalette } from '@/lib/calendarPalette'
import { filterTagsByName, pickTagColor, sameTagIds, tagNameToCreate, tagRefsForIds, toggleTagId } from '@/lib/calendarTag'
import type { CalendarTagRef } from '@/types/calendar'

interface TagPickerPopoverProps {
  /** 체크 표시할 태그 id */
  checkedIds: number[]
  /** 목록의 태그 하나를 체크하거나 풀었다 */
  onToggle: (tagId: number) => void
  /** 새 태그를 만들었다 — 선택에 더한다(목록 재조회 전이라 이름·색까지 넘긴다) */
  onCreated: (tag: CalendarTagRef) => void
  /** 팝오버가 열릴 때 — 바깥이 체크 상태의 출발점을 맞춘다 */
  onOpen: () => void
  /** 팝오버를 여는 트리거(버튼 하나) */
  children: ReactNode
}

/** 태그 붙이기 팝오버 화면 — 검색/만들기 입력 + 체크 목록 + 「「이름」 태그 만들기」. 저장 방식은 감싸는 쪽이 정한다. */
function TagPickerPopover({ checkedIds, onToggle, onCreated, onOpen, children }: TagPickerPopoverProps) {
  const tags = useCalendarTags()
  const createTag = useCreateCalendarTag()
  // Enter 로 만들기 — 한글 조합 Enter·macOS Chrome 꼬리 Enter 는 거른다(공용 훅). 「고객사」 같은 한글 이름이 대표 사례.
  const { handleEnter, onCompositionEnd } = useSingleLineEnter()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  // 빠른 두 번 클릭 가드 — 같은 틱에서 막히는 ref(라벨 피커 WP-458 과 같은 이유: 두 번째 요청은 409 가 된다)
  const creatingRef = useRef(false)

  const list = useMemo(() => tags.data ?? [], [tags.data])
  const filtered = useMemo(() => filterTagsByName(list, search), [list, search])
  // 목록을 받기 전엔 「이미 있음」을 판정할 수 없어 만들기를 내지 않는다(대소문자 무시 정확 일치만 이미 있음)
  const toCreate = tags.isSuccess ? tagNameToCreate(search, list) : null

  /** 새 태그를 이름에서 정한 색으로 만들고 곧바로 선택에 더한다. */
  function createAndAttach() {
    if (toCreate === null || creatingRef.current) return
    creatingRef.current = true
    createTag.mutate(
      { name: toCreate, color: pickTagColor(toCreate) },
      {
        onSuccess: (tag) => {
          onCreated(tag)
          setSearch('')
        },
        onSettled: () => {
          creatingRef.current = false
        },
      },
    )
  }

  function onOpenChange(next: boolean) {
    // 만드는 중에 닫으면 새 태그가 선택에 들기 전에 끝나 일정에 안 붙는다 — 생성이 끝날 때까지 열어 둔다.
    if (!next && (createTag.isPending || creatingRef.current)) return
    if (next) {
      onOpen()
      setSearch('')
    }
    setOpen(next)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        // 휴대폰(390px)에서 화면 끝에 붙지 않게 가장자리에서 16px — 아래 하단 탭바 높이는 앱 공용 PopoverContent 가 더한다(자리가 없으면 위로 뒤집힘, WP-806)
        collisionPadding={16}
        className="w-72 p-2"
        data-testid="calendar-tag-picker"
      >
        <Input
          placeholder="태그 찾기 또는 만들기"
          aria-label="태그 찾기 또는 만들기"
          data-testid="calendar-tag-search"
          value={search}
          maxLength={50}
          onChange={(e) => setSearch(e.target.value)}
          // Enter 로 바로 만들기 — 겹치는 태그가 하나도 없을 때만(「운」으로 걸러 「운영」을 찾던 중이면 새로 만들지 않는다)
          onKeyDown={(e) =>
            handleEnter(e, () => {
              if (filtered.length === 0) createAndAttach()
            })
          }
          onCompositionEnd={onCompositionEnd}
          className="mb-2"
        />
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {filtered.map((t) => (
            <label
              key={t.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-sm hover:bg-accent"
              data-testid={`calendar-tag-option-${t.id}`}
            >
              <Checkbox checked={checkedIds.includes(t.id)} onCheckedChange={() => onToggle(t.id)} aria-label={t.name} />
              <span className={`size-2.5 shrink-0 rounded-full ${resolvePalette(t.color).dotClass}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
            </label>
          ))}
          {tags.isSuccess && filtered.length === 0 && toCreate === null && search.trim() !== '' && (
            <p className="py-2 text-center text-xs text-muted-foreground">결과 없음</p>
          )}
          {tags.isSuccess && list.length === 0 && search.trim() === '' && (
            <p className="py-2 text-center text-xs text-muted-foreground">아직 태그가 없어요. 이름을 입력해 만들어 보세요.</p>
          )}
        </div>
        {toCreate !== null && (
          <button
            type="button"
            onClick={createAndAttach}
            disabled={createTag.isPending}
            className="mt-1 flex w-full items-center gap-2 rounded border-t px-1.5 pt-2.5 pb-1.5 text-left text-sm text-muted-foreground hover:bg-accent disabled:opacity-60"
            data-testid="calendar-tag-create-option"
          >
            <Plus className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">
              <span className="font-medium text-foreground">「{toCreate}」</span> 태그 만들기
            </span>
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface CalendarTagPickerProps {
  /** 태그를 붙일 일정 id (반복 회차여도 서버가 마스터에 붙인다) */
  eventId: number
  /** 지금 붙어 있는 태그 — 팝오버를 열 때 체크 상태의 출발점 */
  current: CalendarTagRef[]
  /** 팝오버를 여는 트리거(버튼 하나) */
  children: ReactNode
}

/** 바로 저장 피커 — 체크할 때마다 이 일정에 PUT 한다(상세 보기). */
export function CalendarTagPicker({ eventId, current, children }: CalendarTagPickerProps) {
  const setEventTags = useSetEventTags()
  // 체크 상태의 원천 — 서버 응답을 기다리지 않고 바로 반영한다. 열 때 current 로 맞춘다.
  const [selected, setSelected] = useState<number[]>([])
  // 새 태그 생성이 끝난 뒤 최신 선택 집합을 읽기 위한 ref(콜백이 오래된 state 를 잡지 않게)
  const selectedRef = useRef<number[]>([])
  // 저장 줄 세우기 — PUT 은 집합 전체 교체라, 체크마다 동시에 보내면 늦게 끝난 옛 요청이 서버를 낡은 집합으로 덮을 수 있다.
  // 그래서 한 번에 하나만 보내고, 보내는 동안 바뀐 선택은 「마지막 것」만 기억했다가 끝나면 이어서 보낸다.
  const savingRef = useRef(false)
  // 보내는 중에 쌓인 다음 저장 대상(마지막 선택만) — 없으면 null
  const pendingRef = useRef<number[] | null>(null)
  // 서버가 마지막으로 받아들인 집합 — 실패하면 화면을 여기로 되돌린다(열 때의 값이 아니라: 그 사이 성공한 저장을 버리지 않게)
  const confirmedRef = useRef<number[]>([])

  /**
   * 쌓인 저장을 하나씩 보낸다 — 서버가 받아들인 집합과 다를 때만. mutate 의 호출별 콜백 대신 mutateAsync 를 기다린다:
   * 호출별 콜백은 팝오버·상세 창이 닫혀 컴포넌트가 내려가면 불리지 않아, 기다리던 마지막 선택이 저장되지 않고 사라진다.
   * 실패하면 남은 저장을 버리고 화면을 마지막으로 받아들여진 집합으로 되돌린다(오류 토스트는 훅의 onError 가 띄운다).
   */
  async function drain() {
    savingRef.current = true
    try {
      while (pendingRef.current !== null) {
        const next = pendingRef.current
        pendingRef.current = null
        if (sameTagIds(next, confirmedRef.current)) continue
        try {
          await setEventTags.mutateAsync({ eventId, tagIds: next })
          confirmedRef.current = next
        } catch {
          pendingRef.current = null
          selectedRef.current = confirmedRef.current
          setSelected(confirmedRef.current)
          return
        }
      }
    } finally {
      savingRef.current = false
    }
  }

  /** 선택 집합을 바꾸고 저장 줄에 올린다 — 보내는 중이면 끝난 뒤 이 마지막 선택을 보낸다. */
  function commit(next: number[]) {
    selectedRef.current = next
    setSelected(next)
    pendingRef.current = next
    if (!savingRef.current) void drain()
  }

  /** 열 때 — 저장이 아직 줄에 있으면 current(서버 응답 전의 낡은 값)로 덮지 않고 지금 선택을 그대로 보인다. */
  function onOpen() {
    if (savingRef.current || pendingRef.current !== null) return
    const ids = current.map((t) => t.id)
    confirmedRef.current = ids
    selectedRef.current = ids
    setSelected(ids)
  }

  return (
    <TagPickerPopover
      checkedIds={selected}
      onToggle={(id) => commit(toggleTagId(selectedRef.current, id))}
      onCreated={(tag) => commit([...selectedRef.current, tag.id])}
      onOpen={onOpen}
    >
      {children}
    </TagPickerPopover>
  )
}

interface CalendarTagFormPickerProps {
  /** 폼이 들고 있는 지금 선택 */
  value: CalendarTagRef[]
  /** 새 선택(칩에 그릴 이름·색 포함 — 막 만든 태그는 목록 재조회 전이라 id 만으로는 칩을 그릴 수 없다) */
  onChange: (next: CalendarTagRef[]) => void
  /** 팝오버를 여는 트리거(버튼 하나) */
  children: ReactNode
}

/** 폼 상태 피커 — 체크는 onChange 로 폼 값만 바꾸고 저장하지 않는다(편집·새 일정 폼, 저장은 일정 저장 요청에 함께). */
export function CalendarTagFormPicker({ value, onChange, children }: CalendarTagFormPickerProps) {
  const tags = useCalendarTags()
  // 연이은 체크·만들기 완료 콜백이 낡은 value 를 읽지 않게 최신 선택을 ref 로 든다 — 체크마다 바로 갱신하고, 열 때 value 로 맞춘다.
  const selectedRef = useRef<number[]>([])
  // 만들기가 끝난 콜백(만들기를 누른 때의 렌더에서 잡힌 함수)이 칩 이름·색을 찾을 최신 value·목록
  const latest = useRef({ value, list: tags.data ?? [] })
  useEffect(() => {
    latest.current = { value, list: tags.data ?? [] }
  })

  /** 새 선택 id 를 폼에 넘긴다 — 칩에 그릴 이름·색은 목록·지금 값·막 만든 태그에서 찾는다. */
  function commit(next: number[], created: CalendarTagRef[] = []) {
    selectedRef.current = next
    onChange(tagRefsForIds(next, latest.current.list, latest.current.value, created))
  }

  return (
    <TagPickerPopover
      checkedIds={value.map((t) => t.id)}
      onToggle={(id) => commit(toggleTagId(selectedRef.current, id))}
      onCreated={(tag) => commit([...selectedRef.current, tag.id], [tag])}
      onOpen={() => {
        selectedRef.current = value.map((t) => t.id)
      }}
    >
      {children}
    </TagPickerPopover>
  )
}
