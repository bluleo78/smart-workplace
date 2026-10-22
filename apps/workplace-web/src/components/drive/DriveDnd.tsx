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
import { type ComponentProps, createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { DROP_TARGET_CLASS } from '@/lib/dndDropClass'
import { chipBesidePointer } from '@/lib/dndRowChip'
import {
  DRIVE_DND_SCREEN_READER_INSTRUCTIONS,
  type DriveActiveDrag,
  driveCollision,
  driveDndAnnouncements,
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

// 렌더마다 새 배열·옵션 객체를 만들지 않도록 모듈 상수로 둔다(useSensor 메모가 옵션 참조로 갈린다).
const CHIP_MODIFIERS = [chipBesidePointer]
// PointerSensor distance:5 — 짧은 클릭은 이름 버튼(폴더 열기·미리보기)으로 남긴다.
const POINTER_OPTIONS = { activationConstraint: { distance: 5 } }
// 키보드 시작은 Space 만 — Enter 는 행 안 버튼의 기본 동작으로 남긴다(IssueDndProvider 와 동일).
const KEYBOARD_OPTIONS = {
  coordinateGetter: driveKeyboardCoordinates,
  keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
}

type DriveDndState = {
  // 끌어 옮기기 사용 가능 여부 — 데스크톱(마우스)·쓰기 가능한 공간에서만(페이지가 결정).
  enabled: boolean
  // 진행 중인 드래그(없으면 null).
  active: DriveActiveDrag | null
  // 지금 보고 있는 폴더(null=루트) — 여기로는 놓아도 변화가 없다.
  currentFolderId: number | null
}

// 놓은 대상 요소(data-drop-id)에 포커스.
function focusDropTarget(id: string) {
  document.querySelector<HTMLElement>(`[data-drop-id="${id}"]`)?.focus()
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
  const sensors = useSensors(useSensor(PointerSensor, POINTER_OPTIONS), useSensor(KeyboardSensor, KEYBOARD_OPTIONS))
  // 스크린리더 안내 — 항목·폴더 이름(한국어), 원시 id 는 읽지 않는다.
  // dnd-kit 포커스 복원은 끈다 — 끈 행에 포커스를 되돌리는데, 옮긴 행은 곧 목록에서 빠져 포커스가 body 로 사라졌다(WP-840).
  // 키보드로 끄는 동안 포커스는 행을 떠나지 않으므로 취소·제자리 놓기는 그대로 행에 남고, 옮겼을 때는 handleDragEnd 가 대상으로 옮긴다.
  const accessibility = useMemo(
    () => ({
      announcements: driveDndAnnouncements(active),
      screenReaderInstructions: DRIVE_DND_SCREEN_READER_INSTRUCTIONS,
      restoreFocus: false,
    }),
    [active],
  )

  // 키보드로 놓은 대상 — 이동 처리 중에는 페이지가 끌기를 꺼(enabled=false) 행의 tabindex 가 빠지며 포커스가 body 로 떨어지므로,
  // 다시 켜졌을 때 포커스를 잃은 채면 한 번 더 옮긴다. 다음 끌기를 시작하면 잊는다.
  const pendingFocus = useRef<string | null>(null)
  useEffect(() => {
    const id = pendingFocus.current
    if (!enabled || id == null) return
    pendingFocus.current = null
    const el = document.activeElement
    if (el === null || el === document.body || !el.isConnected) focusDropTarget(id)
  }, [enabled])

  function handleDragStart(e: DragStartEvent) {
    pendingFocus.current = null
    const lead = e.active.data.current as DriveDragItem | undefined
    if (lead) setActive(resolveItems(lead))
  }

  function handleDragEnd(e: DragEndEvent) {
    const drag = active
    setActive(null)
    const dst = e.over?.data.current
    if (!drag || !isDriveDropData(dst)) return
    // 비허용 대상은 droppable 이 disabled 라 over 가 되지 않지만, 규칙을 한 번 더 확인해 방어한다.
    if (driveDropState(drag, dst.folderId, currentFolderId) !== 'allowed') return
    onMove(drag, dst)
    // 키보드로 옮겼으면 놓은 대상(폴더 행·경로 버튼)으로 포커스를 옮긴다 — 옮긴 행은 목록에서 빠지므로, 키보드 사용자가 화면
    // 처음부터 다시 Tab 하지 않고 옮긴 곳에서 이어서 조작할 수 있게.
    if (e.over && e.activatorEvent instanceof KeyboardEvent) {
      const id = String(e.over.id)
      pendingFocus.current = id
      focusDropTarget(id)
    }
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
        {/* 칩은 포인터 오른쪽 아래에 띄운다 — 경로처럼 작은 대상 위에서도 「여기에 놓임」 강조가 가려지지 않게. */}
        <DragOverlay dropAnimation={null} modifiers={CHIP_MODIFIERS}>
          {active ? <DriveDragChip active={active} /> : null}
        </DragOverlay>
      </DndContext>
    </DriveDndCtx.Provider>
  )
}

// 드래그 고스트 — 잡은 항목 아이콘·이름, 여러 개면 「외 N개」. 배경은 bg-popover(솔리드) — 다크의 --card 는 3% 알파라 아래 글자가 비친다.
function DriveDragChip({ active }: { active: DriveActiveDrag }) {
  const [lead] = active
  const Icon = lead.kind === 'folder' ? Folder : FileText
  const rest = active.length - 1
  return (
    <div
      className="flex max-w-80 cursor-grabbing items-center gap-1.5 rounded-md border bg-popover px-3 py-1.5 text-sm shadow-xl ring-2 ring-primary/40"
      data-testid="drive-drag-overlay"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate">{lead.name}</span>
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

// 폴더 드롭 대상 공통(폴더 행·경로) — 허용 상태일 때만 활성(비허용은 over 가 되지 않아 놓아도 무시).
function useFolderDroppable(id: string, target: DriveDropData) {
  const { enabled, active, currentFolderId } = useContext(DriveDndCtx)
  const state: DriveDropState = enabled ? driveDropState(active, target.folderId, currentFolderId) : 'idle'
  const { setNodeRef, isOver } = useDroppable({ id, data: target, disabled: state !== 'allowed' })
  const dropState: DriveDropState | 'over' = state === 'allowed' && isOver ? 'over' : state
  // dropId: 요소에 data-drop-id 로 달아 키보드로 놓은 뒤 포커스를 옮길 대상을 찾는다.
  return { setNodeRef, dropState, dropClass: DROP_STATE_CLASS[dropState], dropId: id }
}

// data-drop-state 속성값 — 드래그가 없으면 생략.
const dropStateAttr = (state: DriveDropState | 'over') => (state === 'idle' ? undefined : state)

// 경로(breadcrumb)의 루트·상위 폴더 버튼 — 클릭은 그 폴더로 이동, 드래그 중에는 드롭 대상(folderId=null 이면 루트).
// 루트가 곧 현재 폴더면(루트에서 끌 때) 놓을 수 없어 흐림으로 보인다.
export function DriveCrumbDropButton({
  folderId,
  name,
  className,
  ...props
}: ComponentProps<'button'> & { folderId: number | null; name: string }) {
  const { setNodeRef, dropState, dropClass, dropId } = useFolderDroppable(driveDropId('crumb', folderId), { folderId, name })
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...props}
      data-drop-id={dropId}
      data-drop-state={dropStateAttr(dropState)}
      // 드롭 표시 외곽선이 글자에 붙지 않게 좌우 여유를 두되, 음수 여백으로 상쇄해 경로 배치는 그대로 둔다.
      className={cn('-mx-1 rounded-sm px-1', className, dropClass)}
    />
  )
}

// 경로의 현재 폴더(마지막 세그먼트) — 드롭 대상이 아니고, 드래그 중에는 놓을 수 없음을 흐림으로 알린다.
export function DriveCrumbCurrent({ className, ...props }: ComponentProps<'span'>) {
  const dragging = useContext(DriveDndCtx).active != null
  return <span {...props} className={cn(className, dragging && DROP_TARGET_CLASS.dimmed)} />
}

// 행 드래그 소스 공통 — 활성화 노드=행 자신. 지정하지 않으면 KeyboardSensor 가 행 안 버튼의 Space 까지 받아
// 드래그를 시작한다(IssueListRow 와 동일).
function useRowDrag(item: DriveDragItem) {
  const { enabled, active } = useContext(DriveDndCtx)
  const { setNodeRef, setActivatorNodeRef, attributes, listeners } = useDraggable({
    id: driveDragId(item),
    data: item,
    disabled: !enabled,
    // dnd-kit 기본 role=button 은 목록 의미를 깨뜨린다 — 목록 항목 역할 유지.
    attributes: { role: 'listitem', roleDescription: '드래그 가능한 항목' },
  })
  const setRowRef = useCallback(
    (el: HTMLLIElement | null) => {
      setNodeRef(el)
      setActivatorNodeRef(el)
    },
    [setNodeRef, setActivatorNodeRef],
  )
  const dragged = isDragged(active, item)
  return {
    setRowRef,
    // 비활성이면 dnd-kit 의 role·tabIndex·리스너를 붙이지 않는다(평범한 <li>).
    dragProps: enabled ? { ...attributes, ...listeners } : {},
    dragged,
    // 끄는 원본(선택 묶음 전체)은 흐리게. 드래그 가능한 행은 키보드 포커스(Space 로 집기)를 받으므로 포커스 링을 보인다.
    // 드래그 중에는 행이 포인터를 받지 않게 해 호버 액션·밑줄이 대상 강조를 어지럽히지 않게 한다(드롭 판정은 사각형 기준이라 무관).
    dragClass: cn(
      enabled && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
      active != null && 'pointer-events-none',
      dragged && 'opacity-40',
    ),
  }
}

type DragRowProps = ComponentProps<'li'> & { item: DriveDragItem }

// 파일 행 — 드래그 소스만(드롭 대상 아님).
export function DriveFileDragRow({ item, className, ...props }: DragRowProps) {
  const { setRowRef, dragProps, dragClass } = useRowDrag(item)
  return <li ref={setRowRef} {...props} {...dragProps} className={cn(className, dragClass)} />
}

// 폴더 행 — 드래그 소스이자 드롭 대상. 끌리는 폴더는 대상이 아니므로 흐림만 보인다.
export function DriveFolderDragRow({ item, className, ...props }: DragRowProps) {
  const { setRowRef, dragProps, dragged, dragClass } = useRowDrag(item)
  const { setNodeRef: setDropRef, dropState, dropClass, dropId } = useFolderDroppable(driveDropId('row', item.id), {
    folderId: item.id,
    name: item.name,
  })
  const setRef = useCallback(
    (el: HTMLLIElement | null) => {
      setRowRef(el)
      setDropRef(el)
    },
    [setRowRef, setDropRef],
  )
  return (
    <li
      ref={setRef}
      {...props}
      {...dragProps}
      data-drop-id={dropId}
      data-drop-state={dropStateAttr(dropState)}
      className={cn(className, dragClass, !dragged && dropClass)}
    />
  )
}
