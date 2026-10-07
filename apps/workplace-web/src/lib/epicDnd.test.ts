// @vitest-environment jsdom
// 에픽 DnD 순수 규칙 테스트 — 차단 사유·대상별 드롭 상태·드롭 데이터 판별·충돌 판정·키보드 좌표·스크린리더 안내.
// (sortableKeyboardCoordinates 가 대상 노드의 스크롤 조상을 계산하므로 jsdom 환경)
import type { ClientRect, CollisionDescriptor, DroppableContainer, UniqueIdentifier } from '@dnd-kit/core';
import { describe, expect, it } from 'vitest';

import type { IssueResponse } from '../types/issue';
import {
  describeDropTarget,
  epicDragBlockReason,
  epicDropState,
  isCycleDropData,
  isEpicDropData,
  issueCollision,
  issueDndAnnouncements,
  issueKeyboardCoordinates,
  snapRowChipToPointer,
} from './epicDnd';

// 필수 필드가 많은 IssueResponse 를 최소 오버라이드로 생성하는 테스트 팩토리.
function mk(over: Partial<IssueResponse>): IssueResponse {
  return {
    id: 0,
    projectKey: 'P',
    number: 0,
    title: 't',
    status: 'TODO',
    priority: 'MID',
    dueDate: null,
    startDate: null,
    milestoneId: null,
    reporterId: 1,
    createdAt: '',
    updatedAt: '',
    labels: [],
    attachmentCount: 0,
    type: null,
    assignees: [],
    parent: null,
    childCount: 0,
    childDoneCount: 0,
    blockedBy: [],
    blocks: [],
    blocked: false,
    customFields: [],
    ...over,
  };
}

const t = (name: string) => ({ id: 1, name, icon: 'Circle', colorToken: 'GRAY', system: true }) as never;
function issue(typeName: string, parentNumber: number | null): IssueResponse {
  return mk({
    number: 5,
    type: t(typeName),
    parent: parentNumber == null ? null : { number: parentNumber, title: 'E', type: t('EPIC') },
  });
}

describe('epicDragBlockReason', () => {
  it('EPIC 은 차단', () => {
    expect(epicDragBlockReason(issue('EPIC', null))).toBe('에픽은 다른 에픽에 넣을 수 없습니다');
  });
  it('SUBTASK 는 차단', () => {
    expect(epicDragBlockReason(issue('SUBTASK', 3))).toBe(
      '하위 작업은 에픽에 직접 연결할 수 없습니다 — 부모 이슈를 옮겨 주세요',
    );
  });
  it('일반/커스텀 유형은 허용', () => {
    expect(epicDragBlockReason(issue('TASK', null))).toBeNull();
    expect(epicDragBlockReason(issue('MY_CUSTOM', 10))).toBeNull();
  });
});

describe('epicDropState', () => {
  it('드래그 없음 → idle', () => expect(epicDropState(null, 10)).toBe('idle'));
  it('차단 유형 → blocked', () => expect(epicDropState(issue('SUBTASK', 3), 10)).toBe('blocked'));
  it('현재 에픽 → current', () => expect(epicDropState(issue('TASK', 10), 10)).toBe('current'));
  it('부모 없음 + 미할당 → current', () => expect(epicDropState(issue('TASK', null), null)).toBe('current'));
  it('다른 에픽 → allowed', () => expect(epicDropState(issue('TASK', 10), 11)).toBe('allowed'));
  it('에픽 소속 + 미할당 → allowed', () => expect(epicDropState(issue('TASK', 10), null)).toBe('allowed'));
});

describe('isEpicDropData', () => {
  it('epic 키(null 포함)가 있으면 true', () => {
    expect(isEpicDropData({ epic: null })).toBe(true);
    expect(isEpicDropData({ epic: { number: 1, title: 'a', type: t('EPIC') } })).toBe(true);
  });
  it('카드/컬럼 데이터는 false', () => {
    expect(isEpicDropData({ status: 'TODO' })).toBe(false);
    expect(isEpicDropData(undefined)).toBe(false);
  });
});

