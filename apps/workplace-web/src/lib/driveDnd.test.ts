// @vitest-environment jsdom
// 드라이브 끌어 옮기기(WP-364) 순수 규칙 테스트 — 옮길 묶음·드롭 상태·라벨/토스트 문구·충돌 판정·키보드 좌표·스크린리더 안내.
// (키보드 좌표가 DOM 노드 사각형·스크롤을 다루므로 jsdom 환경)
import type { ClientRect, DroppableContainer, UniqueIdentifier } from '@dnd-kit/core'
import { describe, expect, it } from 'vitest'

import {
  dragItemsFor,
  dragLabel,
  type DriveActiveDrag,
  driveCollision,
  driveDndAnnouncements,
  type DriveDragItem,
  driveDropId,
  driveDropState,
  driveKeyboardCoordinates,
  isDragged,
  isDriveDropData,
  moveToastMessage,
} from './driveDnd'

const file = (id: number, name = `f${id}.txt`): DriveDragItem => ({ kind: 'file', id, name })
const folder = (id: number, name = `d${id}`): DriveDragItem => ({ kind: 'folder', id, name })
const drag = (...items: DriveDragItem[]): DriveActiveDrag => items

describe('dragItemsFor', () => {
  it('선택 밖 행을 끌면 그 항목 하나만', () => {
    expect(dragItemsFor(file(1), [file(2), folder(3)])).toEqual([file(1)])
  })
  it('선택된 행을 끌면 선택 전체 — 잡은 항목이 맨 앞', () => {
    expect(dragItemsFor(file(2), [folder(3), file(2), file(4)])).toEqual([file(2), folder(3), file(4)])
  })
  it('파일과 폴더는 id 가 같아도 다른 항목', () => {
    expect(dragItemsFor(file(3), [folder(3)])).toEqual([file(3)])
  })
})

describe('isDragged', () => {
  it('묶음에 든 항목만 끌리는 중', () => {
    const a = drag(file(1), folder(2))
    expect(isDragged(a, folder(2))).toBe(true)
    expect(isDragged(a, file(2))).toBe(false)
    expect(isDragged(null, file(1))).toBe(false)
  })
})

describe('driveDropState', () => {
  it('드래그가 없으면 idle', () => {
    expect(driveDropState(null, 5, null)).toBe('idle')
  })
  it('다른 폴더·루트는 놓을 수 있음', () => {
    expect(driveDropState(drag(file(1)), 5, 9)).toBe('allowed')
    expect(driveDropState(drag(file(1)), null, 9)).toBe('allowed')
  })
  it('현재 폴더(루트 포함)는 변화가 없어 놓을 수 없음', () => {
    expect(driveDropState(drag(file(1)), 9, 9)).toBe('blocked')
    expect(driveDropState(drag(file(1)), null, null)).toBe('blocked')
  })
  it('끌고 있는 폴더(선택 묶음 포함) 안으로는 놓을 수 없음', () => {
    expect(driveDropState(drag(folder(5)), 5, null)).toBe('blocked')
    expect(driveDropState(drag(file(1), folder(5)), 5, null)).toBe('blocked')
    // 같은 id 의 파일을 끈다고 폴더 5 가 막히지는 않는다.
    expect(driveDropState(drag(file(5)), 5, null)).toBe('allowed')
  })
})

describe('라벨·토스트 문구', () => {
  it('하나면 이름만, 여럿이면 「외 N개」', () => {
    expect(dragLabel(drag(file(1, 'a.pdf')))).toBe('「a.pdf」')
    expect(dragLabel(drag(file(1, 'a.pdf'), file(2), folder(3)))).toBe('「a.pdf」 외 2개')
  })
  it('이동 토스트는 받침에 맞춰 (으)로', () => {
    expect(moveToastMessage(3, '드라이브')).toBe('3개 항목을 「드라이브」로 옮겼습니다')
    expect(moveToastMessage(1, '회의록')).toBe('1개 항목을 「회의록」으로 옮겼습니다')
    // ㄹ 받침은 「로」.
    expect(moveToastMessage(2, '자료실')).toBe('2개 항목을 「자료실」로 옮겼습니다')
  })
  it('isDriveDropData 는 folderId·name 이 있는 대상만', () => {
    expect(isDriveDropData({ folderId: null, name: '드라이브' })).toBe(true)
    expect(isDriveDropData({ epic: null })).toBe(false)
    expect(isDriveDropData(undefined)).toBe(false)
  })
})

