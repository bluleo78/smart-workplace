// 노트 공유 「사람·팀 추가」 검색(WP-1023) — 사람·조직도 부서·내 그룹을 한 검색창에서 섹션으로 나눠 보인다.
// - 사람: 구성원 디렉터리 검색(useUserSearch, 300ms debounce) — 사람 고르기 팝오버(MemberSearchPopover)와 같은 조회·같은 거르기(비활성 제외).
// - 조직도 부서·내 그룹: 그룹 트리(GET /user-groups, 공유 조직도 + 내 개인 그룹만 온다)를 한 번 받아 브라우저에서 이름·상위 경로로 거른다.
//   트리를 못 받으면(권한·오류) 그룹 섹션만 빠지고 사람 검색은 그대로 쓴다 — 공유 창 전체를 막지 않는다.
// - 키보드: cmdk 목록이라 ↑↓ 로 섹션을 넘나들며 고르고 Enter 로 더한다. 검색어를 치면 고를 수 있는 첫 후보가 잡혀 바로 Enter 로 더할 수 있다.
//   섹션 제목은 읽기 도구에 그룹 이름으로 읽힌다.
// - 이미 지정한 사람·부서는 비활성 + 「(이미 추가됨)」, 상위 부서가 이미 대상인 부서는 비활성 + 「상위 부서에 포함됨」.
//   고르면 검색어만 비우고 팝오버는 열어 둔다(연속 추가). 내 그룹은 하위 그룹도 경로와 함께 보이고, 고르면 하위 그룹 구성원까지 펼친다.

import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

import { useUserGroups } from '../../hooks/queries/useUserGroups'
import type { MemberPickerCandidate } from '../../hooks/queries/useUserSearch'
import { useUserSearch } from '../../hooks/queries/useUserSearch'
import { useDebounceValue } from '../../hooks/useDebounceValue'
import { filterGroupOptions, flattenGroupTree, type ShareGroupOption } from './wikiShare'

/** 검색어가 없을 때 그룹 섹션마다 보이는 최대 줄 수 — 큰 조직도에서 목록이 끝없이 길어지지 않게(검색하면 모두에서 찾는다). */
const GROUPS_WITHOUT_QUERY = 20

export interface ShareTargetSearchPopoverProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  trigger: React.ReactNode
  /** 이미 지정한 사람 id — 비활성으로 보인다. */
  existingUserIds: Set<number>
  /** 이미 지정한 조직도 부서 id — 비활성으로 보인다. */
  existingGroupIds: Set<number>
  onSelectPerson: (user: MemberPickerCandidate) => void
  /** 조직도 부서를 대상으로 더한다(부서 행으로 저장 — 구성원은 열 때마다 다시 본다). */
  onSelectDepartment: (group: ShareGroupOption) => void
  /** 내 그룹을 고른다 — 지금 사람 구성원을 지정한 사람으로 펼쳐 더한다(그룹 행은 남기지 않는다). */
  onSelectPersonalGroup: (group: ShareGroupOption) => void
}

