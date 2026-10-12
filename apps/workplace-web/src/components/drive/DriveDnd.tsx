// 드라이브 끌어 옮기기(WP-364) 드래그 앤 드롭 컨텍스트 — 이슈 화면 IssueDndProvider 와 같은 구성.
// - DndContext·DragOverlay(요약 칩)·드롭 처리는 여기서, 순수 규칙은 lib/driveDnd.ts.
// - 행(useDriveRowDnd)은 드래그 소스, 폴더 행·경로(useDriveFolderDrop)는 드롭 대상. 경로와 목록이 같은 DndContext 안이어야
//   목록 행을 경로로 끌어 놓을 수 있으므로 페이지가 경로+목록을 이 provider 하나로 감싼다.
// - dnd-kit 은 포인터 이벤트 기반이라 OS 파일 업로드(HTML5 drop, drive-dropzone)와 서로 간섭하지 않는다.
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { FileText, Folder } from 'lucide-react'
import { type ComponentProps, createContext, type ReactNode, useCallback, useContext, useId, useMemo, useState } from 'react'

import { DROP_TARGET_CLASS } from '@/lib/dndDropClass'
import { snapRowChipToPointer } from '@/lib/dndRowChip'
import {
  DRIVE_DND_SCREEN_READER_INSTRUCTIONS,
  type DriveActiveDrag,
  driveCollision,
  driveDndAnnouncements,
  type DriveDragData,
  driveDragId,
  type DriveDragItem,
  type DriveDropData,
  driveDropId,
  type DriveDropState,
  driveDropState,
  driveKeyboardCoordinates,
  isDragged,
  isDriveDropData,
} from '@/lib/driveDnd'
import { cn } from '@/lib/utils'

// 렌더마다 새 배열을 만들지 않도록 모듈 상수로 둔다.
const CHIP_MODIFIERS = [snapRowChipToPointer]

type DriveDndState = {
  // 끌어 옮기기 사용 가능 여부 — 데스크톱(마우스)·쓰기 가능한 공간에서만(페이지가 결정).
  enabled: boolean
  // 진행 중인 드래그(없으면 null).
  active: DriveActiveDrag | null
  // 지금 보고 있는 폴더(null=루트) — 여기로는 놓아도 변화가 없다.
  currentFolderId: number | null
}

const DriveDndCtx = createContext<DriveDndState>({ enabled: false, active: null, currentFolderId: null })

export function DriveDndProvider({
  enabled,
  currentFolderId,
  resolveItems,
  onMove,
  children,
}: {
  enabled: boolean
  currentFolderId: number | null
  // 잡은 항목 → 실제로 옮길 묶음(선택 포함). 드래그 시작 시 한 번 계산해 드래그 동안 고정한다.
  resolveItems: (lead: DriveDragItem) => DriveDragItem[]
  // 허용 대상에 놓았을 때 — 페이지가 bulkMove·토스트·되돌리기를 처리한다.
  onMove: (items: DriveDragItem[], target: DriveDropData) => void
  children: ReactNode
}) {
  const [active, setActive] = useState<DriveActiveDrag | null>(null)
  // PointerSensor distance:5 — 짧은 클릭은 이름 버튼(폴더 열기·미리보기)으로 남긴다.
  // 키보드 시작은 Space 만 — Enter 는 행 안 버튼의 기본 동작으로 남긴다(IssueDndProvider 와 동일).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: driveKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  )
  // 스크린리더 안내 — 항목·폴더 이름(한국어), 원시 id 는 읽지 않는다.
  const accessibility = useMemo(
    () => ({ announcements: driveDndAnnouncements(active), screenReaderInstructions: DRIVE_DND_SCREEN_READER_INSTRUCTIONS }),
    [active],
  )

  function handleDragStart(e: DragStartEvent) {
    const data = e.active.data.current as DriveDragData | undefined
    if (!data) return
    const next = { lead: data.lead, items: resolveItems(data.lead) }
    setActive(next)
  }

  function handleDragEnd(e: DragEndEvent) {
    const drag = active
    setActive(null)
    const dst = e.over?.data.current
    if (!drag || !isDriveDropData(dst)) return
    // 비허용 대상은 droppable 이 disabled 라 over 가 되지 않지만, 규칙을 한 번 더 확인해 방어한다.
    if (driveDropState(drag, dst.folderId, currentFolderId) !== 'allowed') return
    onMove(drag.items, dst)
  }

  const value = useMemo(() => ({ enabled, active, currentFolderId }), [enabled, active, currentFolderId])

  return (
    <DriveDndCtx.Provider value={value}>
      <DndContext
        sensors={sensors}
        collisionDetection={driveCollision}
        accessibility={accessibility}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActive(null)}
      >
        {children}
        {/* 행 칩은 원본 행보다 훨씬 좁아 포인터 기준으로 옮긴다(이슈 목록 행 칩과 같은 modifier). */}
        <DragOverlay dropAnimation={null} modifiers={CHIP_MODIFIERS}>
          {active ? <DriveDragChip active={active} /> : null}
        </DragOverlay>
      </DndContext>
    </DriveDndCtx.Provider>
  )
}