// ── 충돌 판정·키보드 좌표 픽스처 ─────────────────────────────────────
const rect = (left: number, top: number, width: number, height: number): ClientRect => ({
  left, top, width, height, right: left + width, bottom: top + height,
})
// DroppableContainer 최소 모양 — node 는 사각형을 가짜로 박은 실제 DOM 요소(parent 에 붙이면 스크롤 컨테이너 안).
function drop(id: string, r: ClientRect, parent?: HTMLElement): DroppableContainer {
  const node = document.createElement('div')
  node.getBoundingClientRect = () => {
    // 부모 스크롤만큼 위로 이동한 사각형(실제 레이아웃 흉내).
    const dy = parent ? parent.scrollTop : 0
    return { ...r, top: r.top - dy, bottom: r.bottom - dy, x: r.left, y: r.top - dy, toJSON: () => ({}) } as DOMRect
  }
  parent?.appendChild(node)
  return { id, key: id, data: { current: {} }, disabled: false, node: { current: node }, rect: { current: r } } as never
}
// 스크롤 컨테이너 — 보이는 영역 r, scrollTop 은 대입한 값 그대로(jsdom 은 레이아웃이 없어 클램프하지 않음).
function scroller(r: ClientRect) {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => r as DOMRect
  return el
}
const containersMap = (cs: DroppableContainer[]) => {
  const m = new Map(cs.map((c) => [c.id, c]))
  return { getEnabled: () => cs, get: (id: UniqueIdentifier) => m.get(id) } as never
}
function keyboard(code: string, cs: DroppableContainer[], overId: string | null, ancestors: Element[] = []) {
  return driveKeyboardCoordinates(new KeyboardEvent('keydown', { code }), {
    active: 'drive-drag-file-1',
    currentCoordinates: { x: 0, y: 0 },
    context: {
      droppableRects: new Map(cs.map((c) => [c.id, c.rect.current!])),
      droppableContainers: containersMap(cs),
      over: overId ? { id: overId } : null,
      scrollableAncestors: ancestors,
    },
  } as never)
}

