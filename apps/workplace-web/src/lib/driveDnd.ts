// 드라이브 끌어 옮기기(WP-364) 순수 규칙 — 이슈 목록 행 → 에픽 패널 DnD(epicDnd)와 같은 패턴.
// 행(파일·폴더)을 끌어 목록의 폴더 행·경로(breadcrumb)의 상위 폴더/루트에 놓으면 bulkMove 로 옮긴다.
// 서버(DriveBulkService.bulkMove)가 같은 공간·자기/하위 폴더·이름 충돌을 검증하고 하나라도 실패하면 전체 롤백하므로,
// UI 는 「놓아도 변화가 없거나 확실히 거부될」 대상만 미리 막는다.
import {
  type Announcements,
  type CollisionDetection,
  type DroppableContainer,
  type KeyboardCoordinateGetter,
  pointerWithin,
} from '@dnd-kit/core'

import { euroRo } from './utils'

// 끄는 항목 하나 — 이름은 칩·안내 문구용.
export type DriveDragItem = { kind: 'file' | 'folder'; id: number; name: string }

// 진행 중인 드래그 — 실제로 옮길 항목 전체. 맨 앞이 잡은 항목(칩·안내에 이름이 나오는 항목).
// 드래그 소스(행)는 잡은 항목(DriveDragItem)만 싣고, 묶음(선택 포함)은 드래그 시작 시 provider 가 계산한다.
export type DriveActiveDrag = DriveDragItem[]

// 목록 항목(폴더·파일) → 끄는 항목.
export function driveDragItem(kind: DriveDragItem['kind'], entry: { id: number; name: string }): DriveDragItem {
  return { kind, id: entry.id, name: entry.name }
}

// 드롭 대상 데이터 — folderId=null 이면 공간 루트. name 은 토스트·안내 문구용.
export type DriveDropData = { folderId: number | null; name: string }

// 드롭 대상 상태 — idle(드래그 아님)·allowed(놓을 수 있음)·blocked(현재 폴더·끌고 있는 폴더라 놓을 수 없음).
export type DriveDropState = 'idle' | 'allowed' | 'blocked'

// 드래그 소스 id — 파일과 폴더 id 공간이 달라 종류를 붙인다.
export const driveDragId = (item: Pick<DriveDragItem, 'kind' | 'id'>) => `drive-drag-${item.kind}-${item.id}`

// 드롭 대상 id — 폴더 행과 경로의 같은 폴더가 한 화면에 함께 나오지 않지만(행=현재 폴더의 자식, 경로=조상),
// 출처를 구분해 두어 키보드 순서·디버깅이 명확하다.
export const driveDropId = (source: 'row' | 'crumb', folderId: number | null) =>
  `drive-drop-${source}-${folderId ?? 'root'}`

// 같은 항목인지(종류+id).
const sameItem = (a: Pick<DriveDragItem, 'kind' | 'id'>, b: Pick<DriveDragItem, 'kind' | 'id'>) =>
  a.kind === b.kind && a.id === b.id

// 옮길 항목 묶음 — 잡은 행이 선택돼 있으면 선택 전체(잡은 항목이 맨 앞), 아니면 잡은 항목 하나.
// selected 는 현재 보이는 선택(visibleSel*)을 이름과 함께 넘긴다.
export function dragItemsFor(lead: DriveDragItem, selected: DriveDragItem[]): DriveDragItem[] {
  if (!selected.some((s) => sameItem(s, lead))) return [lead]
  return [lead, ...selected.filter((s) => !sameItem(s, lead))]
}

// 끌고 있는 항목인지 — 원본 행을 흐리게(opacity-40) 그릴 때 쓴다.
export function isDragged(active: DriveActiveDrag | null, item: Pick<DriveDragItem, 'kind' | 'id'>): boolean {
  return active != null && active.some((i) => sameItem(i, item))
}

// 한 대상(폴더 id, null=루트)의 드롭 상태.
// - 현재 폴더: 모든 항목이 이미 여기 있어 놓아도 변화가 없다.
// - 끌고 있는 폴더: 자기 자신 안으로는 옮길 수 없다(서버도 거부).
export function driveDropState(
  active: DriveActiveDrag | null,
  targetFolderId: number | null,
  currentFolderId: number | null,
): DriveDropState {
  if (!active) return 'idle'
  if (targetFolderId === currentFolderId) return 'blocked'
  if (targetFolderId != null && active.some((i) => i.kind === 'folder' && i.id === targetFolderId)) return 'blocked'
  return 'allowed'
}

