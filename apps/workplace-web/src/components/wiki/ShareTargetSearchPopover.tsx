// 노트 공유 「사람·팀 추가」 검색(WP-1023·WP-1048) — 사람·조직도 부서·내 그룹을 한 검색창에서 섹션으로 나눠 보인다.
// - 사람: 구성원 디렉터리 검색(useUserSearch, 300ms debounce) — 사람 고르기 팝오버(MemberSearchPopover)와 같은 조회·같은 거르기(비활성 제외).
//   공유하는 나·공유를 만든 사람(excludeUserIds)은 이미 열 수 있어 후보에서 뺀다. 이름 옆에 소속 부서를 보여 같은 이름을 가른다(WP-1048).
// - 조직도 부서·내 그룹: 그룹 트리(GET /user-groups, 공유 조직도 + 내 개인 그룹만 온다)를 한 번 받아 브라우저에서 이름·상위 경로로 거른다.
//   트리를 못 받으면(권한·오류) 그룹 섹션만 빠지고 사람 검색은 그대로 쓴다 — 공유 창 전체를 막지 않는다.
// - 종류 탭(WP-1048): 전체·사람·조직·내 그룹 — 사람이 많아도 조직만 골라 볼 수 있다. 검색어가 없으면 조직도를 맨 위에 둔다
//   (사람 기본 목록이 첫 화면을 채워 조직도가 안 보이던 VOC). 사람 검색 결과가 오면 사람을 먼저 둔다(이름으로 찾는 일이 많다).
// - 조직·그룹 펼치기(WP-1048): 행의 ▸(또는 → 키)로 그 자리에서 하위 부서와 직속 구성원을 펼친다. 행을 고르면 그 조직을 추가하고,
//   펼친 구성원 행을 고르면 그 사람만 추가한다. 검색어가 없으면 최상위 조직만 보이고 펼쳐 내려간다.
// - 키보드: cmdk 목록이라 ↑↓ 로 섹션을 넘나들며 고르고 Enter 로 더한다. 검색어를 치면 고를 수 있는 첫 후보가 잡혀 바로 Enter 로 더할 수 있다.
// - 이미 지정한 사람·부서는 비활성 + 「(이미 추가됨)」, 상위 부서가 이미 대상인 부서는 비활성 + 「상위 부서에 포함됨」.
//   고르면 검색어만 비우고 팝오버는 열어 둔다(연속 추가). 내 그룹은 고르면 하위 그룹 구성원까지 한 명씩 펼쳐 더한다.
// - 모달 팝오버(WP-1048): 공유 창(Dialog)이 바깥 스크롤을 막는데(RemoveScroll) 팝오버는 포털이라 그 밖으로 보여, 목록이 휠로 움직이지 않았다.
//   modal 이면 팝오버가 스스로 스크롤 잠금 범위가 되어 안쪽 목록은 휠로 내려간다.

import { useQueries } from '@tanstack/react-query'
import { Building2, ChevronRight, Users } from 'lucide-react'
import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/utils'

import { userGroupsApi } from '../../api/userGroups'
import { userGroupKeys } from '../../hooks/queries/userGroupKeys'
import { useUserGroups } from '../../hooks/queries/useUserGroups'
import { useUserSearch } from '../../hooks/queries/useUserSearch'
import { useDebounceValue } from '../../hooks/useDebounceValue'
import type { UserGroupMemberSummary, UserGroupNode } from '../../types/userGroup'
import { filterGroupOptions, flattenGroupTree, type ShareGroupOption } from './wikiShare'

/**
 * 검색어가 없을 때 그룹 섹션마다 보이는 최상위 줄 수 — 「전체」 탭은 사람·조직·내 그룹이 한 목록이라 큰 조직도가 사람 섹션을 밀어내지 않게 짧게,
 * 그 종류만 보는 「조직」·「내 그룹」 탭은 넉넉하게(아주 큰 조직도에서도 목록이 끝없이 길어지지 않게). 잘리면 섹션 끝에 남은 수와 찾는 길을
 * 알린다(WP-1064 — 탭의 수보다 목록이 짧은데 안내가 없어 나머지 부서가 없는 줄 알았다).
 */