export function ShareTargetSearchPopover({
  open,
  onOpenChange,
  trigger,
  existingUserIds,
  existingGroupIds,
  onSelectPerson,
  onSelectDepartment,
  onSelectPersonalGroup,
}: ShareTargetSearchPopoverProps) {
  const [query, setQuery] = useState('')
  const debounced = useDebounceValue(query, 300)
  const people = useUserSearch(debounced, 'HUMAN')
  // 그룹 트리는 검색창을 열 때만 받는다 — 공유 창을 열 때마다(닫힌 검색 버튼만 있어도) 조직도를 받지 않게.
  const groups = useUserGroups(open)

  // 사람 후보 — 비활성 사용자는 빼고, 이미 지정한 사람은 뒤로(기본 목록 앞줄이 고를 수 없는 행으로 차지 않게).
  const personItems = (people.data?.content ?? [])
    .filter((u) => u.isActive !== false)
    .sort((a, b) => Number(existingUserIds.has(a.id)) - Number(existingUserIds.has(b.id)))
  // 그룹은 바로 거른다(브라우저 안 목록이라 debounce 가 필요 없다). 트리를 못 받았으면 빈 섹션 = 섹션을 그리지 않는다.
  const limit = (xs: ShareGroupOption[]) => (query.trim() ? xs : xs.slice(0, GROUPS_WITHOUT_QUERY))
  const departments = limit(filterGroupOptions(flattenGroupTree(groups.data?.shared ?? []), query))
  const personalGroups = limit(filterGroupOptions(flattenGroupTree(groups.data?.personal ?? []), query))

  // 고를 수 없는 부서와 그 까닭 — 이미 대상이거나, 상위 부서가 이미 대상이라 하위 부서 구성원도 이미 열 수 있다(하위 부서 포함 규칙).
  const departmentBlock = (g: ShareGroupOption): string | null =>
    existingGroupIds.has(g.id) ? '(이미 추가됨)' : g.ancestorIds.some((id) => existingGroupIds.has(id)) ? '상위 부서에 포함됨' : null
  const nothing = personItems.length === 0 && departments.length === 0 && personalGroups.length === 0

  // 키보드로 고른 후보 — 목록에서 사라지면(사람 검색이 debounce 뒤 다시 와 그 사람이 빠지는 등) 고를 수 있는 첫 후보로 옮긴다.
  // cmdk 에 맡기면 사라진 후보에 선택이 남아, 부서 이름을 치고 바로 Enter 를 눌러도 아무것도 고르지 않는다. 효과 없이 렌더에서 정한다.
  const [active, setActive] = useState('')
  const selectable = [
    ...personItems.filter((u) => !existingUserIds.has(u.id)).map((u) => `user-${u.id}`),
    ...departments.filter((g) => !departmentBlock(g)).map((g) => `dept-${g.id}`),
    ...personalGroups.map((g) => `group-${g.id}`),
  ]
  const current = selectable.includes(active) ? active : (selectable[0] ?? '')
  const pick = (fn: () => void) => {
    fn()
    setQuery('')
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* 가장자리 16px — 390 화면에서 팝오버가 오른쪽 끝에 붙지 않게(MemberSearchPopover 와 같은 폭·여백). */}
      <PopoverContent
        className="w-[min(360px,calc(100vw-32px))] p-0"
        align="start"
        collisionPadding={16}
        data-testid="share-target-search"
      >
        <Command shouldFilter={false} value={current} onValueChange={setActive}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="이름·부서·그룹으로 검색"
            aria-label="사람·팀 검색"
          />
          <CommandList label="사람·팀 후보">
            {nothing &&
              (people.isLoading || groups.isLoading ? (
                <CommandEmpty>검색 중…</CommandEmpty>
              ) : people.isError ? (
                <CommandEmpty>검색에 실패했습니다</CommandEmpty>
              ) : (
                <CommandEmpty>결과가 없습니다</CommandEmpty>
              ))}
            {personItems.length > 0 && (
              <CommandGroup heading="사람" data-testid="share-target-people">
                {personItems.map((u) => {
                  const added = existingUserIds.has(u.id)
                  return (
                    <CommandItem
                      key={`u${u.id}`}
                      value={`user-${u.id}`}
                      disabled={added}
                      onSelect={() => pick(() => onSelectPerson(u))}
                      data-testid={`share-target-person-${u.id}`}
                      className="flex items-center gap-2"
                    >
                      <span className="truncate font-medium">{u.name}</span>
                      <span className="truncate text-xs text-muted-foreground">@{u.username}</span>
                      {added && <span className="ml-auto text-xs text-muted-foreground">(이미 추가됨)</span>}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
            {departments.length > 0 && (
              <CommandGroup heading="조직도" data-testid="share-target-departments">
                {departments.map((g) => {
                  const blocked = departmentBlock(g)
                  return (
                    <CommandItem
                      key={`d${g.id}`}
                      value={`dept-${g.id}`}
                      disabled={blocked != null}
                      onSelect={() => pick(() => onSelectDepartment(g))}
                      data-testid={`share-target-department-${g.id}`}
                      className="flex items-center gap-2"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{g.name}</span>
                        {g.path && <span className="ml-1.5 text-xs text-muted-foreground">{g.path}</span>}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {blocked ?? '하위 부서 포함'}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
            {personalGroups.length > 0 && (
              <CommandGroup heading="내 그룹" data-testid="share-target-personal-groups">
                {personalGroups.map((g) => (
                  <CommandItem
                    key={`p${g.id}`}
                    value={`group-${g.id}`}
                    onSelect={() => pick(() => onSelectPersonalGroup(g))}
                    data-testid={`share-target-personal-group-${g.id}`}
                    className="flex items-center gap-2"
                  >
                    {/* 하위 그룹은 상위 경로와 함께(「스터디 › 스터디-A」) — 이름이 같은 하위 그룹을 가린다. */}
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{g.name}</span>
                      {g.path && <span className="ml-1.5 text-xs text-muted-foreground">{g.path}</span>}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">구성원을 한 명씩 추가</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