// 칩·안내용 항목 이름 — 「a.pdf」 또는 「a.pdf」 외 2개.
export function dragLabel(active: DriveActiveDrag): string {
  const rest = active.length - 1
  return rest > 0 ? `「${active[0].name}」 외 ${rest}개` : `「${active[0].name}」`
}

// 이동 완료 토스트 — 에픽 연결 토스트(「…」에 연결했습니다)와 같은 결. 예: 3개 항목을 「드라이브」로 옮겼습니다.
export function moveToastMessage(count: number, targetName: string): string {
  return `${count}개 항목을 「${targetName}」${euroRo(targetName)} 옮겼습니다`
}

// over.data 가 드라이브 드롭 대상인지.
export function isDriveDropData(d: unknown): d is DriveDropData {
  return typeof d === 'object' && d != null && 'folderId' in d && 'name' in d
}

// 충돌 판정.
// - 포인터: pointerWithin(포인터 밑 대상만) — 행과 행 사이·빈 곳에 놓으면 아무 일도 없다.
// - 키보드(포인터 좌표 없음): 방향키로 고른 대상(좌상단이 정확히 겹침)만. 가장 가까운 대상으로 폴백하면
//   Space 로 집은 직후 바로 옆 폴더 행이 over 가 되어 방향키 없이 Space 를 다시 누르면 옮겨진다(epicDnd #881 과 같은 이유).
export const driveCollision: CollisionDetection = (args) => {
  if (args.pointerCoordinates) return pointerWithin(args)
  const r0 = args.collisionRect
  const exact = args.droppableContainers.find((c) => {
    const r = args.droppableRects.get(c.id)
    return r != null && Math.abs(r.left - r0.left) < 1 && Math.abs(r.top - r0.top) < 1
  })
  return exact ? [{ id: exact.id, data: { droppableContainer: exact, value: 0 } }] : []
}

// 키보드로 고른 대상을 센서가 받아들이는 자리에 드러낸다.
// 왜: KeyboardSensor 는 새 좌표가 스크롤 컨테이너(over 노드 — 없으면 끄는 행 — 의 스크롤 조상) 중앙을 진행 방향으로 넘으면
//     대상으로 옮기지 않고 컨테이너만 굴린다(↓ 는 [위, 중앙], ↑ 는 [중앙, 아래] 안이어야 이동). epicDnd.revealTarget 과 같은 이유.
// - 대상을 품은 컨테이너: 대상 top 이 범위 밖이면 중앙 바로 위(↓)/아래(↑)로 굴린다. 끝에 닿아 못 굴리면 센서도 굴리지 않는다.
// - 대상을 품지 않은 컨테이너(목록 행 → 경로로 ↑): 목록을 맨 위로 올려 센서가 더 굴릴 수 없게 한다.
//   (경로가 목록보다 위라 ↓ 로 목록 밖 대상에 가는 경우는 없다 — 아래 driveKeyboardCoordinates 순서 참고.)
// - 센서가 보지 않는 컨테이너 안 대상(경로 → 목록 행 ↓): 보이게만 한다(scrollIntoView nearest).
function revealForSensor(node: HTMLElement, ancestors: Element[], down: boolean) {
  for (const box of ancestors) {
    if (!box.contains(node) && !down) box.scrollTop = 0
  }
  const own = ancestors.find((box) => box.contains(node))
  if (!own) {
    node.scrollIntoView?.({ block: 'nearest' })
    return
  }
  const c = own.getBoundingClientRect()
  const n = node.getBoundingClientRect()
  const mid = c.top + c.height / 2
  const outside = down ? n.top < c.top || n.top > mid : n.top < mid || n.bottom > c.bottom
  if (outside) own.scrollTop += n.top - (down ? mid - 2 : mid + 2)
}

// 경로(breadcrumb) 드롭 대상인지 — 키보드 시작 위치 결정용.
const isCrumbTarget = (id: unknown) => String(id).startsWith('drive-drop-crumb-')