const GROUPS_WITHOUT_QUERY_ALL = 20
const GROUPS_WITHOUT_QUERY_KIND = 200

/** 종류 탭 — 전체 또는 한 종류만. */
type TargetKind = 'all' | 'people' | 'departments' | 'groups'

/** 조직·그룹 섹션의 한 줄 — 그룹 행, 펼친 그룹의 직속 구성원 행, 펼친 그룹의 구성원을 받는 중·없음 안내. */
type GroupRow =
  | {
      type: 'group'
      option: ShareGroupOption
      node: UserGroupNode
      depth: number
      showPath: boolean
    }
  | {
      type: 'member'
      groupId: number
      ancestorIds: number[]
      member: UserGroupMemberSummary
      depth: number
    }
  | { type: 'note'; groupId: number; text: string; depth: number }

export interface ShareTargetSearchPopoverProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  trigger: React.ReactNode
  /** 이미 지정한 사람 id — 비활성으로 보인다. */
  existingUserIds: Set<number>
  /** 이미 지정한 조직도 부서 id — 비활성으로 보인다. */
  existingGroupIds: Set<number>
  /** 후보에서 뺄 사람 — 공유하는 나·공유를 만든 사람(이미 열 수 있다). */
  excludeUserIds: Set<number>
  /** 사람 한 명을 지정한 사람으로 더한다(사람 검색 행·펼친 구성원 행). */
  onSelectPerson: (userId: number) => void
  /** 조직도 부서를 대상으로 더한다(부서 행으로 저장 — 구성원은 열 때마다 다시 본다). */
  onSelectDepartment: (group: ShareGroupOption) => void
  /** 내 그룹을 고른다 — 지금 사람 구성원을 지정한 사람으로 펼쳐 더한다(그룹 행은 남기지 않는다). */
  onSelectPersonalGroup: (group: ShareGroupOption) => void
}

/** 트리를 id → 노드로 — 검색으로 찾은 그룹(평면 목록)을 펼칠 때 하위 노드를 찾는다. */
function indexTree(nodes: UserGroupNode[], into = new Map<number, UserGroupNode>()): Map<number, UserGroupNode> {
  for (const n of nodes) {
    into.set(n.id, n)
    indexTree(n.children ?? [], into)
  }
  return into
}

