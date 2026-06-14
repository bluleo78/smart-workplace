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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  useCreatePage,
  useDeletePage,
  useMovePage,
} from '../../hooks/queries/useWikiMutations'
import { useWikiSpaces } from '../../hooks/queries/useWikiSpaces'
import { useWikiTree } from '../../hooks/queries/useWikiTree'
import type { WikiPageSummary } from '../../types/wiki'
import { WikiSpaceMemberDialog } from './WikiSpaceMemberDialog'

// 들여쓰기 1단계 폭(px). 투영(projection) 시 가로 오프셋을 이 값으로 나눠 depth 변화를 계산한다.
const INDENT = 16

// 평면화된 트리 항목 — DnD 정렬/투영의 단위.
interface FlatItem {
  id: number
  parentId: number | null
  depth: number
  title: string
}

// 평면 목록 → depth-first 평면 배열. 형제는 position 순서 유지, 모든 노드 펼침(v1 접기 없음).
// parentId 가 목록에 없는(고아) 페이지는 루트로 취급한다.
function flattenTree(pages: WikiPageSummary[]): FlatItem[] {
  const ids = new Set(pages.map((p) => p.id))
  // 부모별 자식 그룹화 — 존재하지 않는 부모는 null(루트)로 정규화.
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
      result.push({ id: c.id, parentId, depth, title: c.title })
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  return result
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
): { depth: number; parentId: number | null } {
  const overIdx = items.findIndex((i) => i.id === overId)
  const activeIdx = items.findIndex((i) => i.id === activeId)
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

// 정렬 가능한 트리 행 — useSortable. 행 컨테이너에 listeners 를 깔되 distance:5 센서로
// 클릭(제목 이동)과 드래그를 구분한다. depth 는 투영 중 active 행에 한해 투영 depth 를 받는다.
function SortableTreeItem({
  id,
  title,
  depth,
  selected,
  onOpen,
  onDelete,
}: {
  id: number
  title: string
  depth: number
  selected: boolean
  onOpen: (id: number) => void
  onDelete: (id: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }
  const label = title || '제목 없음'
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group relative flex items-center ${isDragging ? 'opacity-50' : ''}`}
    >
      {/* 제목 — 짧은 클릭이면 이동(distance:5 센서가 드래그와 분리). */}
      <button
        type="button"
        onClick={() => onOpen(id)}
        style={{ paddingLeft: 8 + depth * INDENT, paddingRight: 28 }}
        className={`block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-accent ${
          selected ? 'bg-accent font-medium' : ''
        }`}
      >
        {label}
      </button>
      {/* 페이지 삭제 — 평소 opacity-0, hover 시 노출. */}
      <button
        type="button"
        onClick={() => onDelete(id)}
        aria-label={`삭제: ${label}`}
        className="absolute right-1 rounded px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        ✕
      </button>
    </div>
  )
}

/** 위키 2차 사이드바 — 스페이스 선택 + 페이지 트리(드래그앤드롭 재정렬/재부모). */
export function WikiSidebar() {
  const navigate = useNavigate()
  const { spaceId: spaceIdParam, pageId: pageIdParam } = useParams()
  const spaceId = spaceIdParam ? Number(spaceIdParam) : null
  const activePageId = pageIdParam ? Number(pageIdParam) : null

  const { data: spaces } = useWikiSpaces()
  const { data: pages } = useWikiTree(spaceId)
  const createPage = useCreatePage(spaceId ?? 0)
  const deletePage = useDeletePage(spaceId ?? 0)
  const movePage = useMovePage(spaceId ?? 0)
  // 멤버 관리 다이얼로그 열림 상태 — TEAM 스페이스에서만 노출.
  const [membersOpen, setMembersOpen] = useState(false)

  // 평면화된 트리 — DnD SortableContext 의 항목 순서.
  const flatItems = useMemo(() => flattenTree(pages ?? []), [pages])

  // DnD 상태 — 드래그 중 active/over id 와 가로 오프셋(투영용).
  const [activeId, setActiveId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)
  const [offsetLeft, setOffsetLeft] = useState(0)

  // 드래그 중 active 행에 적용할 투영(depth/parentId). 정지 시 null.
  const projected = useMemo(() => {
    if (activeId != null && overId != null) {
      return getProjection(flatItems, activeId, overId, offsetLeft, INDENT)
    }
    return null
  }, [flatItems, activeId, overId, offsetLeft])

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

  const openPage = (id: number) => navigate(`/wiki/spaces/${spaceId}/pages/${id}`)

  const addRootPage = async () => {
    if (spaceId == null) return
    const created = await createPage.mutateAsync({ parentId: null, title: '제목 없음' })
    openPage(created.id)
  }

  // 페이지 삭제 — 확인 후 mutate. 열려 있던 페이지가 삭제되면 스페이스 루트로 이동.
  const handleDelete = async (id: number) => {
    if (spaceId == null) return
    if (!window.confirm('이 페이지를 삭제할까요? 하위 페이지도 함께 삭제됩니다.')) return
    await deletePage.mutateAsync(id)
    if (activePageId === id) navigate(`/wiki/spaces/${spaceId}`)
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
    const { parentId } = getProjection(flatItems, aId, oId, delta.x, INDENT)

    // 이동 후 배열에서 active 의 새 슬롯 앞에 위치하며 같은 부모인 형제 수 = 목표 index.
    const activeIdx = flatItems.findIndex((i) => i.id === aId)
    const overIdx = flatItems.findIndex((i) => i.id === oId)
    const newItems = arrayMove(flatItems, activeIdx, overIdx)
    const newActiveIdx = newItems.findIndex((i) => i.id === aId)
    let position = 0
    for (let i = 0; i < newActiveIdx; i++) {
      if (newItems[i].parentId === parentId) position++
    }

    // no-op 가드 — 현재 부모/형제 index 와 동일하면 호출 생략.
    const current = flatItems[activeIdx]
    const currentSiblingsBefore = flatItems
      .slice(0, activeIdx)
      .filter((i) => i.parentId === current.parentId).length
    if (parentId === current.parentId && position === currentSiblingsBefore) return

    movePage.mutate({ pageId: aId, parentId, position })
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/20">
      <div className="border-b p-2">
        <select
          value={spaceId ?? ''}
          onChange={(e) => navigate(`/wiki/spaces/${e.target.value}`)}
          className="w-full rounded border bg-background px-2 py-1 text-sm"
        >
          {(spaces ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase text-muted-foreground">페이지</span>
        <div className="flex items-center gap-1">
          {/* TEAM 위키만 멤버 관리 노출 — 개인(PERSONAL) 위키는 공유 대상 아님. */}
          {isTeamSpace && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="멤버 관리"
              onClick={() => setMembersOpen(true)}
            >
              멤버
            </Button>
          )}
          <button
            type="button"
            onClick={addRootPage}
            className="rounded px-1.5 text-sm text-muted-foreground hover:bg-accent"
            aria-label="새 페이지"
          >
            ＋
          </button>
        </div>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={resetDnd}
        >
          <SortableContext
            items={flatItems.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            {flatItems.map((item) => (
              <SortableTreeItem
                key={item.id}
                id={item.id}
                title={item.title}
                // 드래그 중 active 행만 투영 depth 를 적용(시각적 들여쓰기 피드백).
                depth={activeId === item.id && projected ? projected.depth : item.depth}
                selected={item.id === activePageId}
                onOpen={openPage}
                onDelete={handleDelete}
              />
            ))}
          </SortableContext>
        </DndContext>
      </nav>

      {/* 멤버 관리 다이얼로그 — TEAM 스페이스 선택 시에만 렌더. */}
      {isTeamSpace && selectedSpace && (
        <WikiSpaceMemberDialog
          space={selectedSpace}
          open={membersOpen}
          onOpenChange={setMembersOpen}
        />
      )}
    </aside>
  )
}