describe('driveCollision', () => {
  const a = drop(driveDropId('row', 1), rect(0, 100, 400, 40))
  const b = drop(driveDropId('row', 2), rect(0, 140, 400, 40))
  const collide = (pointer: { x: number; y: number } | null, collisionRect = rect(0, 0, 10, 10)) =>
    driveCollision({
      active: { id: 'x', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      collisionRect,
      droppableRects: new Map([[a.id, a.rect.current!], [b.id, b.rect.current!]]),
      droppableContainers: [a, b],
      pointerCoordinates: pointer,
    } as never).map((c) => c.id)

  it('포인터 밑 대상만', () => {
    expect(collide({ x: 50, y: 150 })).toEqual([b.id])
    expect(collide({ x: 50, y: 300 })).toEqual([])
  })
  it('키보드는 좌상단이 정확히 겹치는(방향키로 고른) 대상만 — 가까운 대상으로 폴백하지 않는다', () => {
    expect(collide(null, rect(0, 100, 10, 10))).toEqual([a.id])
    expect(collide(null, rect(0, 110, 10, 10))).toEqual([])
  })
})

describe('driveKeyboardCoordinates', () => {
  const root = drop(driveDropId('crumb', null), rect(20, 10, 60, 30))
  const docs = drop(driveDropId('crumb', 7), rect(100, 10, 60, 30))

  it('방향키가 아니면 무시', () => {
    expect(keyboard('KeyA', [root, docs], null)).toBeUndefined()
  })
  it('처음 ↓ 는 첫 폴더 행, 처음 ↑ 는 가장 가까운 상위 경로', () => {
    const row = drop(driveDropId('row', 1), rect(0, 100, 400, 40))
    expect(keyboard('ArrowDown', [root, docs, row], null)).toEqual({ x: 0, y: 100 })
    expect(keyboard('ArrowUp', [root, docs, row], null)).toEqual({ x: 100, y: 10 })
  })
  it('고른 대상에서 화면 순서(위→아래, 왼쪽→오른쪽)로 오가고 끝에서 멈춘다', () => {
    const row = drop(driveDropId('row', 1), rect(0, 100, 400, 40))
    expect(keyboard('ArrowRight', [row, docs, root], driveDropId('crumb', null))).toEqual({ x: 100, y: 10 })
    expect(keyboard('ArrowDown', [row, docs, root], driveDropId('crumb', 7))).toEqual({ x: 0, y: 100 })
    expect(keyboard('ArrowDown', [row, docs, root], driveDropId('row', 1))).toEqual({ x: 0, y: 100 })
  })
  it('↓ 로 고른 폴더 행이 목록 중앙 아래면 중앙 바로 위로 굴린다 — 센서가 이동 대신 목록을 굴리지 않게', () => {
    // 목록 보이는 영역 y 100~500(중앙 300). 행 top 420 → 298 이 되도록 122 굴림.
    const list = scroller(rect(0, 100, 400, 400))
    const r1 = drop(driveDropId('row', 1), rect(0, 100, 400, 40), list)
    const r2 = drop(driveDropId('row', 2), rect(0, 420, 400, 40), list)
    expect(keyboard('ArrowDown', [r1, r2], driveDropId('row', 1), [list])).toEqual({ x: 0, y: 298 })
    expect(list.scrollTop).toBe(122)
  })
  it('↑ 로 목록 위 경로에 갈 때는 목록을 맨 위로 올린다', () => {
    const list = scroller(rect(0, 100, 400, 400))
    list.scrollTop = 250
    const r1 = drop(driveDropId('row', 1), rect(0, 350, 400, 40), list)
    expect(keyboard('ArrowUp', [docs, r1], driveDropId('row', 1), [list])).toEqual({ x: 100, y: 10 })
    expect(list.scrollTop).toBe(0)
  })
})

describe('driveDndAnnouncements', () => {
  const activeArg = { id: 'drive-drag-file-1', data: { current: file(1, 'a.pdf') } } as never
  const over = (data: unknown) => ({ id: 'o', data: { current: data } }) as never

  it('집는 순간에는 잡은 항목 이름으로 읽는다', () => {
    expect(driveDndAnnouncements(null).onDragStart({ active: activeArg })).toBe('「a.pdf」 항목을 집었습니다.')
  })
  it('묶음·폴더 이름으로 읽고 원시 id 는 읽지 않는다', () => {
    const ann = driveDndAnnouncements(drag(file(1, 'a.pdf'), file(2)))
    expect(ann.onDragOver({ active: activeArg, over: over({ folderId: 5, name: '회의록' }) })).toBe(
      '「a.pdf」 외 1개 항목이 「회의록」 폴더 위에 있습니다.',
    )
    expect(ann.onDragEnd({ active: activeArg, over: over({ folderId: null, name: '드라이브' }) })).toBe(
      '「a.pdf」 외 1개 항목을 「드라이브」 최상위에 놓았습니다.',
    )
    expect(ann.onDragEnd({ active: activeArg, over: null })).toBe('「a.pdf」 외 1개 항목을 놓았습니다. 변경 사항이 없습니다.')
    expect(ann.onDragCancel!({ active: activeArg, over: null })).toBe('「a.pdf」 외 1개 항목 이동을 취소했습니다.')
  })
})