export function ShareTargetSearchPopover({
  open,
  onOpenChange,
  trigger,
  existingUserIds,
  existingGroupIds,
  excludeUserIds,
  onSelectPerson,
  onSelectDepartment,
  onSelectPersonalGroup,
}: ShareTargetSearchPopoverProps) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<TargetKind>('all')
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const debounced = useDebounceValue(query, 300)
  const people = useUserSearch(debounced, 'HUMAN')
  // 그룹 트리는 검색창을 열 때만 받는다 — 공유 창을 열 때마다(닫힌 검색 버튼만 있어도) 조직도를 받지 않게.
  const groups = useUserGroups(open)
  // 펼친 그룹의 직속 구성원 — 펼칠 때 받는다(그룹 상세, 연락처 조직도와 같은 캐시).
  const expandedIds = [...expanded]
  const details = useQueries({
    queries: expandedIds.map((id) => ({
      queryKey: userGroupKeys.detail(id),
      queryFn: () => userGroupsApi.detail(id).then((r) => r.data),
      staleTime: 10_000,
    })),
  })
  const detailOf = new Map(expandedIds.map((id, i) => [id, details[i]]))

  const q = query.trim()
  // 사람 목록은 debounce 된 검색어(300ms)의 결과다 — 그사이 목록은 이전 검색어의 것이라, 순서를 정하거나 고르게 하면
  // 「개발」을 치고 바로 Enter 를 눌렀을 때 이전 목록의 첫 사람에게 공유된다. 사람 섹션 자리는 사람 검색어로 정하고,
  // 지금 검색어의 결과가 아니면 사람 줄을 고르지 못하게 한다(조직·그룹은 브라우저에서 바로 걸러 지금 검색어 그대로다).
  const peopleQuery = debounced.trim()
  const peopleFresh = peopleQuery === q
  // 사람 후보 — 비활성 사용자·나·공유를 만든 사람은 빼고, 이미 지정한 사람은 뒤로(기본 목록 앞줄이 고를 수 없는 행으로 차지 않게).
  const fetched = people.data?.content ?? []
  const personItems = fetched
    .filter((u) => u.isActive !== false && !excludeUserIds.has(u.id))
    .sort((a, b) => Number(existingUserIds.has(a.id)) - Number(existingUserIds.has(b.id)))
  // 탭의 사람 수 — 한 번에 20명까지 받는다.
  // 이번에 다 받았으면 정확한 수, 더 있으면 「20+」 — 받지 않은 쪽에 나·비활성이 있는지 알 수 없어 총원에서 덜어 낼 수 없다.
  const peopleCount = people.data
    ? fetched.length >= people.data.totalElements
      ? String(personItems.length)
      : `${personItems.length}+`
    : undefined

  const sharedTree = groups.data?.shared ?? []
  const personalTree = groups.data?.personal ?? []
  const nodeById = indexTree([...sharedTree, ...personalTree])
  // id → 그룹 줄(상위·하위 id) — 접을 때 하위까지 함께 접고, ← 로 상위를 접는다.
  const optionById = new Map([...flattenGroupTree(sharedTree), ...flattenGroupTree(personalTree)].map((o) => [o.id, o]))

  // 고를 수 없는 부서와 그 까닭 — 이미 대상이거나, 상위 부서가 이미 대상이라 하위 부서 구성원도 이미 열 수 있다(하위 부서 포함 규칙).
  const departmentBlock = (g: ShareGroupOption): string | null =>
    existingGroupIds.has(g.id) ? '(이미 추가됨)' : g.ancestorIds.some((id) => existingGroupIds.has(id)) ? '상위 부서에 포함됨' : null

  /**
   * 조직·그룹 섹션의 줄을 만든다 — 검색어가 없으면 최상위부터 펼친 만큼, 있으면 찾은 그룹을 평면으로(상위 경로와 함께) 두고 펼친 그룹 아래에
   * 하위 그룹·직속 구성원을 끼운다. 펼친 상위 아래 이미 그린 그룹은 다시 그리지 않는다(같은 값이 두 줄이면 cmdk 선택이 어긋난다).
   */
  const buildRows = (tree: UserGroupNode[]) => {
    const all = flattenGroupTree(tree)
    const optionOf = new Map(all.map((o) => [o.id, o]))
    // 검색어가 없을 때만 최상위 줄을 탭에 맞는 수로 자른다 — 검색하면 모두에서 찾는다.
    const roots = q ? [] : all.filter((o) => o.ancestorIds.length === 0)
    const limit = kind === 'all' ? GROUPS_WITHOUT_QUERY_ALL : GROUPS_WITHOUT_QUERY_KIND
    const starts = q ? filterGroupOptions(all, q) : roots.slice(0, limit)
    const rows: GroupRow[] = []
    const seen = new Set<number>()
    const walk = (option: ShareGroupOption, depth: number, showPath: boolean) => {
      const node = nodeById.get(option.id)
      if (!node || seen.has(option.id)) return
      seen.add(option.id)
      rows.push({ type: 'group', option, node, depth, showPath })
      if (!expanded.has(option.id)) return
      for (const child of node.children ?? []) {
        const childOption = optionOf.get(child.id)
        if (childOption) walk(childOption, depth + 1, false)
      }
      const detail = detailOf.get(option.id)
      const members = (detail?.data?.members ?? []).filter((m) => m.targetType === 'MEMBER' && !excludeUserIds.has(m.targetId))
      for (const member of members) {
        rows.push({
          type: 'member',
          groupId: option.id,
          ancestorIds: option.ancestorIds,
          member,
          depth: depth + 1,
        })
      }
      if (detail?.isPending)
        rows.push({
          type: 'note',
          groupId: option.id,
          text: '구성원을 불러오는 중…',
          depth: depth + 1,
        })
      else if (detail?.isError)
        rows.push({
          type: 'note',
          groupId: option.id,
          text: '구성원을 불러오지 못했습니다',
          depth: depth + 1,
        })
      else if (members.length === 0 && (node.children ?? []).length === 0)
        rows.push({
          type: 'note',
          groupId: option.id,
          text: '구성원이 없습니다',
          depth: depth + 1,
        })
    }
    for (const s of starts) walk(s, 0, q !== '')
    // 탭의 수는 찾은 그룹 수(검색어가 없으면 전체) — 펼친 줄·구성원은 세지 않는다. hidden 은 잘라서 안 보이는 최상위 줄 수.
    return { rows, count: q ? starts.length : all.length, hidden: roots.length - (q ? 0 : starts.length) }
  }
  const departments = buildRows(sharedTree)
  const personalGroups = buildRows(personalTree)

  const show = (k: Exclude<TargetKind, 'all'>) => kind === 'all' || kind === k
  const peopleShown = show('people') ? personItems : []
  const departmentRows = show('departments') ? departments.rows : []
  const personalRows = show('groups') ? personalGroups.rows : []
  const nothing = peopleShown.length === 0 && departmentRows.length === 0 && personalRows.length === 0

  /** 펼친 구성원 행을 고를 수 없는 까닭 — 이미 지정한 사람이거나, 그 조직(또는 상위 조직)이 이미 대상이라 이미 열 수 있다. */
  const memberBlock = (row: Extract<GroupRow, { type: 'member' }>, department: boolean): string | null => {
    if (existingUserIds.has(row.member.targetId)) return '(이미 추가됨)'
    if (department && [row.groupId, ...row.ancestorIds].some((id) => existingGroupIds.has(id))) return '조직에 포함됨'
    return null
  }
  const groupValue = (department: boolean, id: number) => `${department ? 'dept' : 'group'}-${id}`
  const memberValue = (department: boolean, groupId: number, userId: number) =>
    `${department ? 'dept' : 'group'}-member-${groupId}-${userId}`

  // 키보드로 고른 후보 — 목록에서 사라지면(사람 검색이 debounce 뒤 다시 와 그 사람이 빠지는 등) 고를 수 있는 첫 후보로 옮긴다.
  // cmdk 에 맡기면 사라진 후보에 선택이 남아, 부서 이름을 치고 바로 Enter 를 눌러도 아무것도 고르지 않는다. 효과 없이 렌더에서 정한다.
  // 순서는 화면 순서와 같게(검색어가 없으면 조직도 먼저) — 첫 후보가 맨 위 줄이어야 Enter 가 보이는 첫 줄을 고른다.
  const [active, setActive] = useState('')
  const selectableGroupRows = (rows: GroupRow[], department: boolean) =>
    rows.flatMap((r) => {
      if (r.type === 'group') return department && departmentBlock(r.option) ? [] : [groupValue(department, r.option.id)]
      if (r.type === 'member') return memberBlock(r, department) ? [] : [memberValue(department, r.groupId, r.member.targetId)]
      return []
    })
  const selectablePeople = peopleFresh ? peopleShown.filter((u) => !existingUserIds.has(u.id)).map((u) => `user-${u.id}`) : []
  const selectableGroups = [...selectableGroupRows(departmentRows, true), ...selectableGroupRows(personalRows, false)]
  const selectable = peopleQuery ? [...selectablePeople, ...selectableGroups] : [...selectableGroups, ...selectablePeople]
  const current = selectable.includes(active) ? active : (selectable[0] ?? '')
  const pick = (fn: () => void) => {
    fn()
    setQuery('')
  }
  // 접으면 그 아래 펼쳐 둔 하위 그룹도 함께 접는다 — 숨은 하위의 구성원 조회가 남아 다시 받거나, 다시 펼칠 때 하위가 펼친 채로 튀어나오지 않게.
  const toggle = (id: number, next = !expanded.has(id)) =>
    setExpanded((prev) => {
      const s = new Set(prev)
      if (next) s.add(id)
      else for (const sub of optionById.get(id)?.subtreeIds ?? [id]) s.delete(sub)
      return s
    })
  // → 는 지금 고른 조직·그룹을 펼치고 ← 는 접는다 — 검색창에서 손을 떼지 않고 조직도를 내려간다.
  // ← 는 고른 줄이 펼친 그룹이면 그 그룹을, 아니면(구성원 줄·접힌 하위 그룹) 그 줄을 품은 그룹을 접는다.
  // 검색어 안에서 글자 커서를 옮기는 중이면(→ 는 끝이 아닐 때, ← 는 처음이 아닐 때) 가로채지 않는다.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const input = e.target instanceof HTMLInputElement ? e.target : null
    if (input && input.selectionStart !== input.selectionEnd) return
    if (input && e.key === 'ArrowRight' && input.selectionEnd !== input.value.length) return
    if (input && e.key === 'ArrowLeft' && input.selectionStart !== 0) return
    const group = /^(dept|group)-(\d+)$/.exec(current)
    const member = /^(dept|group)-member-(\d+)-\d+$/.exec(current)
    let target: number | undefined
    if (e.key === 'ArrowRight') target = group ? Number(group[2]) : undefined
    else if (member) target = Number(member[2])
    else if (group) {
      const id = Number(group[2])
      const parent = optionById.get(id)?.ancestorIds.at(-1)
      // 검색으로 평평하게 보이는 하위 그룹은 상위가 펼쳐져 있지 않다 — 보이지 않는 상위를 접는 대신 키를 그대로 둔다.
      target = expanded.has(id) ? id : parent != null && expanded.has(parent) ? parent : undefined
    }
    if (target == null) return
    e.preventDefault()
    if (e.key === 'ArrowRight') {
      toggle(target, true)
      return
    }
    // 접으면 고른 줄(구성원·하위 그룹)이 사라진다 — 고른 줄이 사라지면 cmdk 가 맨 위 줄을 고르므로, 선택을 먼저 접을 그룹으로
    // 옮겨 커밋한 뒤 다음 틱에 접는다. 그래야 다음 Enter·→ 가 맨 위 줄이 아니라 방금 접은 그룹에 간다.
    const collapse = target
    setActive(`${(group ?? member)![1]}-${collapse}`)
    setTimeout(() => toggle(collapse, false), 0)
  }
  // 닫으면 탭·펼침·선택·검색어를 처음으로 — 다시 열 때 이전 탭(「내 그룹」만 등)·펼침이 남아 있거나 펼친 그룹 조회가 남지 않게.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setKind('all')
      setExpanded(new Set())
      setActive('')
      setQuery('')
    }
    onOpenChange(next)
  }

  /**
   * 조직·그룹 섹션 — department 면 조직도(고르면 부서 행), 아니면 내 그룹(고르면 구성원을 한 명씩). hidden 은 잘린 최상위 줄 수 — 섹션
   * 끝에 남은 수와 찾는 길(「전체」 탭이면 종류 탭·검색, 종류 탭이면 검색)을 알려 「목록에 없으니 공유할 수 없다」고 여기지 않게 한다(WP-1064).
   */
  const groupSection = (rows: GroupRow[], department: boolean, hidden: number) => {
    const testId = department ? 'share-target-departments' : 'share-target-personal-groups'
    const label = department ? '조직' : '내 그룹'
    return (
      <CommandGroup heading={department ? '조직도' : '내 그룹'} data-testid={testId}>
        {rows.map((r) => {
          const indent = { paddingLeft: `${8 + r.depth * 16}px` }
          if (r.type === 'note')
            return (
              <div key={`n${r.groupId}`} style={indent} className="py-1.5 pr-2 text-xs text-muted-foreground">
                <span className="ml-7">{r.text}</span>
              </div>
            )
          if (r.type === 'member') {
            const blocked = memberBlock(r, department)
            return (
              <CommandItem
                key={`m${r.groupId}-${r.member.targetId}`}
                value={memberValue(department, r.groupId, r.member.targetId)}
                disabled={blocked != null}
                onSelect={() => pick(() => onSelectPerson(r.member.targetId))}
                style={indent}
                data-testid={`share-target-member-${r.groupId}-${r.member.targetId}`}
                className="flex items-center gap-2"
              >
                {/* 펼침 단추 자리만큼 비워 그룹 이름과 줄을 맞춘다. */}
                <span className="size-5 shrink-0" aria-hidden="true" />
                <PersonAvatar name={r.member.name} />
                <span className="min-w-0 truncate">{r.member.name}</span>
                {r.member.title && <span className="truncate text-xs text-muted-foreground">{r.member.title}</span>}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{blocked ?? '사람만 추가'}</span>
              </CommandItem>
            )
          }
          const { option, node } = r
          const blocked = department ? departmentBlock(option) : null
          const open = expanded.has(option.id)
          return (
            <CommandItem
              key={`g${option.id}`}
              value={groupValue(department, option.id)}
              disabled={blocked != null}
              onSelect={() => pick(() => (department ? onSelectDepartment(option) : onSelectPersonalGroup(option)))}
              style={indent}
              data-testid={department ? `share-target-department-${option.id}` : `share-target-personal-group-${option.id}`}
              className="flex items-center gap-2"
            >
              {/* 펼침 단추 — 행을 고르지 않고(조직 추가 아님) 그 자리에서 하위 부서·구성원만 펼친다. 검색창 포커스는 그대로 둔다.
                  고를 수 없는(이미 추가한) 조직도 펼쳐 볼 수 있게 비활성 행의 pointer-events-none 을 단추만 되살린다. */}
              {/* 목록 안의 단추는 읽기 도구·Tab 에 따로 잡히지 않게 숨긴다(포커스는 검색창에 두고 → / ← 로 같은 일을 한다). */}
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="pointer-events-auto flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation()
                  toggle(option.id)
                }}
                data-testid={`share-target-expand-${option.id}`}
              >
                <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden="true" />
              </button>
              <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                {department ? <Building2 className="size-3.5" /> : <Users className="size-3.5" />}
              </span>
              <span className="min-w-0 truncate">
                <span className={cn(r.depth === 0 && 'font-medium')}>{node.name}</span>
                {/* 검색으로 찾은 하위 그룹은 상위 경로와 함께(「개발본부 › 플랫폼팀」) — 이름이 같은 하위 그룹을 가린다. */}
                {r.showPath && option.path && <span className="ml-1.5 text-xs text-muted-foreground">{option.path}</span>}
              </span>
              <span className="shrink-0 rounded border px-1 text-[11px] leading-4 text-muted-foreground">
                {department ? '조직' : '내 그룹'}
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {department ? (blocked ?? '하위 부서 포함') : '구성원을 한 명씩 추가'}
              </span>
            </CommandItem>
          )
        })}
        {hidden > 0 && (
          // 수는 잘린 최상위 줄만 센다 — 탭의 수(하위 포함 전체)와 헷갈리지 않게 「최상위」를 붙인다.
          <div className="px-2 py-1.5 text-xs text-muted-foreground" data-testid={`${testId}-more`}>
            최상위 {label} {hidden}개 더 있음 — {kind === 'all' ? `「${label}」 탭이나 이름 검색으로` : '이름 검색으로'} 찾으세요
          </div>
        )}
      </CommandGroup>
    )
  }

  const peopleSection = (
    <CommandGroup heading="사람" data-testid="share-target-people">
      {peopleShown.map((u) => {
        const added = existingUserIds.has(u.id)
        return (
          <CommandItem
            key={`u${u.id}`}
            value={`user-${u.id}`}
            // 이전 검색어의 사람(지금 검색어의 결과가 오기 전)은 고를 수 없다 — 고를 후보가 없을 때 cmdk 가 첫 줄을 스스로 골라
            // Enter 로 엉뚱한 사람이 더해지지 않게(지금 검색어에 맞는 조직이 이미 추가돼 비활성일 때 등).
            disabled={added || !peopleFresh}
            onSelect={() => pick(() => onSelectPerson(u.id))}
            data-testid={`share-target-person-${u.id}`}
            className="flex items-center gap-2"
          >
            <PersonAvatar name={u.name} />
            <span className="truncate font-medium">{u.name}</span>
            {/* 소속 부서(없으면 아이디)로 같은 이름을 가른다. */}
            <span className="truncate text-xs text-muted-foreground">{u.department ?? `@${u.username}`}</span>
            {added && <span className="ml-auto shrink-0 text-xs text-muted-foreground">(이미 추가됨)</span>}
          </CommandItem>
        )
      })}
    </CommandGroup>
  )

  const tabs: { kind: TargetKind; label: string; count?: number | string }[] = [
    { kind: 'all', label: '전체' },
    { kind: 'people', label: '사람', count: peopleCount },
    { kind: 'departments', label: '조직', count: departments.count },
    { kind: 'groups', label: '내 그룹', count: personalGroups.count },
  ]

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* 가장자리 16px — 390 화면에서 팝오버가 오른쪽 끝에 붙지 않게(MemberSearchPopover 와 같은 폭·여백). */}
      <PopoverContent className="w-[min(380px,calc(100vw-32px))] p-0" align="start" collisionPadding={16} data-testid="share-target-search">
        <Command shouldFilter={false} value={current} onValueChange={setActive} onKeyDown={onKeyDown}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="이름·부서·그룹으로 검색" aria-label="사람·팀 검색" />
          {/* 종류 탭 — 누른 종류만 보인다. 수는 지금 검색어에 맞는 후보 수. */}
          <div role="group" aria-label="후보 종류" className="flex gap-1 border-b px-2 py-1.5">
            {tabs.map((t) => (
              <button
                key={t.kind}
                type="button"
                aria-pressed={kind === t.kind}
                onClick={() => setKind(t.kind)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted',
                  kind === t.kind && 'bg-accent font-medium text-accent-foreground',
                )}
                data-testid={`share-target-tab-${t.kind}`}
              >
                {t.label}
                {t.count != null && <span className="ml-1 tabular-nums">{t.count}</span>}
              </button>
            ))}
          </div>
          <CommandList label="사람·팀 후보">
            {nothing &&
              (people.isLoading || groups.isLoading ? (
                <CommandEmpty>검색 중…</CommandEmpty>
              ) : people.isError && show('people') ? (
                <CommandEmpty>검색에 실패했습니다</CommandEmpty>
              ) : (
                <CommandEmpty>결과가 없습니다</CommandEmpty>
              ))}
            {peopleQuery && peopleShown.length > 0 && peopleSection}
            {departmentRows.length > 0 && groupSection(departmentRows, true, departments.hidden)}
            {personalRows.length > 0 && groupSection(personalRows, false, personalGroups.hidden)}
            {!peopleQuery && peopleShown.length > 0 && peopleSection}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** 사람 행의 머리글자 동그라미 — 공유 창 지정한 사람 목록과 같은 모양. */
function PersonAvatar({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
      {name.slice(0, 1)}
    </span>
  )
}
