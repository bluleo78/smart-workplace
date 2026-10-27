// @vitest-environment jsdom
// 에픽 DnD 순수 규칙 테스트 — 차단 사유·대상별 드롭 상태·드롭 데이터 판별·충돌 판정·키보드 좌표·스크린리더 안내.
// (sortableKeyboardCoordinates 가 대상 노드의 스크롤 조상을 계산하므로 jsdom 환경)
import type { ClientRect, CollisionDescriptor, DroppableContainer, UniqueIdentifier } from '@dnd-kit/core';
import { describe, expect, it } from 'vitest';

import type { IssueResponse, IssueStatus, ParentRef } from '../types/issue';
import {
  describeDropTarget,
  epicDragBlockReason,
  epicDropState,
  isCycleDropData,
  isEpicDropData,
  issueCollision,
  issueDndAnnouncements,
  issueKeyboardCoordinates,
} from './epicDnd';

// 필수 필드가 많은 IssueResponse 를 최소 오버라이드로 생성하는 테스트 팩토리.
function mk(over: Partial<IssueResponse>): IssueResponse {
  return {
    id: 0,
    projectKey: 'P',
    number: 0,
    title: 't',
    status: 'TODO',
    statusId: 1,
    statusName: '할 일',
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
  // 드롭 대상 에픽 — 상태를 주면 종료 판정에 쓴다.
  const target = (number: number, status?: IssueStatus): ParentRef => ({ number, title: `에픽 ${number}`, type: t('EPIC'), status });
  it('드래그 없음 → idle', () => expect(epicDropState(null, target(10))).toBe('idle'));
  it('차단 유형 → blocked', () => expect(epicDropState(issue('SUBTASK', 3), target(10))).toBe('blocked'));
  it('현재 에픽 → current', () => expect(epicDropState(issue('TASK', 10), target(10))).toBe('current'));
  it('부모 없음 + 미할당 → current', () => expect(epicDropState(issue('TASK', null), null)).toBe('current'));
  it('다른 에픽 → allowed', () => expect(epicDropState(issue('TASK', 10), target(11))).toBe('allowed'));
  it('에픽 소속 + 미할당 → allowed', () => expect(epicDropState(issue('TASK', 10), null)).toBe('allowed'));
  it('종료된 다른 에픽 → blocked (WP-389)', () => {
    expect(epicDropState(issue('TASK', 10), target(11, 'DONE'))).toBe('blocked');
    expect(epicDropState(issue('TASK', null), target(11, 'CANCELED'))).toBe('blocked');
  });
  it('이미 속한 종료 에픽 → current (WP-389)', () => expect(epicDropState(issue('TASK', 11), target(11, 'DONE'))).toBe('current'));
  // WP-1039 패널 에픽은 이 프로젝트(P) 에픽 — 부모가 다른 프로젝트 에픽 CLA-10 이면 번호가 같은 #10 도 놓을 수 있는 대상이다.
  it('다른 프로젝트 에픽 부모 + 같은 번호 이 프로젝트 에픽 → allowed (WP-1039)', () => {
    const cross = mk({ number: 5, type: t('TASK'), parent: { number: 10, title: 'C', type: t('EPIC'), projectKey: 'CLA' } });
    expect(epicDropState(cross, target(10))).toBe('allowed');
    // 부모 키가 자기 프로젝트 키면 같은 에픽이다.
    const own = mk({ number: 5, type: t('TASK'), parent: { number: 10, title: 'C', type: t('EPIC'), projectKey: 'P' } });
    expect(epicDropState(own, target(10))).toBe('current');
  });
  it('가려진 부모 → 미할당도 allowed (WP-1039)', () => {
    const hidden = mk({ number: 5, type: t('TASK'), parent: { number: 0, title: null as never, type: null as never, hidden: true } });
    expect(epicDropState(hidden, null)).toBe('allowed');
  });
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

// 스윔레인(WP-1021) — 키 큰 레인 u-1(y 100~900) 아래에 레인 u-2(y 940~). 열 간격 252px.
describe('스윔레인 — 다른 레인으로 새지 않는다 (WP-1021)', () => {
  const laneCell = (lane: string, statusId: number, r: ClientRect) =>
    drop(`col-lane-${lane}-${statusId}`, { lane, statusId, label: `${lane} · ${statusId}` }, r, true);
  const own2 = laneCell('u-1', 2, rect(252, 100, 240, 800));
  const own1 = laneCell('u-1', 1, rect(0, 100, 240, 800));
  const foreign1 = laneCell('u-2', 1, rect(0, 940, 240, 200));
  const foreign2 = laneCell('u-2', 2, rect(252, 940, 240, 200));
  // u-1 의 할 일 칸 아래쪽 카드 — 모서리 거리로는 아래 레인 u-2 의 진행 중 칸이 자기 레인 진행 중 칸보다 가깝다.
  const cardRect = rect(8, 800, 224, 60);
  const card = drop(
    'issue-u-1-5',
    { lane: 'u-1', statusId: 1, sortable: { containerId: 'c-u-1-1', index: 0, items: [] } },
    cardRect,
    true,
  );
  const all = [card, own1, own2, foreign1, foreign2];

  it('키보드 → 는 자기 레인의 오른쪽 칸으로 간다', () => {
    expect(keyboard('ArrowRight', all, card, own1.id as string, cardRect)).toEqual({ x: 252, y: 100 });
  });
  it('키보드 ↓ 는 아래 레인 칸으로 가지 않는다', () => {
    expect(keyboard('ArrowDown', all, card, own1.id as string, cardRect)).toBeUndefined();
  });
  it('키보드 충돌 판정(정확히 겹치는 대상 없음)도 다른 레인 칸을 고르지 않는다', () => {
    const result = issueCollision({
      active: { id: card.id, data: card.data, rect: { current: { initial: null, translated: null } } },
      collisionRect: rect(252, 860, 224, 60),
      droppableRects: new Map<UniqueIdentifier, ClientRect>(all.map((c) => [c.id, c.rect.current!])),
      droppableContainers: [own1, own2, foreign1, foreign2],
      pointerCoordinates: null,
    } as never);
    expect(ids(result)[0]).toBe('col-lane-u-1-2');
  });

  // 포인터 틈 폴백 — 칸 사이 틈은 그 줄(레인)의 칸으로, 레인 머리·레인 사이 틈은 아무 일도 없다.
  it('포인터가 같은 줄의 칸 사이 틈이면 그 레인 칸이 대상', () => {
    expect(ids(collide([own1, own2, foreign1, foreign2], { x: 246, y: 500 }))[0]).toMatch(/^col-lane-u-1-/);
    // 줄 아래 끝 — 모서리 거리로는 아래 레인 칸이 더 가까워도 그 줄의 레인 안에서만 고른다.
    expect(ids(collide([own1, own2, foreign1, foreign2], { x: 246, y: 895 }))[0]).toMatch(/^col-lane-u-1-/);
  });
  it('포인터가 레인 사이(아래 레인 머리) 틈이면 빈 결과 — 이웃 칸으로 오인해 상태를 바꾸지 않는다', () => {
    expect(ids(collide([own1, own2, foreign1, foreign2], { x: 300, y: 920 }))).toEqual([]);
  });
  it('상태 보드 컬럼(레인 없음) 틈 폴백은 그대로', () => {
    const c1 = drop('col-1', { statusId: 1, label: '할 일' }, rect(0, 100, 240, 800));
    const c2 = drop('col-2', { statusId: 2, label: '진행 중' }, rect(252, 100, 240, 800));
    expect(ids(collide([c1, c2], { x: 246, y: 500 })).length).toBeGreaterThan(0);
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
    // 카드 상태는 프로젝트 상태 이름(statusName, WP-808)으로 읽는다.
    expect(describeDropTarget(over({ issue: mk({ number: 7, status: 'IN_PROGRESS', statusId: 12, statusName: '검토 중' }), status: 'IN_PROGRESS' }), 'WP')).toBe('WP-7 카드(검토 중)');
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
  it('스윔레인 — 다른 레인·같은 상태 칸에 놓으면 변경 없음, 같은 레인 다른 상태 칸은 놓았다고 읽는다(WP-1021)', () => {
    const a = issueDndAnnouncements('WP');
    const active = { data: { current: { issue: mk({ number: 3 }), source: 'card', lane: 'u-1', statusId: 1 } } } as never;
    expect(a.onDragEnd({ active, over: over({ lane: 'u-2', statusId: 2, label: 'Bob · 진행 중' }) })).toBe('WP-3 이슈를 놓았습니다. 변경 사항이 없습니다.');
    expect(a.onDragEnd({ active, over: over({ lane: 'u-1', statusId: 1, label: 'Alice · 할 일' }) })).toBe('WP-3 이슈를 놓았습니다. 변경 사항이 없습니다.');
    expect(a.onDragEnd({ active, over: over({ lane: 'u-1', statusId: 2, label: 'Alice · 진행 중' }) })).toBe('WP-3 이슈를 「Alice · 진행 중」 컬럼에 놓았습니다.');
    // 레인 카드로 에픽에 놓는 것은 그대로 놓았다고 읽는다.
    expect(a.onDragEnd({ active, over: over({ epic: { number: 1, title: 'E' } }) })).toBe('WP-3 이슈를 에픽 「E」에 놓았습니다.');
  });
  it('스윔레인 — 끄는 동안 다른 레인 칸·카드는 놓을 수 없는 곳으로, 같은 레인 칸은 대상으로 읽는다(WP-1021)', () => {
    const a = issueDndAnnouncements('WP');
    const active = { data: { current: { issue: mk({ number: 3 }), source: 'card', lane: 'u-1', statusId: 1 } } } as never;
    expect(a.onDragOver({ active, over: over({ lane: 'u-2', statusId: 3, label: 'Bob · 완료' }) })).toBe(
      'WP-3 이슈가 「Bob · 완료」 컬럼(놓을 수 없는 곳) 위에 있습니다.',
    );
    expect(a.onDragOver({ active, over: over({ lane: 'u-2', issue: mk({ number: 9, status: 'DONE' }) }) })).toMatch(
      /^WP-3 이슈가 WP-9 카드\(.+\)\(놓을 수 없는 곳\) 위에 있습니다\.$/,
    );
    expect(a.onDragOver({ active, over: over({ lane: 'u-1', statusId: 1, label: 'Alice · 할 일' }) })).toBe(
      'WP-3 이슈가 「Alice · 할 일」 컬럼 위에 있습니다.',
    );
    expect(a.onDragOver({ active, over: over({ lane: 'u-1', statusId: 2, label: 'Alice · 진행 중' }) })).toBe(
      'WP-3 이슈가 「Alice · 진행 중」 컬럼 위에 있습니다.',
    );
  });
});

describe('isCycleDropData (#881)', () => {
  it('cycleSection 키가 있으면 사이클 구간 드롭 대상', () => {
    expect(isCycleDropData({ cycleSection: { cycle: null, queryKey: [] } })).toBe(true);
    expect(isCycleDropData({ epic: null })).toBe(false);
    expect(isCycleDropData(undefined)).toBe(false);
  });
});
