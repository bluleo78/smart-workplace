import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { BookOpen, MoreHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { sidebarTitleClass } from '@/components/layout/sidebar-link'
import { LoadErrorState } from '@/components/LoadErrorState'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select'
import { useIsMobile } from '@/hooks/useIsMobile'
import { parseId } from '@/lib/historyParam'
import { canDeleteWikiSpace } from '@/lib/wikiSpaces'

import { useDeletePage, useDeleteSpace, useMovePage } from '../../hooks/queries/useWikiMutations'
import { useWikiSpaces } from '../../hooks/queries/useWikiSpaces'
import { useWikiTree } from '../../hooks/queries/useWikiTree'
import type { WikiPageSummary } from '../../types/wiki'
import { useCreateWikiPageAndOpen } from './useCreateWikiPageAndOpen'
import { useWikiCreateSpaceDialog } from './useWikiCreateSpaceDialog'
import { WikiDeletePageDialog } from './WikiDeletePageDialog'
import { WikiDeleteSpaceDialog } from './WikiDeleteSpaceDialog'
import { WIKI_DND_SCREEN_READER_INSTRUCTIONS, wikiDndAnnouncements } from './wikiDndAnnouncements'
import { WikiMovePageDialog } from './WikiMovePageDialog'
import { WikiMoveShareDialog } from './WikiMoveShareDialog'
import { lastChildPosition } from './wikiMoveTargets'
import { WikiNoPages } from './WikiNoPages'
import { WikiNoSpaces } from './WikiNoSpaces'
import { shareMoveImpact, treeShareMarks } from './wikiShare'
import { WikiSharedPagesDialog } from './WikiSharedPagesDialog'
import { WikiSpaceMemberDialog } from './WikiSpaceMemberDialog'
import { canEditWikiSpace, isWikiSpaceUnavailable } from './wikiSpaceUnavailable'
import { WikiSpaceUnavailableState } from './WikiSpaceUnavailableState'
import { WikiTreeRow } from './WikiTreeRow'

// 들여쓰기 1단계 폭(px). 투영(projection) 시 가로 오프셋을 이 값으로 나눠 depth 변화를 계산한다.
const INDENT = 16

// Select 하단 "새 스페이스" 항목의 sentinel value — 실제 스페이스 id 와 충돌하지 않는 문자열.
// 선택되어도 Select 는 controlled(value={spaceId}) 라 표시 값이 바뀌지 않는다.
const CREATE_SENTINEL = '__create__'

// 평면화된 트리 항목 — DnD 정렬/투영의 단위.
interface FlatItem {
  id: number
  parentId: number | null
  depth: number
  title: string
  hasChildren: boolean
  // #736: AI 생성 attribution 존재 여부 — 사이드바 배지 판단용.
  aiLastUsedAt: string | null
}

// 평면 목록 → depth-first 평면 배열. 형제는 position 순서 유지.
// collapsed 집합에 포함된 노드의 자손은 렌더에서 제외(DnD 도 보이는 항목만 대상).
// parentId 가 목록에 없는(고아) 페이지는 루트로 취급한다.
function flattenTree(pages: WikiPageSummary[], collapsed: Set<number>): FlatItem[] {
  const ids = new Set(pages.map((p) => p.id))
  const byParent = new Map<number | null, WikiPageSummary[]>()
  for (const p of pages) {
    const key = p.parentId != null && ids.has(p.parentId) ? p.parentId : null
    const arr = byParent.get(key) ?? []
    arr.push(p)
    byParent.set(key, arr)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.position - b.position)

  const result: FlatItem[] = []
  const walk = (parentId: number | null, depth: number) => {
    for (const c of byParent.get(parentId) ?? []) {
      const hasChildren = (byParent.get(c.id) ?? []).length > 0
      result.push({
        id: c.id,
        parentId,
        depth,
        title: c.title,
        hasChildren,
        aiLastUsedAt: c.aiLastUsedAt,
      })
      // 접힌 노드의 자손은 평면화에서 제외(렌더·DnD 모두 보이는 항목만 대상).
      if (!collapsed.has(c.id)) walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  return result
}

// #760 드래그 중인 노드의 후손을 평면 배열에서 제거한다(dnd-kit SortableTree 예제의 removeChildrenOf).
// 후손이 남아 있으면 getProjection 이 후손을 parentId 로 돌려줘 서버가 400 으로 거부할 이동이 나간다.
// 평면 배열은 depth-first 라 activeId 뒤에서 depth 가 더 깊은 연속 구간이 곧 그 노드의 후손 전체다.
function removeDescendantsOf(items: FlatItem[], activeId: number): FlatItem[] {
  const activeIdx = items.findIndex((i) => i.id === activeId)
  if (activeIdx < 0) return items
  const activeDepth = items[activeIdx].depth
  const result = items.slice(0, activeIdx + 1)
  let i = activeIdx + 1
  while (i < items.length && items[i].depth > activeDepth) i++
  return result.concat(items.slice(i))
}

// 드래그 중 투영 결과 — active 항목이 드롭될 위치의 depth 와 새 부모 id.
// dnd-kit "SortableTree" 예제의 getProjection 을 미러링한다.
// 핵심: prev/next 는 "이동 후" 배열(newItems)에서 읽어야 depth 클램핑이 정확하다.
function getProjection(
  items: FlatItem[],
  activeId: number,
  overId: number,
  offsetLeft: number,
  indentWidth: number,
): { depth: number; parentId: number | null } | null {
  const overIdx = items.findIndex((i) => i.id === overId)
  const activeIdx = items.findIndex((i) => i.id === activeId)
  // 배열에 없는 id 방어(#760 에서 함께 정리) — flatItems 는 useWikiTree 결과에서 파생되므로
  // 드래그 도중 백그라운드 refetch 가 도착하면 overId 가 배열에서 사라질 수 있다. 그대로 두면
  // items[-2] → undefined 로 depth 0 이 되어 "루트로 이동" 이 조용히 나간다(#760 이전부터 있던 갭).
  if (overIdx < 0 || activeIdx < 0) return null
  const activeItem = items[activeIdx]
  // active 를 over 위치로 옮긴 가상 배열 — 이웃(prev/next)을 여기서 읽는다.
  const newItems = arrayMove(items, activeIdx, overIdx)
  const previousItem = newItems[overIdx - 1]
  const nextItem = newItems[overIdx + 1]

  // 가로 이동량 → depth 변화. active 의 원래 depth 기준으로 가감.
  const dragDepth = Math.round(offsetLeft / indentWidth)
  const projectedDepth = activeItem.depth + dragDepth
  // 위 항목보다 한 단계 더 깊게(자식)까지, 아래 항목 depth 이상으로 클램프.
  const maxDepth = previousItem ? previousItem.depth + 1 : 0
  const minDepth = nextItem ? nextItem.depth : 0
  let depth = projectedDepth
  if (depth >= maxDepth) depth = maxDepth
  else if (depth < minDepth) depth = minDepth

  // 투영된 depth 에서의 부모 id 도출.
  let parentId: number | null
  if (depth === 0 || !previousItem) {
    parentId = null
  } else if (depth === previousItem.depth) {
    // 같은 depth → 위 항목과 형제(같은 부모).
    parentId = previousItem.parentId
  } else if (depth > previousItem.depth) {
    // 더 깊음 → 위 항목의 자식.
    parentId = previousItem.id
  } else {
    // 더 얕음 → 위로 거슬러 올라가 같은 depth 인 항목의 부모를 채택.
    parentId =
      newItems
        .slice(0, overIdx)
        .reverse()
        .find((i) => i.depth === depth)?.parentId ?? null
  }
  return { depth, parentId }
}


/** 위키 2차 사이드바 — 스페이스 선택 + 페이지 트리(드래그앤드롭 재정렬/재부모). */
export function WikiSidebar() {
  const navigate = useNavigate()
  const { spaceId: spaceIdParam, pageId: pageIdParam } = useParams()
  // 숫자가 아닌 주소 번호는 없는 것으로 본다(WP-612) — NaN 으로 트리·삭제 API 를 부르지 않게.
  const spaceId = parseId(spaceIdParam ?? null)
  const activePageId = parseId(pageIdParam ?? null)

  const spacesQuery = useWikiSpaces()
  const spaces = spacesQuery.data
  const { data: pages } = useWikiTree(spaceId)
  const { create: createPage, isPending: createPending } = useCreateWikiPageAndOpen(spaceId)
  const deletePage = useDeletePage(spaceId ?? 0)
  const movePage = useMovePage(spaceId ?? 0)
  // 멤버 관리 다이얼로그 열림 상태 — TEAM 스페이스에서만 노출.
  const [membersOpen, setMembersOpen] = useState(false)
  // 스페이스 삭제 확인 열림 상태(WP-580).
  const [spaceDeleteOpen, setSpaceDeleteOpen] = useState(false)
  // 공유 중인 페이지 목록 열림 상태(WP-579).
  const [sharedOpen, setSharedOpen] = useState(false)
  // 지운 뒤 /wiki 로 보내 남은 첫 스페이스(또는 빈 상태)를 연다.
  const deleteSpace = useDeleteSpace({
    onDeleted: () => {
      setSpaceDeleteOpen(false)
      toast.success('스페이스를 삭제했습니다')
      navigate('/wiki', { replace: true })
    },
  })
  // 스페이스 생성 다이얼로그(선택 상자 "＋ 새 스페이스"·공간 0개 빈 상태의 [공간 만들기]가 함께 연다).
  const { openCreateSpace, dialog: createSpaceDialog } = useWikiCreateSpaceDialog()
  const isMobile = useIsMobile()
  // 접힌 노드 id 집합 — 영속화하지 않음(새로고침 시 전부 펼침).
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  // 삭제 확인 대상 pageId(없으면 닫힘).
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  // 「이동…」 위치 고르기 대상 pageId(없으면 닫힘, WP-839).
  const [moveTarget, setMoveTarget] = useState<number | null>(null)

  // 평면화된 트리 — DnD SortableContext 의 항목 순서.
  const flatItems = useMemo(() => flattenTree(pages ?? [], collapsed), [pages, collapsed])
  // 링크 공유 표시(WP-579) — 자기 공유·상위 공유 포함.
  const shareMarks = useMemo(() => treeShareMarks(pages ?? []), [pages])
  // 하위 포함 공유 안팎으로 옮기기 전 확인(WP-579) — 확정하면 move 를 보낸다.
  const [moveConfirm, setMoveConfirm] = useState<{
    move: { pageId: number; parentId: number | null; position: number }
    impact: ReturnType<typeof shareMoveImpact>
    title: string
  } | null>(null)

  // DnD 상태 — 드래그 중 active/over id 와 가로 오프셋(투영용).
  const [activeId, setActiveId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)
  const [offsetLeft, setOffsetLeft] = useState(0)

  // #760 렌더·SortableContext·투영이 모두 쓰는 단일 배열 — 드래그 중에는 active 의 후손을 뺀다.
  // 셋 중 하나라도 다른 배열을 보면 parentId 와 position 이 서로 다른 기준으로 계산돼 어긋난다.
  const dndItems = useMemo(
    () => (activeId != null ? removeDescendantsOf(flatItems, activeId) : flatItems),
    [flatItems, activeId],
  )

  // 드래그 중 active 행에 적용할 투영(depth/parentId). 정지 시 null.
  const projected = useMemo(() => {
    if (activeId != null && overId != null) {
      return getProjection(dndItems, activeId, overId, offsetLeft, INDENT)
    }
    return null
  }, [dndItems, activeId, overId, offsetLeft])

  // 스크린리더 안내(WP-838) — 제목·놓을 자리·들어갈 부모를 한국어로. 자리는 드롭과 같은 투영(현재 가로 오프셋)으로 구한다.
  const accessibility = useMemo(() => {
    const titleOf = (id: number) => flatItems.find((i) => i.id === id)?.title || '제목 없음'
    return {
      announcements: wikiDndAnnouncements(
        (id) => titleOf(Number(id)),
        (activeId, overId) => {
          const projection = getProjection(dndItems, Number(activeId), Number(overId), offsetLeft, INDENT)
          if (!projection) return null
          return { overTitle: titleOf(Number(overId)), parentTitle: projection.parentId != null ? titleOf(projection.parentId) : null }
        },
      ),
      screenReaderInstructions: WIKI_DND_SCREEN_READER_INSTRUCTIONS,
    }
  }, [flatItems, dndItems, offsetLeft])

  // PointerSensor distance:5 — 짧은 클릭(제목 이동)과 드래그를 구분.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // 현재 선택된 스페이스 — 멤버 버튼/다이얼로그 노출은 TEAM 스페이스에 한정.
  const selectedSpace = useMemo(
    () => (spaces ?? []).find((s) => s.id === spaceId) ?? null,
    [spaces, spaceId],
  )
  const isTeamSpace = selectedSpace?.type === 'TEAM'
  // 이 공간에 페이지를 만들고·지우고·옮길 수 있는지(WP-602) — VIEWER 에게 쓰기 버튼을 보여 주면 눌러도 403 이다.
  const canEdit = canEditWikiSpace(spaces, spaceId)
  // 스페이스 삭제는 TEAM + OWNER 만 — 개인 스페이스는 다음 접속 때 자동으로 다시 생기므로 대상이 아니다(WP-580).
  const canDeleteSpace = canDeleteWikiSpace(selectedSpace)
  // 모바일 빈 공간(페이지 0개) — 트리 대신 생성 진입점 빈 상태(WP-179). 데스크톱은 본문(WikiPageView)이 빈 상태를 그린다.
  const showNoPages = isMobile && pages?.length === 0
  // 볼 수 없거나 없는 공간 주소(WP-559) — 만들어도 404 라 ＋ 를 숨기고, 모바일은 목록이 화면 전체라 여기서 안내한다(데스크톱은 본문이 그린다).
  const spaceUnavailable = isWikiSpaceUnavailable(spacesQuery, spaceId)
  const showSpaceUnavailable = isMobile && spaceUnavailable

  const openPage = (id: number) => navigate(`/wiki/spaces/${spaceId}/pages/${id}`)


  const toggleCollapse = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // 하위 페이지 생성 — 부모를 자동 펼친 뒤 생성 페이지로 이동.
  const addSubPage = async (parentId: number) => {
    if (spaceId == null) return
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.delete(parentId)
      return next
    })
    await createPage(parentId)
  }

  // 삭제 확정 — 열려 있던 페이지가 삭제되면 스페이스 루트로 이동.
  const confirmDelete = () => {
    const id = deleteTarget
    setDeleteTarget(null)
    if (id == null || spaceId == null) return
    deletePage.mutate(id, {
      onSuccess: () => {
        if (activePageId === id) navigate(`/wiki/spaces/${spaceId}`)
      },
    })
  }

  function resetDnd() {
    setActiveId(null)
    setOverId(null)
    setOffsetLeft(0)
  }

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(Number(active.id))
    setOverId(Number(active.id))
    setOffsetLeft(0)
  }

  function handleDragMove({ delta }: DragMoveEvent) {
    setOffsetLeft(delta.x)
  }

  function handleDragOver({ over }: DragOverEvent) {
    setOverId(over ? Number(over.id) : null)
  }

  // 드롭 — 최종 over + 투영에서 부모/목표 index 를 계산해 movePage 호출.
  // 백엔드가 형제 position 을 재시퀀스하므로 0-based 목표 index 만 보낸다.
  function handleDragEnd({ active, over, delta }: DragEndEvent) {
    resetDnd()
    if (spaceId == null || !over) return
    const aId = Number(active.id)
    const oId = Number(over.id)
    // 종료 시점은 event.delta 로 오프셋을 직접 계산(상태 stale 회피).
    // #760 배열은 투영·index 계산 모두 dndItems(후손 제외) 로 통일한다.
    const projection = getProjection(dndItems, aId, oId, delta.x, INDENT)
    if (!projection) return
    const { parentId } = projection

    // 이동 후 배열에서 active 의 새 슬롯 앞에 위치하며 같은 부모인 형제 수 = 목표 index.
    const activeIdx = dndItems.findIndex((i) => i.id === aId)
    const overIdx = dndItems.findIndex((i) => i.id === oId)
    const newItems = arrayMove(dndItems, activeIdx, overIdx)
    const newActiveIdx = newItems.findIndex((i) => i.id === aId)
    let position = 0
    for (let i = 0; i < newActiveIdx; i++) {
      if (newItems[i].parentId === parentId) position++
    }

    // no-op 가드 — 현재 부모/형제 index 와 동일하면 호출 생략.
    const current = dndItems[activeIdx]
    const currentSiblingsBefore = dndItems
      .slice(0, activeIdx)
      .filter((i) => i.parentId === current.parentId).length
    if (parentId === current.parentId && position === currentSiblingsBefore) return

    requestMove({ pageId: aId, parentId, position }, current.title)
  }

  // 끌어 놓기와 「이동…」이 함께 쓰는 옮기기 — 공유 범위는 지금 위치로 정해진다. 하위 포함 공유에서 빠지거나 새로 들어가면
  // 링크로 보이는 것이 바뀌므로 먼저 묻는다(WP-579).
  function requestMove(move: { pageId: number; parentId: number | null; position: number }, title: string) {
    const impact = shareMoveImpact(pages ?? [], move.pageId, move.parentId)
    if (impact.leaving.length > 0 || impact.entering.length > 0) {
      setMoveConfirm({ move, impact, title })
      return
    }
    movePage.mutate(move)
  }

  // 앱 타이틀 헤더 — 레일과 동일한 아이콘 + 이름으로 "노트" 앱임을 명시(다른 앱과 한 선 정렬). 세 갈래(실패·공간 0개·평소)가 같이 쓴다.
  const appTitle = (
    <div className={sidebarTitleClass}>
      <BookOpen className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
      노트
    </div>
  )
  // 공간 목록 첫 조회 실패(WP-865) — 공간을 고르기 전(/wiki, 모바일 목록)엔 빈 선택 상자 대신 실패 안내 + 다시 시도.
  // 공간 안에서는 트리가 따로 조회되므로 아래에서 선택 상자 자리만 바꾸고 트리·새 노트는 그대로 둔다.
  const spacesError = spacesQuery.isLoadingError ? (
    <LoadErrorState
      variant="inline"
      title="노트 공간을 불러오지 못했습니다"
      queries={[spacesQuery]}
      testId="wiki-sidebar-spaces-error"
    />
  ) : null
  if (spacesError && spaceId == null) {
    return (
      <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40">
        {appTitle}
        {spacesError}
      </aside>
    )
  }

  // 공간 0개(WP-143) — 선택 상자·페이지 트리 대신 빈 상태. 모바일은 이 목록이 화면 전체라 여기 그리고,
  // 데스크톱은 본문(/wiki, WikiIndexRedirect)이 같은 빈 상태를 그리므로 사이드바는 타이틀만 남긴다.
  if (spaces?.length === 0) {
    return (
      <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40">
        {appTitle}
        {isMobile && <WikiNoSpaces className="flex-1" onCreate={openCreateSpace} />}
        {createSpaceDialog}
      </aside>
    )
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40">
      {appTitle}
      {/* 공간 목록 실패 중이면 선택 상자 자리에 안내(WP-865) — 트리는 아래에 그대로.
          스페이스 전환 — shadcn/ui Select로 디자인 시스템 일관성 유지. 옆 ⋯ 는 스페이스 단위 메뉴(WP-582: 멤버, WP-580: 삭제) */}
      {spacesError ? (
        <div className="border-b">{spacesError}</div>
      ) : (
        <div className="flex items-center gap-1 border-b p-2">
          <Select
            value={String(spaceId ?? '')}
            onValueChange={(v) => {
              // 생성 항목은 이동 대신 다이얼로그를 연다.
              if (v === CREATE_SENTINEL) {
                openCreateSpace()
                return
              }
              navigate(`/wiki/spaces/${v}`)
            }}
          >
            <SelectTrigger className="h-8 w-full min-w-0 flex-1 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(spaces ?? []).map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={CREATE_SENTINEL} data-testid="wiki-space-create-item">
                ＋ 새 스페이스
              </SelectItem>
            </SelectContent>
          </Select>
          {/* 스페이스 ⋯ — 공유 중인 페이지(WP-579)는 모든 스페이스, 멤버(WP-582)·삭제(WP-580)는 팀 스페이스만. 드라이브 공간 줄 ⋯ 와 같은 자리. */}
          {selectedSpace && !spaceUnavailable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`${selectedSpace?.name ?? '스페이스'} 메뉴`}
                  data-testid="wiki-space-menu"
                  className="flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-11"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isTeamSpace && (
                  <DropdownMenuItem data-testid="wiki-space-members" onSelect={() => setMembersOpen(true)}>
                    멤버
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem data-testid="wiki-space-shared-pages" onSelect={() => setSharedOpen(true)}>
                  공유 중인 페이지
                </DropdownMenuItem>
                {/* 삭제는 소유자에게만 — 되돌릴 수 없는 동작이라 구분선으로 떼어 둔다. */}
                {canDeleteSpace && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      data-testid="wiki-space-delete"
                      onSelect={() => setSpaceDeleteOpen(true)}
                    >
                      스페이스 삭제
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase text-muted-foreground">페이지</span>
        <div className="flex items-center gap-1">
          {!spaceUnavailable && canEdit && (
            <button
              type="button"
              onClick={() => createPage(null)}
              className="rounded px-1.5 text-sm text-muted-foreground hover:bg-accent"
              aria-label="새 페이지"
            >
              ＋
            </button>
          )}
        </div>
      </div>
      {/* 모바일은 공간 화면이 목록이라 본문 빈 상태가 없다 — 페이지 0개면 트리 대신 생성 진입점을 준다(WP-179). */}
      {showSpaceUnavailable ? (
        <WikiSpaceUnavailableState onBack={() => navigate('/wiki')} />
      ) : showNoPages ? (
        <WikiNoPages
          className="flex-1"
          onCreate={canEdit ? (withAiDraft) => createPage(null, withAiDraft) : undefined}
          pending={createPending}
        />
      ) : (
        <nav className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            accessibility={accessibility}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={resetDnd}
          >
            <SortableContext
              items={dndItems.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              {dndItems.map((item) => (
                <WikiTreeRow
                  key={item.id}
                  id={item.id}
                  title={item.title}
                  aiAttributed={item.aiLastUsedAt != null}
                  shareMark={shareMarks.get(item.id)}
                  depth={activeId === item.id && projected ? projected.depth : item.depth}
                  hasChildren={item.hasChildren}
                  collapsed={collapsed.has(item.id)}
                  selected={item.id === activePageId}
                  onToggle={toggleCollapse}
                  onOpen={openPage}
                  onAddChild={addSubPage}
                  onRequestDelete={setDeleteTarget}
                  onRequestMove={setMoveTarget}
                  canEdit={canEdit}
                />
              ))}
            </SortableContext>
          </DndContext>
        </nav>
      )}

      {/* 멤버 관리 다이얼로그 — TEAM 스페이스 선택 시에만 렌더. */}
      {isTeamSpace && selectedSpace && (
        <WikiSpaceMemberDialog
          space={selectedSpace}
          open={membersOpen}
          onOpenChange={setMembersOpen}
        />
      )}
      {selectedSpace && (
        <WikiSharedPagesDialog
          open={sharedOpen}
          onOpenChange={setSharedOpen}
          spaceId={selectedSpace.id}
          spaceName={selectedSpace.name}
          onOpenPage={openPage}
        />
      )}
      {createSpaceDialog}
      <WikiDeleteSpaceDialog
        open={spaceDeleteOpen}
        onOpenChange={setSpaceDeleteOpen}
        spaceName={selectedSpace?.name ?? ''}
        pageCount={pages?.length ?? null}
        pending={deleteSpace.isPending}
        // 이동·토스트는 useDeleteSpace 의 onDeleted 가 한다.
        onConfirm={() => spaceId != null && deleteSpace.mutate(spaceId)}
      />
      <WikiMovePageDialog
        pages={pages ?? []}
        pageId={moveTarget}
        onClose={() => setMoveTarget(null)}
        onPick={(parentId) => {
          const target = moveTarget
          setMoveTarget(null)
          if (target == null) return
          // 고른 페이지의 맨 아래 하위로 — 펼쳐 둬야 옮긴 페이지가 바로 보인다.
          if (parentId != null) setCollapsed((prev) => (prev.has(parentId) ? new Set([...prev].filter((v) => v !== parentId)) : prev))
          const title = pages?.find((p) => p.id === target)?.title ?? ''
          requestMove({ pageId: target, parentId, position: lastChildPosition(pages ?? [], target, parentId) }, title)
        }}
      />
      <WikiMoveShareDialog
        state={moveConfirm}
        onCancel={() => setMoveConfirm(null)}
        onConfirm={() => {
          if (moveConfirm) movePage.mutate(moveConfirm.move)
          setMoveConfirm(null)
        }}
      />
      {/* 페이지 삭제 확인(사이드바 행 ⋯). hasChildren 은 flatItems 에서 파생. */}
      <WikiDeletePageDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        pageTitle={flatItems.find((i) => i.id === deleteTarget)?.title ?? ''}
        hasChildren={flatItems.find((i) => i.id === deleteTarget)?.hasChildren ?? false}
        onConfirm={confirmDelete}
      />
    </aside>
  )
}
