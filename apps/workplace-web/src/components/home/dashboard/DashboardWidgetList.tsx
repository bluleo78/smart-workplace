// 홈 대시보드 위젯 목록(WP-161 에서 Dashboard.tsx 로부터 분리) — 데스크톱 그리드 / 모바일 세로 목록 × 보기 / 편집.
// 편집 모드의 dnd 골격(센서·충돌 판정·SortableContext)과 카드 DOM ref(포커스 복원·추가 위젯 스크롤)를 이 컴포넌트가 단독 소유한다.
import {
  type Announcements,
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useEffect, useMemo, useRef } from 'react'

import { useInboxPanel } from '@/components/layout/InboxContext'
import { useToggleWidgetCollapsed } from '@/hooks/queries/useDashboard'

import { MobileWidgetCard } from '../widgets/mobile/MobileWidgetCard'
import { DashboardEmptyState } from './DashboardEmptyState'
import { EditableWidgetCard } from './EditableWidgetCard'
import { EntryBody } from './EntryBody'
import { MobileEditableWidgetCard } from './MobileEditableWidgetCard'
import { entryDeepLink, entryTitle, type ResolvedEntry, visibleEntries } from './resolvedEntry'
import type { DashboardEditDraft } from './useDashboardEditDraft'
import { WidgetCard } from './WidgetCard'

// 충돌 판정 — closestCenter 는 "드래그 중인 카드 자체의 rect 중심"과 다른 카드 rect 중심 간의
// 거리로 over 를 정한다. wide(col-span-3) 위젯을 드래그하면 그 오버레이도 전체 폭(3컬럼) 크기를
// 그대로 유지하므로 중심 x 좌표가 그리드 가운데(2번째 컬럼) 근처에 고정돼, 실제 마우스 포인터가
// 1번째 컬럼 카드 위에 있어도 2번째 컬럼 카드가 더 가깝게 계산되어 엉뚱한 위치로 건너뛴다(#645).
// 포인터의 실제 좌표가 어느 카드 rect 안에 들어있는지로 판정하는 pointerWithin 을 우선 사용하면
// 드래그 중인 카드의 크기/모양과 무관하게 정확한 over 를 얻을 수 있다. 포인터가 카드 사이 여백 등
// 어떤 rect 에도 속하지 않는 경우를 위해 rectIntersection → closestCenter 순으로 폴백한다.
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) return pointerCollisions
  const rectCollisions = rectIntersection(args)
  if (rectCollisions.length > 0) return rectCollisions
  return closestCenter(args)
}

// 드래그 핸들의 스크린리더 사용법 안내(aria-describedby) — dnd-kit 기본값은 영어라 한국어로 바꾼다(WP-641).
const SCREEN_READER_INSTRUCTIONS = {
  draggable: 'Space 키로 위젯을 집고, 방향키로 옮길 자리를 고른 뒤 Space 키로 놓으세요. Esc 키를 누르면 취소됩니다.',
}

interface Props {
  /** 모바일(lg 미만) 세로 목록이면 true, 아니면 데스크톱 3열 그리드. */
  isMobile: boolean
  /** 보기 모드에 그릴 저장된 엔트리(숨김 포함 — 여기서 걸러 낸다). */
  savedEntries: ResolvedEntry[]
  /** 편집 초안 상태·액션(useDashboardEditDraft). */
  edit: DashboardEditDraft
}