// 키보드 좌표 — 방향키로 활성 대상 사이를 화면 순서(위→아래, 같은 줄은 왼쪽→오른쪽)로 오간다.
// 경로(위 한 줄)가 먼저, 목록 폴더 행이 그 아래. ←/↑ 는 이전, →/↓ 는 다음. 반환값은 고른 대상의 좌상단(드러낸 뒤 다시 잰 값 —
// droppableRects 는 스크롤 전 측정값).
// 아직 고른 대상이 없으면 ↓/→ 는 첫 폴더 행(없으면 첫 대상), ↑/← 는 가장 가까운 상위 경로(마지막 경로, 없으면 마지막 대상) —
// 끄는 행은 목록 안이라, 첫 ↓ 가 목록 위 경로로 가면 센서가 목록을 굴려 버린다.
export const driveKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { droppableContainers, droppableRects, over, scrollableAncestors } = args.context
  const next = event.code === 'ArrowDown' || event.code === 'ArrowRight'
  const prev = event.code === 'ArrowUp' || event.code === 'ArrowLeft'
  if (!next && !prev) return undefined
  event.preventDefault()
  const targets = droppableContainers
    .getEnabled()
    .map((c) => ({ container: c, rect: droppableRects.get(c.id) }))
    .filter((t): t is { container: DroppableContainer; rect: NonNullable<typeof t.rect> } => t.rect != null)
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
  if (targets.length === 0) return undefined
  const i = targets.findIndex((t) => t.container.id === over?.id)
  let target: (typeof targets)[number]
  if (i >= 0) {
    target = targets[Math.min(targets.length - 1, Math.max(0, i + (next ? 1 : -1)))]
  } else if (next) {
    target = targets.find((t) => !isCrumbTarget(t.container.id)) ?? targets[0]
  } else {
    const crumbs = targets.filter((t) => isCrumbTarget(t.container.id))
    target = crumbs[crumbs.length - 1] ?? targets[targets.length - 1]
  }
  const node = target.container.node.current
  if (!node) return { x: target.rect.left, y: target.rect.top }
  revealForSensor(node, scrollableAncestors, next)
  const r = node.getBoundingClientRect()
  return { x: r.left, y: r.top }
}

// 드롭 대상 한국어 이름 — 스크린리더 안내용(원시 id 는 읽지 않는다).
function describeTarget(data: unknown): string | null {
  if (!isDriveDropData(data)) return null
  return data.folderId == null ? `「${data.name}」 최상위` : `「${data.name}」 폴더`
}

// DndContext 안내 문구 — 기본값은 영어 + 원시 id 를 읽으므로 항목·폴더 이름으로 바꾼다.
// current: provider 의 진행 중 드래그(묶음 개수 포함). 집는 순간에는 아직 상태가 반영되기 전이라 active.data(잡은 항목)로 읽는다.
export function driveDndAnnouncements(current: DriveActiveDrag | null): Announcements {
  const label = (a: { data: { current?: unknown } }) => {
    if (current) return `${dragLabel(current)} 항목`
    const lead = a.data.current as DriveDragItem | undefined
    return lead ? `「${lead.name}」 항목` : '항목'
  }
  return {
    onDragStart: ({ active }) => `${label(active)}을 집었습니다.`,
    onDragOver: ({ active, over }) => {
      const target = describeTarget(over?.data.current)
      return target ? `${label(active)}이 ${target} 위에 있습니다.` : `${label(active)}이 놓을 대상 밖에 있습니다.`
    },
    onDragEnd: ({ active, over }) => {
      const target = describeTarget(over?.data.current)
      return target ? `${label(active)}을 ${target}에 놓았습니다.` : `${label(active)}을 놓았습니다. 변경 사항이 없습니다.`
    },
    onDragCancel: ({ active }) => `${label(active)} 이동을 취소했습니다.`,
  }
}

// 드래그 가능 행의 스크린리더 사용법 안내(aria-describedby).
export const DRIVE_DND_SCREEN_READER_INSTRUCTIONS = {
  draggable: 'Space 키로 항목을 집고, 방향키로 옮길 폴더를 고른 뒤 Space 키로 놓으세요. Esc 키를 누르면 취소됩니다.',
}
