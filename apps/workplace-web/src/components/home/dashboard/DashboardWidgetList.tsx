// 홈 대시보드 위젯 목록(WP-161 에서 Dashboard.tsx 로부터 분리) — 데스크톱 그리드 / 모바일 세로 목록 × 보기 / 편집.
// 편집 모드의 dnd 골격(센서·충돌 판정·SortableContext)과 카드 DOM ref(포커스 복원·추가 위젯 스크롤)를 이 컴포넌트가 단독 소유한다.
import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useEffect, useRef } from 'react'

import { useInboxPanel } from '@/components/layout/InboxContext'
import { useToggleWidgetCollapsed } from '@/hooks/queries/useDashboard'

import { MobileWidgetCard } from '../widgets/mobile/MobileWidgetCard'
import { EditableWidgetCard } from './EditableWidgetCard'
import { EntryBody } from './EntryBody'
import { MobileEditableWidgetCard } from './MobileEditableWidgetCard'
import { entryDeepLink, entryTitle, type ResolvedEntry } from './resolvedEntry'
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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  // 드래그 종료 — active 위젯을 over 위젯 자리로 재배치(같은 자리면 훅이 무시).
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over) return
    edit.reorderWidget(String(active.id), String(over.id))
  }
  const sortableIds = draftEntries.map((e) => e.cfg.id)
  const visibleSaved = savedEntries.filter((e) => !e.cfg.hidden)

  if (isMobile) {
    // 모바일(WP-142): 세로 한 줄 목록(카드 간격 12px). 본문형은 접기 가능, 타일형은 한 줄 링크.
    // 편집 모드는 같은 카드 모양에 ⌃ 자리만 편집 컨트롤로 교체한다.
    return (
      <div className="flex flex-col gap-3" data-testid="dashboard">
        {editing ? (
          <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd}>
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {draftEntries.map((entry) => (
                <MobileEditableWidgetCard
                  key={entry.cfg.id}
                  entry={entry}
                  onToggleHidden={() => edit.toggleHidden(entry.cfg.id)}
                  onCount={(n) => edit.setCount(entry.cfg.id, n)}
                  onApplyCatalogConfig={(patch) => edit.applyCatalogConfig(entry.cfg.id, patch)}
                  onRemove={() => edit.removeWidget(entry.cfg.id)}
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
        <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd}>
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
                onRemove={() => edit.removeWidget(entry.cfg.id)}
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