/** 위젯 목록 — 기기·모드별 카드 골격. data-testid="dashboard" 컨테이너의 DOM 은 분리 전과 같다. */
export function DashboardWidgetList({ isMobile, savedEntries, edit }: Props) {
  const { editing, draftEntries, recentlyAddedId, moveFocus } = edit
  const toggleCollapse = useToggleWidgetCollapsed()
  // 알림처럼 경로 없는 위젯의 모바일 머리 동작(인박스 열기 → 모바일 셸에선 /notifications, #274).
  const { openInbox } = useInboxPanel()

  // 카드/이동버튼 DOM 참조 맵(id 키). 콜백 ref 로 등록.
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const upRefs = useRef(new Map<string, HTMLButtonElement>())
  const downRefs = useRef(new Map<string, HTMLButtonElement>())

  // I2: 경계 이동 후 포커스 복원 — 이동 버튼이 비활성(양 끝)이 되면 카드 자체로 포커스를 옮긴다.
  useEffect(() => {
    if (!moveFocus) return
    const { id, dir } = moveFocus
    const btn = (dir < 0 ? upRefs : downRefs).current.get(id)
    if (btn && !btn.disabled) {
      btn.focus()
    } else {
      cardRefs.current.get(id)?.focus()
    }
  }, [moveFocus])

  // 삭제 뒤 포커스 잇기(WP-842) — 지운 카드는 통째로 빠져 「삭제」 버튼에 있던 포커스가 body 로 사라졌다. 같은 자리에 온 위젯
  // (마지막이었으면 바로 앞 위젯)의 「삭제」 버튼으로, 남은 위젯이 없으면 빈 상태의 행동 버튼(위젯 추가)으로 옮겨
  // 키보드·스크린리더 사용자가 이어서 조작하게 한다.
  const removedAt = useRef<number | null>(null)
  useEffect(() => {
    const index = removedAt.current
    if (index == null) return
    removedAt.current = null
    const next = draftEntries[Math.min(index, draftEntries.length - 1)]
    const card = next ? cardRefs.current.get(next.cfg.id) : undefined
    const target = card
      ? (card.querySelector<HTMLElement>('[data-testid="widget-remove"]') ?? card)
      : document.querySelector<HTMLElement>('[data-testid="dashboard-empty-action"]')
    target?.focus()
  }, [draftEntries])
  function removeWidget(id: string) {
    removedAt.current = draftEntries.findIndex((e) => e.cfg.id === id)
    edit.removeWidget(id)
  }

  // 위젯 추가 직후 해당 카드로 스크롤 이동(강조 해제 타이머는 useDashboardEditDraft 가 관리).
  useEffect(() => {
    if (!recentlyAddedId) return
    cardRefs.current.get(recentlyAddedId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [recentlyAddedId])

  // 모바일 ⌃/⌄ — 편집 모드 밖에서 즉시 저장(낙관적, 실패 롤백·토스트는 훅이 담당).
  function toggleCollapsed(entry: ResolvedEntry) {
    const collapsed = entry.cfg.collapsed !== true
    toggleCollapse.mutate({ id: entry.cfg.id, collapsed })
    edit.announce(`${entryTitle(entry)} 위젯을 ${collapsed ? '접었습니다' : '펼쳤습니다'}`)
  }

  // 드래그앤드랍 센서 — PointerSensor distance:8 로 일반 클릭(버튼)과 드래그 제스처를 분리.
  // KeyboardSensor — 핸들이 dnd-kit 기본 ARIA(role=button·aria-roledescription=sortable)로 키보드 조작을 알리므로
  // 실제로 Space 집기 → 방향키 → Space 놓기가 되게 한다(WP-641). 리스너는 핸들에만 있어 카드 안 다른 버튼의 키 입력은 받지 않는다.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  // 드래그 종료 — active 위젯을 over 위젯 자리로 재배치(같은 자리면 훅이 무시).
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over) return
    edit.reorderWidget(String(active.id), String(over.id))
  }
  const sortableIds = draftEntries.map((e) => e.cfg.id)
  // 스크린리더 안내 — dnd-kit 기본 문구는 영어에 원시 id(my_tasks)를 읽는다. 위젯 이름과 몇 번째 자리인지로 읽는다(WP-641).
  const accessibility = useMemo(() => {
    const titleOf = (id: string | number) => {
      const entry = draftEntries.find((e) => e.cfg.id === id)
      return entry ? entryTitle(entry) : '위젯'
    }
    const positionOf = (id: string | number) => draftEntries.findIndex((e) => e.cfg.id === id) + 1
    const announcements: Announcements = {
      onDragStart: ({ active }) => `${titleOf(active.id)} 위젯을 집었습니다. 지금 ${positionOf(active.id)}번째 자리입니다.`,
      // 집은 직후 over 가 자기 자신으로 잡혀 onDragOver 가 바로 불린다 — 자기 자리면 읽지 않아 「집었습니다」를 덮지 않는다.
      onDragOver: ({ active, over }) => {
        if (over?.id === active.id) return undefined
        return over
          ? `${titleOf(active.id)} 위젯이 ${positionOf(over.id)}번째 자리 위에 있습니다.`
          : `${titleOf(active.id)} 위젯이 놓을 자리 밖에 있습니다.`
      },
      onDragEnd: ({ active, over }) =>
        over && over.id !== active.id
          ? `${titleOf(active.id)} 위젯을 ${positionOf(over.id)}번째 자리에 놓았습니다.`
          : `${titleOf(active.id)} 위젯을 놓았습니다. 순서는 그대로입니다.`,
      onDragCancel: ({ active }) => `${titleOf(active.id)} 위젯 이동을 취소했습니다.`,
    }
    return { announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }
  }, [draftEntries])
  const visibleSaved = visibleEntries(savedEntries)

  // 빈 상태(WP-520) — 보기 모드에서 모두 숨김이거나, 편집 초안에서 모두 지웠으면 빈 캔버스 대신 안내와 다음 행동을 준다.
  if (editing ? draftEntries.length === 0 : visibleSaved.length === 0) {
    return (
      <div data-testid="dashboard">
        <DashboardEmptyState
          isMobile={isMobile}
          mode={editing ? 'edit' : 'view'}
          onAction={editing ? () => edit.setAddModalOpen(true) : edit.enterEdit}
        />
      </div>
    )
  }

  if (isMobile) {
    // 모바일(WP-142): 세로 한 줄 목록(카드 간격 12px). 본문형은 접기 가능, 타일형은 한 줄 링크.
    // 편집 모드는 같은 카드 모양에 ⌃ 자리만 편집 컨트롤로 교체한다.
    return (
      <div className="flex flex-col gap-3" data-testid="dashboard">
        {editing ? (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragEnd={handleDragEnd}
            accessibility={accessibility}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {draftEntries.map((entry) => (
                <MobileEditableWidgetCard
                  key={entry.cfg.id}
                  entry={entry}
                  onToggleHidden={() => edit.toggleHidden(entry.cfg.id)}
                  onCount={(n) => edit.setCount(entry.cfg.id, n)}
                  onApplyCatalogConfig={(patch) => edit.applyCatalogConfig(entry.cfg.id, patch)}
                  onRemove={() => removeWidget(entry.cfg.id)}
                  highlighted={entry.cfg.id === recentlyAddedId}
                  cardRef={(el) => {
                    if (el) cardRefs.current.set(entry.cfg.id, el)
                    else cardRefs.current.delete(entry.cfg.id)
                  }}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          visibleSaved.map((entry) => (
            <MobileWidgetCard
              key={entry.cfg.id}
              cfg={entry.cfg}
              title={entryTitle(entry)}
              icon={entry.def.icon}
              mobile={entry.def.mobile}
              body={<EntryBody entry={entry} />}
              headerLink={entryDeepLink(entry)}
              onHeaderClick={entry.cfg.type === 'notifications' ? () => openInbox() : undefined}
              onToggleCollapsed={() => toggleCollapsed(entry)}
            />
          ))
        )}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-testid="dashboard">
      {editing ? (
        <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragEnd={handleDragEnd}
            accessibility={accessibility}
          >
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            {draftEntries.map((entry, i) => (
              <EditableWidgetCard
                key={entry.cfg.id}
                entry={entry}
                index={i}
                total={draftEntries.length}
                onMove={(dir) => edit.moveWidget(entry.cfg.id, dir)}
                onToggleHidden={() => edit.toggleHidden(entry.cfg.id)}
                onToggleChromeless={() => edit.toggleChromeless(entry.cfg.id)}
                onCount={(n) => edit.setCount(entry.cfg.id, n)}
                onApplyCatalogConfig={(patch) => edit.applyCatalogConfig(entry.cfg.id, patch)}
                onRemove={() => removeWidget(entry.cfg.id)}
                highlighted={entry.cfg.id === recentlyAddedId}
                cardRef={(el) => {
                  if (el) cardRefs.current.set(entry.cfg.id, el)
                  else cardRefs.current.delete(entry.cfg.id)
                }}
                upRef={(el) => {
                  if (el) upRefs.current.set(entry.cfg.id, el)
                  else upRefs.current.delete(entry.cfg.id)
                }}
                downRef={(el) => {
                  if (el) downRefs.current.set(entry.cfg.id, el)
                  else downRefs.current.delete(entry.cfg.id)
                }}
              />
            ))}
          </SortableContext>
        </DndContext>
      ) : (
        visibleSaved.map((entry) => <WidgetCard key={entry.cfg.id} entry={entry} />)
      )}
    </div>
  )
}