// ── 충돌 판정·키보드 좌표 테스트용 픽스처 ─────────────────────────────────────
const rect = (left: number, top: number, width: number, height: number): ClientRect => ({
  left, top, width, height, right: left + width, bottom: top + height,
});
// dnd-kit DroppableContainer 최소 모양 — node 는 지정 시 사각형을 가짜로 박은 실제 DOM 요소.
function drop(id: string, data: Record<string, unknown>, r: ClientRect, withNode = false): DroppableContainer {
  let node: HTMLElement | null = null;
  if (withNode) {
    node = document.createElement('div');
    node.getBoundingClientRect = () => r as DOMRect;
  }
  return { id, key: id, data: { current: data }, disabled: false, node: { current: node }, rect: { current: r } } as never;
}
const clipOf = (r: ClientRect) => ({ current: { scrollTop: 0, getBoundingClientRect: () => r } as HTMLElement });
const ids = (cs: CollisionDescriptor[] | ReturnType<typeof issueCollision>) => cs.map((c) => c.id);

function collide(containers: DroppableContainer[], p: { x: number; y: number }) {
  return issueCollision({
    active: { id: 'issue-row-1', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
    collisionRect: rect(p.x, p.y, 10, 10),
    droppableRects: new Map<UniqueIdentifier, ClientRect>(containers.map((c) => [c.id, c.rect.current!])),
    droppableContainers: containers,
    pointerCoordinates: p,
  } as never);
}

describe('issueCollision — 스크롤로 가려진 에픽 항목', () => {
  // 에픽 목록 보이는 영역: y 100~300. 에픽 10 은 목록이 스크롤돼 y 20~50(「전체 이슈」 자리)에 가려져 있다.
  const list = rect(0, 100, 200, 200);
  const zone = drop('epic-panel', { zone: true }, rect(0, 0, 200, 400));
  const hidden = drop('epic-10', { epic: { number: 10 }, clip: clipOf(list) }, rect(0, 20, 200, 30));
  const visible = drop('epic-11', { epic: { number: 11 }, clip: clipOf(list) }, rect(0, 150, 200, 30));

  it('포인터가 가려진 에픽 위(패널 안)면 빈 결과 — 보이지 않는 에픽으로 PATCH 안 함', () => {
    expect(ids(collide([zone, hidden, visible], { x: 50, y: 30 }))).toEqual([]);
  });
  it('보이는 에픽은 그대로 대상', () => {
    expect(ids(collide([zone, hidden, visible], { x: 50, y: 160 }))).toEqual(['epic-11']);
  });
  it('clip 없는 「에픽 미할당」은 가려진 에픽과 겹쳐도 대상', () => {
    const none = drop('epic-none', { epic: null }, rect(0, 20, 200, 30));
    expect(ids(collide([zone, none, hidden], { x: 50, y: 30 }))).toEqual(['epic-none']);
  });
  it('패널 밖으로 삐져나온 가려진 에픽이 아래 컬럼 드롭을 삼키지 않는다', () => {
    const col = drop('col-TODO', { status: 'TODO', label: '할 일' }, rect(0, 500, 300, 300));
    const outside = drop('epic-12', { epic: { number: 12 }, clip: clipOf(list) }, rect(0, 520, 200, 30));
    expect(ids(collide([zone, outside, col], { x: 50, y: 530 }))).toEqual(['col-TODO']);
  });
});

// 가짜 droppableContainers — sortableKeyboardCoordinates 가 쓰는 getEnabled()·get(id) 만 구현.
function containersMap(cs: DroppableContainer[]) {
  const m = new Map(cs.map((c) => [c.id, c]));
  return { getEnabled: () => cs, get: (id: UniqueIdentifier) => m.get(id) } as never;
}
function keyboard(code: string, cs: DroppableContainer[], active: DroppableContainer, overId: string | null, collisionRect: ClientRect) {
  const event = new KeyboardEvent('keydown', { code });
  return issueKeyboardCoordinates(event, {
    active: active.id,
    currentCoordinates: { x: collisionRect.left, y: collisionRect.top },
    context: {
      active: { id: active.id, data: active.data, rect: { current: { initial: collisionRect, translated: collisionRect } } },
      collisionRect,
      droppableRects: new Map(cs.map((c) => [c.id, c.rect.current!])),
      droppableContainers: containersMap(cs),
      over: overId ? { id: overId } : null,
      scrollableAncestors: [],
    },
  } as never);
}

describe('issueKeyboardCoordinates — 보드 카드(sortable)', () => {
  const sortableData = (status: string) => ({ status, sortable: { containerId: `c-${status}`, index: 0, items: [] } });
  const card = drop('issue-1', sortableData('TODO'), rect(0, 100, 200, 60), true);
  const colTodo = drop('col-TODO', { status: 'TODO', label: '할 일' }, rect(0, 80, 220, 600), true);
  const colCanceled = drop('col-CANCELED', { status: 'CANCELED', label: '취소' }, rect(700, 80, 220, 600), true);
  // 떠 있는 패널 — CANCELED 보다 왼쪽·가까이 겹쳐 있어, 걸러지지 않으면 → 가 에픽으로 샌다.
  const epic = drop('epic-10', { epic: { number: 10 }, clip: clipOf(rect(600, 0, 300, 800)) }, rect(600, 100, 200, 40), true);
  const zone = drop('epic-panel', { zone: true }, rect(590, 90, 320, 700), true);

  it('→ 는 에픽 항목·패널 존을 건너뛰고 컬럼으로 간다', () => {
    const next = keyboard('ArrowRight', [card, colTodo, colCanceled, epic, zone], card, 'col-TODO', rect(0, 100, 200, 60));
    expect(next).toEqual({ x: 700, y: 80 });
  });
  it('↓ 결과가 가려진 에픽 항목이면 에픽 목록을 스크롤해 목록 중앙 바로 위로 드러낸다', () => {
    // 목록 보이는 영역 y 0~300(중앙 150), 항목 top 400 → top 이 148 이 되도록 252 스크롤.
    const clip = clipOf(rect(0, 0, 300, 300));
    const lower = drop('epic-11', { epic: { number: 11 }, clip }, rect(0, 400, 200, 40), true);
    const next = keyboard('ArrowDown', [card, lower], card, null, rect(0, 100, 200, 60));
    expect(clip.current.scrollTop).toBe(252);
    expect(next).toEqual({ x: 0, y: 400 });
  });
});

describe('issueKeyboardCoordinates — 목록 행', () => {
  const row = drop('issue-row-1', {}, rect(0, 0, 10, 10));
  // 목록 보이는 영역 y 200~500(중앙 350).
  const clipBox = rect(0, 200, 200, 300);
  it('↓ 로 고른 에픽이 위로 가려져 있으면 목록을 스크롤해 중앙 바로 위(348)로 드러낸다', () => {
    const clip = clipOf(clipBox);
    const a = drop('epic-10', { epic: { number: 10 }, clip }, rect(0, 120, 200, 30), true);
    const b = drop('epic-11', { epic: { number: 11 }, clip }, rect(0, 300, 200, 30), true);
    expect(keyboard('ArrowDown', [a, b], row, null, rect(0, 0, 10, 10))).toEqual({ x: 0, y: 120 });
    expect(clip.current.scrollTop).toBe(120 - 348);
  });
  it('↓ 로 고른 에픽이 아래로 가려져 있으면 목록을 내린다', () => {
    const clip = clipOf(clipBox);
    const a = drop('epic-10', { epic: { number: 10 }, clip }, rect(0, 300, 200, 30), true);
    const b = drop('epic-11', { epic: { number: 11 }, clip }, rect(0, 900, 200, 30), true);
    expect(keyboard('ArrowDown', [a, b], row, 'epic-10', rect(0, 300, 10, 10))).toEqual({ x: 0, y: 900 });
    expect(clip.current.scrollTop).toBe(900 - 348);
  });
  it('↑ 는 중앙 바로 아래(352)로 드러낸다 — 센서가 중앙을 넘는 좌표로 목록을 한 번 더 굴리지 않게', () => {
    const clip = clipOf(clipBox);
    const a = drop('epic-10', { epic: { number: 10 }, clip }, rect(0, 120, 200, 30), true);
    const b = drop('epic-11', { epic: { number: 11 }, clip }, rect(0, 300, 200, 30), true);
    keyboard('ArrowUp', [a, b], row, 'epic-11', rect(0, 300, 10, 10));
    expect(clip.current.scrollTop).toBe(120 - 352);
  });
  it('에픽 항목 다음에 사이클 구간을 위→아래로 순회한다(#881) — top 이 더 작아도 구간은 에픽 뒤', () => {
    const e = drop('epic-10', { epic: { number: 10 } }, rect(0, 400, 200, 30), true);
    const s1 = drop('cycle-section-cycle-1', { cycleSection: {} }, rect(300, 100, 500, 200), true);
    const s2 = drop('cycle-section-backlog', { cycleSection: {} }, rect(300, 320, 500, 200), true);
    const targets = [s2, e, s1];
    expect(keyboard('ArrowDown', targets, row, null, rect(0, 0, 10, 10))).toEqual({ x: 0, y: 400 });
    expect(keyboard('ArrowDown', targets, row, 'epic-10', rect(0, 400, 10, 10))).toEqual({ x: 300, y: 100 });
    expect(keyboard('ArrowDown', targets, row, 'cycle-section-cycle-1', rect(300, 100, 10, 10))).toEqual({ x: 300, y: 320 });
    expect(keyboard('ArrowUp', targets, row, 'cycle-section-cycle-1', rect(300, 100, 10, 10))).toEqual({ x: 0, y: 400 });
  });
  it('이미 보이는 에픽이면 스크롤하지 않는다', () => {
    const clip = clipOf(clipBox);
    const a = drop('epic-10', { epic: { number: 10 }, clip }, rect(0, 250, 200, 30), true);
    expect(keyboard('ArrowDown', [a], row, null, rect(0, 0, 10, 10))).toEqual({ x: 0, y: 250 });
    expect(clip.current.scrollTop).toBe(0);
  });
});

describe('issueCollision — 키보드(포인터 없음)', () => {
  it('목록 스크롤로 완전히 가려진 에픽은 가장 가까워도 over 가 되지 않는다', () => {
    const clip = clipOf(rect(0, 200, 200, 300)); // 보이는 영역 y 200~500
    const hidden = drop('epic-10', { epic: { number: 10 }, clip }, rect(0, 100, 200, 30));
    const visible = drop('epic-11', { epic: { number: 11 }, clip }, rect(0, 400, 200, 30));
    const cs = [hidden, visible];
    const result = issueCollision({
      active: { id: 'issue-row-1', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      collisionRect: rect(0, 100, 200, 30), // 가려진 에픽과 정확히 겹침
      droppableRects: new Map<UniqueIdentifier, ClientRect>(cs.map((c) => [c.id, c.rect.current!])),
      droppableContainers: cs,
      pointerCoordinates: null,
    } as never);
    expect(ids(result)[0]).toBe('epic-11');
  });
  it('좌상단이 정확히 겹치는 대상(방향키로 고른 컬럼)이 모서리 거리로 더 가까운 에픽보다 우선', () => {
    // 키 큰 CANCELED 컬럼(좌상단 1151,172)과 그 위에 떠 있는 작은 에픽 항목 — 카드 크기 사각형 기준 모서리 거리는 에픽이 더 가깝다.
    const col = drop('col-CANCELED', { status: 'CANCELED', label: '취소' }, rect(1151, 172, 273, 600));
    const ep = drop('epic-10', { epic: { number: 10 } }, rect(1212, 190, 200, 42));
    const cs = [col, ep];
    const result = issueCollision({
      active: { id: 'issue-1', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      collisionRect: rect(1151, 172, 222, 66),
      droppableRects: new Map<UniqueIdentifier, ClientRect>(cs.map((c) => [c.id, c.rect.current!])),
      droppableContainers: cs,
      pointerCoordinates: null,
    } as never);
    expect(ids(result)).toEqual(['col-CANCELED']);
  });
});

describe('issueCollision — 키보드, 사이클 구간(#881)', () => {
  const kb = (cs: DroppableContainer[], r: ClientRect) =>
    issueCollision({
      active: { id: 'issue-row-1', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      collisionRect: r,
      droppableRects: new Map<UniqueIdentifier, ClientRect>(cs.map((c) => [c.id, c.rect.current!])),
      droppableContainers: cs,
      pointerCoordinates: null,
    } as never);
  it('집은 직후 가장 가까운 대상 후보에서 사이클 구간을 뺀다 — 바로 아래 접힌 구간이 over 가 되지 않게', () => {
    const below = drop('cycle-section-cycle-3', { cycleSection: {}, keyboardExactOnly: true }, rect(0, 510, 800, 40));
    expect(ids(kb([below], rect(0, 470, 800, 36)))).toEqual([]);
  });
  it('방향키로 고른 구간(좌상단 정확히 일치)은 대상이 된다', () => {
    const below = drop('cycle-section-cycle-3', { cycleSection: {}, keyboardExactOnly: true }, rect(0, 510, 800, 40));
    expect(ids(kb([below], rect(0, 510, 800, 36)))).toEqual(['cycle-section-cycle-3']);
  });
});

describe('스크린리더 안내', () => {
  const over = (data: unknown) => ({ data: { current: data } }) as never;
  it('대상 이름은 한국어 — 원시 id 를 읽지 않는다', () => {
    expect(describeDropTarget(over({ epic: { number: 10, title: '결제 리뉴얼' } }), 'WP')).toBe('에픽 「결제 리뉴얼」');
    expect(describeDropTarget(over({ epic: null }), 'WP')).toBe('「에픽 미할당」');
    expect(
      describeDropTarget(over({ cycleSection: { cycle: { id: 1, name: '스프린트 12', status: 'ACTIVE' }, queryKey: [] } }), 'WP'),
    ).toBe('사이클 「스프린트 12」');
    expect(describeDropTarget(over({ cycleSection: { cycle: null, queryKey: [] } }), 'WP')).toBe('「백로그」');
    expect(describeDropTarget(over({ status: 'DONE', label: '완료' }), 'WP')).toBe('「완료」 컬럼');
    expect(describeDropTarget(over({ issue: mk({ number: 7, status: 'IN_PROGRESS' }), status: 'IN_PROGRESS' }), 'WP')).toBe('WP-7 카드(진행 중)');
    expect(describeDropTarget(over({ zone: true }), 'WP')).toBe('에픽 패널(놓을 수 없는 곳)');
    expect(describeDropTarget(null, 'WP')).toBeNull();
  });
  it('시작·오버·놓기·취소 문구에 이슈 키를 쓴다', () => {
    const a = issueDndAnnouncements('WP');
    const active = { data: { current: { issue: mk({ number: 3 }), source: 'row' } } } as never;
    expect(a.onDragStart({ active })).toBe('WP-3 이슈를 집었습니다.');
    expect(a.onDragOver({ active, over: over({ epic: null }) })).toBe('WP-3 이슈가 「에픽 미할당」 위에 있습니다.');
    expect(a.onDragEnd({ active, over: over({ epic: { number: 1, title: 'E' } }) })).toBe('WP-3 이슈를 에픽 「E」에 놓았습니다.');
    expect(a.onDragEnd({ active, over: over({ zone: true }) })).toBe('WP-3 이슈를 놓았습니다. 변경 사항이 없습니다.');
    expect(a.onDragEnd({ active, over: null })).toBe('WP-3 이슈를 놓았습니다. 변경 사항이 없습니다.');
    expect(a.onDragCancel({ active, over: null })).toBe('WP-3 이슈 이동을 취소했습니다.');
  });
  it('같은 사이클 구간에 놓으면 변경 없음으로 읽는다(#881)', () => {
    const a = issueDndAnnouncements('WP');
    const key = ['issues', 'search', 'WP', 'k1', 50];
    const s1 = { cycle: { id: 1, name: 'S1', status: 'ACTIVE' }, queryKey: key };
    const active = { data: { current: { issue: mk({ number: 3 }), source: 'row', cycleSection: s1 } } } as never;
    expect(a.onDragEnd({ active, over: over({ cycleSection: s1 }) })).toBe('WP-3 이슈를 놓았습니다. 변경 사항이 없습니다.');
    const s2 = { cycle: { id: 2, name: 'S2', status: 'ACTIVE' }, queryKey: ['other'] };
    expect(a.onDragEnd({ active, over: over({ cycleSection: s2 }) })).toBe('WP-3 이슈를 사이클 「S2」에 놓았습니다.');
  });
});

describe('isCycleDropData (#881)', () => {
  it('cycleSection 키가 있으면 사이클 구간 드롭 대상', () => {
    expect(isCycleDropData({ cycleSection: { cycle: null, queryKey: [] } })).toBe(true);
    expect(isCycleDropData({ epic: null })).toBe(false);
    expect(isCycleDropData(undefined)).toBe(false);
  });
});

describe('snapRowChipToPointer', () => {
  // 넓은 행(1000×40) 과 좁은 칩(300×32). transform 은 드래그 이동량.
  const row = { left: 100, top: 200, width: 1000, height: 40, right: 1100, bottom: 240 } as ClientRect;
  const chip = { left: 0, top: 0, width: 300, height: 32, right: 300, bottom: 32 } as ClientRect;
  const down = (x: number, y: number) => new MouseEvent('pointerdown', { clientX: x, clientY: y });
  const run = (activatorEvent: Event, activeNodeRect = row) =>
    snapRowChipToPointer({
      transform: { x: 30, y: 10, scaleX: 1, scaleY: 1 },
      activatorEvent,
      activeNodeRect,
      overlayNodeRect: chip,
      active: null,
      draggingNodeRect: null,
      containerNodeRect: null,
      over: null,
      scrollableAncestors: [],
      scrollableAncestorRects: [],
      windowRect: null,
    });

  it('행 왼쪽(칩 안)을 잡으면 이동 없음', () => {
    expect(run(down(160, 216))).toMatchObject({ x: 30, y: 10 });
  });

  it('행 오른쪽을 잡으면 칩 오른쪽 여유 지점이 포인터 밑에 오도록 옮긴다', () => {
    // 잡은 오프셋 900 → 칩 안 288(300-12): 포인터가 칩 왼쪽에서 288px 지점에 온다.
    expect(run(down(1000, 216)).x).toBe(30 + 900 - 288);
  });

  it('칩보다 아래쪽을 잡으면 세로도 칩 안으로 끌어온다', () => {
    // 잡은 세로 오프셋 38 → 칩 안 20(32-12).
    expect(run(down(160, 238)).y).toBe(10 + 38 - 20);
  });

  it('같은 드래그 중 행이 재측정돼도(자동 스크롤 등) 처음 잡은 오프셋을 유지한다', () => {
    const ev = down(1000, 216);
    const first = run(ev);
    // 행이 300px 위로 스크롤돼 다시 측정됨 — DragOverlay 는 처음 사각형에 고정이므로 결과가 같아야 한다.
    const scrolled = { ...row, top: row.top - 300, bottom: row.bottom - 300 };
    expect(run(ev, scrolled)).toEqual(first);
  });

  it('키보드 드래그(포인터 좌표 없음)는 그대로', () => {
    expect(run(new KeyboardEvent('keydown'))).toMatchObject({ x: 30, y: 10 });
  });
});