// 드래그 고스트 — 잡은 항목 아이콘·이름, 여러 개면 「외 N개」. 배경은 bg-popover(솔리드) — 다크의 --card 는 3% 알파라 아래 글자가 비친다.
function DriveDragChip({ active }: { active: DriveActiveDrag }) {
  const Icon = active.lead.kind === 'folder' ? Folder : FileText
  const rest = active.items.length - 1
  return (
    <div
      className="flex max-w-80 cursor-grabbing items-center gap-1.5 rounded-md border bg-popover px-3 py-1.5 text-sm shadow-xl ring-2 ring-primary/40"
      data-testid="drive-drag-overlay"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate">{active.lead.name}</span>
      {rest > 0 && <span className="shrink-0 text-xs text-muted-foreground">외 {rest}개</span>}
    </div>
  )
}

// 드롭 상태별 표시 — 공용 규칙(점선=놓을 수 있음, 실선+배경=여기에 놓임, 흐림=놓을 수 없음).
const DROP_STATE_CLASS: Record<DriveDropState | 'over', string> = {
  idle: '',
  allowed: DROP_TARGET_CLASS.allowed,
  over: DROP_TARGET_CLASS.over,
  blocked: DROP_TARGET_CLASS.dimmed,
}

// 폴더 드롭 대상 공통 — target=null 이면(파일 행 등) 대상이 아니다(비활성 droppable).
function useFolderDroppable(id: string, target: DriveDropData | null) {
  const { enabled, active, currentFolderId } = useContext(DriveDndCtx)
  const state: DriveDropState = enabled && target ? driveDropState(active, target.folderId, currentFolderId) : 'idle'
  const { setNodeRef, isOver } = useDroppable({ id, data: target ?? undefined, disabled: state !== 'allowed' })
  const dropState = state === 'allowed' && isOver ? 'over' : state
  return { setNodeRef, dropState, dropClass: DROP_STATE_CLASS[dropState] }
}

// 경로(breadcrumb)의 루트·상위 폴더 버튼 — 클릭은 그 폴더로 이동, 드래그 중에는 드롭 대상(folderId=null 이면 루트).
// 루트가 곧 현재 폴더면(루트에서 끌 때) 놓을 수 없어 흐림으로 보인다.
export function DriveCrumbDropButton({
  folderId,
  name,
  className,
  ...props
}: ComponentProps<'button'> & { folderId: number | null; name: string }) {
  const { setNodeRef, dropState, dropClass } = useFolderDroppable(driveDropId('crumb', folderId), { folderId, name })
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...props}
      data-drop-state={dropState === 'idle' ? undefined : dropState}
      className={cn(className, dropClass)}
    />
  )
}

// 경로의 현재 폴더(마지막 세그먼트) — 드롭 대상이 아니고, 드래그 중에는 놓을 수 없음을 흐림으로 알린다.
export function DriveCrumbCurrent({ className, ...props }: ComponentProps<'span'>) {
  const dragging = useContext(DriveDndCtx).active != null
  return <span {...props} className={cn(className, dragging && DROP_TARGET_CLASS.dimmed)} />
}

// 목록 행 — 드래그 소스, 폴더 행이면 드롭 대상도 겸한다. item 이 없으면(검색 결과 등) 평범한 행.
// 활성화 노드=행 자신 — 지정하지 않으면 KeyboardSensor 가 행 안 버튼의 Space 까지 받아 드래그를 시작한다(IssueListRow 와 동일).
// eslint-disable-next-line react-refresh/only-export-components -- 행 훅을 provider·context 와 한 파일에 두는 것이 응집상 낫다(IssueDndProvider 와 동일)
export function useDriveRowDnd(item: DriveDragItem | undefined) {
  const { enabled, active } = useContext(DriveDndCtx)
  const fallbackId = useId()
  const canDrag = enabled && item != null
  const { setNodeRef: setDragRef, setActivatorNodeRef, attributes, listeners } = useDraggable({
    id: item ? driveDragId(item) : `drive-drag-none-${fallbackId}`,
    data: item ? ({ lead: item } satisfies DriveDragData) : undefined,
    disabled: !canDrag,
    // dnd-kit 기본 role=button 은 목록 의미를 깨뜨린다 — 목록 항목 역할 유지.
    attributes: { role: 'listitem', roleDescription: '드래그 가능한 항목' },
  })
  const folderTarget = item?.kind === 'folder' ? { folderId: item.id, name: item.name } : null
  // 파일 행·item 없는 행은 대상이 아니다 — 훅은 늘 호출해야 하므로 겹치지 않는 id 로 비활성 droppable 을 둔다.
  const drop = useFolderDroppable(
    folderTarget ? driveDropId('row', folderTarget.folderId) : `drive-drop-none-${fallbackId}`,
    folderTarget,
  )
  const setDropRef = drop.setNodeRef
  const setNodeRef = useCallback(
    (el: HTMLLIElement | null) => {
      setDragRef(el)
      setActivatorNodeRef(el)
      setDropRef(el)
    },
    [setDragRef, setActivatorNodeRef, setDropRef],
  )
  // 비활성이면 dnd-kit 의 role·tabIndex·리스너를 붙이지 않는다(평범한 <li>).
  const props = canDrag ? { ...attributes, ...listeners } : {}
  const dragged = item != null && isDragged(active, item)
  return {
    setNodeRef,
    props,
    // 끄는 원본(선택 묶음 전체)은 흐리게, 폴더 대상은 드롭 상태 표시. 끌리는 폴더는 대상이 아니므로 흐림만.
    // 드래그 가능한 행은 키보드 포커스(Space 로 집기)를 받으므로 포커스 링을 보인다(IssueListRow 와 동일).
    className: cn(
      canDrag && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
      dragged ? 'opacity-40' : drop.dropClass,
    ),
    dropState: drop.dropState,
  }
}
