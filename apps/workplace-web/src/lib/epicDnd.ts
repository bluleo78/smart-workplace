// 이슈 → 에픽 드래그 앤 드롭 순수 규칙.
// 서버(IssueService.setParent)의 계층 규칙을 UI 에서 미리 반영해, 놓아도 거부될 대상은 드래그 중에 막고 사유를 보여준다.
import {
  type Active,
  type Announcements,
  type ClientRect,
  closestCorners,
  type CollisionDetection,
  type DroppableContainer,
  type KeyboardCoordinateGetter,
  type Over,
  pointerWithin,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

import type { IssueResponse, ParentRef } from '../types/issue';
import { statusLabel } from './issueGrouping';

// 뷰포트 좌표(dnd-kit 이 Coordinates 타입을 export 하지 않음).
type Coordinates = { x: number; y: number };

// 「에픽 미할당」 드롭 대상 id — 놓으면 부모 해제.
export const EPIC_DROP_NONE_ID = 'epic-none';
// 드래그 중 에픽 패널 전체 영역 — 떠 있는 패널이 보드 컬럼을 덮으므로, 패널 위(비허용 항목·배너·여백)에 놓았을 때
// 아래에 깔린 카드/컬럼이 대상이 되어 상태가 바뀌지 않도록 패널 영역을 먼저 가로챈다. 여기에 놓으면 아무 일도 없다.
export const EPIC_PANEL_ZONE_ID = 'epic-panel';
// 에픽 패널 쪽 droppable(에픽 항목·미할당·패널 존 모두) — 보드 후보에서 패널 전체를 뺄 때 쓴다.
const isEpicPanelId = (id: UniqueIdentifier) => String(id).startsWith('epic-');
// 에픽 항목 droppable(에픽·미할당) — 패널 존은 제외.
const isEpicItemId = (id: UniqueIdentifier) => isEpicPanelId(id) && id !== EPIC_PANEL_ZONE_ID;
// 보드 상태 컬럼 droppable(col-{status}).
const isBoardColumnId = (id: UniqueIdentifier) => String(id).startsWith('col-');
// 에픽 항목 드롭 대상 id.
export const epicDropId = (n: number) => `epic-${n}`;

// 드래그 소스가 싣는 데이터 — 보드 카드(card)·목록 행(row) 공통. 보드 상태 드롭용 issueNumber/status 는 카드만.
export type IssueDragData = {
  issue: IssueResponse;
  source: 'card' | 'row';
  showType?: boolean;
  issueNumber?: number;
  status?: string;
};

// 에픽 드롭 대상 데이터 — epic=null 이면 「에픽 미할당」. ParentRef 전체를 실어 낙관적 반영에 그대로 쓴다.
// clip: 항목을 감싼 스크롤 컨테이너(에픽 목록). dnd-kit 의 droppable 사각형은 스크롤 조상의 잘림을 모르므로,
//       스크롤로 가려진 항목이 포인터 판정에 잡히지 않게 보이는 영역을 이 컨테이너로 판단한다.
export type EpicDropData = { epic: ParentRef | null; clip?: { readonly current: HTMLElement | null } };

// 점이 사각형 안(경계 포함)인지 — 충돌 판정(포인터·보드 컬럼 영역)이 같은 규칙을 쓴다.
export function pointInRect(p: Coordinates, r: Pick<ClientRect, 'left' | 'right' | 'top' | 'bottom'>): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

// 드롭 대상 data 의 clip(스크롤 컨테이너) 요소 — 없으면(미할당·카드·컬럼) null.
function clipOf(data: unknown): HTMLElement | null {
  return (data as Partial<EpicDropData> | undefined)?.clip?.current ?? null;
}

// 포인터가 드롭 대상의 clip(스크롤 컨테이너) 보이는 영역 안인지 — clip 이 없으면(미할당·카드·컬럼) 항상 보인다.
function visibleInClip(data: unknown, p: Coordinates): boolean {
  const clip = clipOf(data);
  return clip == null || pointInRect(p, clip.getBoundingClientRect());
}

// over.data 가 에픽 드롭 대상인지 — 카드/컬럼 droppable 과 구분(epic 키 존재 여부, null 도 유효).
export function isEpicDropData(d: unknown): d is EpicDropData {
  return typeof d === 'object' && d != null && 'epic' in d;
}

// 에픽에 연결할 수 없는 유형이면 사유, 가능하면 null.
// EPIC 은 부모를 가질 수 없고, SUBTASK 의 부모는 EPIC 이 될 수 없다(2단계 초과 금지) — 서버 규칙과 동일.
export function epicDragBlockReason(issue: IssueResponse): string | null {
  const name = issue.type?.name;
  if (name === 'EPIC') return '에픽은 다른 에픽에 넣을 수 없습니다';
  if (name === 'SUBTASK') return '하위 작업은 에픽에 직접 연결할 수 없습니다 — 부모 이슈를 옮겨 주세요';
  return null;
}

export type EpicDropState = 'idle' | 'allowed' | 'current' | 'blocked';

// 드래그 중인 이슈 기준 한 대상(에픽 번호, null=미할당)의 상태.
// current(이미 그 에픽/이미 미할당)는 놓아도 변화가 없으므로 드롭을 비활성화한다.
export function epicDropState(active: IssueResponse | null, targetEpicNumber: number | null): EpicDropState {
  if (!active) return 'idle';
  if (epicDragBlockReason(active) != null) return 'blocked';
  const current = active.parent?.number ?? null;
  return current === targetEpicNumber ? 'current' : 'allowed';
}

// 충돌 판정.
// - 키보드(포인터 좌표 없음): 좌상단이 정확히 겹치는 대상(방향키로 고른 대상), 없으면 가장 가까운 대상(closestCorners).
//   패널 영역 존·목록 스크롤로 완전히 가려진 에픽은 제외 — 드래그 시작 직후 보이지 않는 에픽이 가장 가깝다고 over 가 되지 않게.
// - 포인터가 에픽 패널 위(존 포함)면 에픽 항목 히트만 — 비허용 항목·배너·여백이면 빈 결과(no-op).
//   (disabled droppable 은 후보에서 빠지므로, 존이 없으면 패널 아래 보드 카드/컬럼이 잡혀 상태가 바뀐다.)
// - 스크롤로 가려진 에픽 항목 히트는 먼저 버린다 — 사각형이 잘리지 않아 「전체 이슈」·배너·푸터 위에서도 잡혀
//   보이지 않는 에픽으로 PATCH 되던 문제. 패널 판정보다 먼저 걸러야, 패널 밖으로 삐져나온 가려진 항목이
//   아래 카드/컬럼 드롭을 빈 결과로 삼키지 않는다.
// - 그 외 pointerWithin 결과. 비었을 때 보드 컬럼 틈 폴백(#774)은 포인터가 보드 컬럼 영역 안일 때만 —
//   패널과 보드 사이 틈에 놓으면 아무 일도 없어야 한다(#881: 틈에서 이웃 대상으로 오인 이동).
export const issueCollision: CollisionDetection = (args) => {
  const p = args.pointerCoordinates;
  if (!p) {
    // clip 사각형은 호출당 한 번만 읽는다(후보마다 레이아웃 조회 반복 방지) — 에픽 항목은 모두 같은 목록을 clip 으로 공유한다.
    const clipRects = new Map<HTMLElement, DOMRect>();
    // 드롭 대상 사각형이 clip 보이는 영역 밖으로 완전히 가려졌는지 — clip 없으면 false.
    const hiddenInClip = (data: unknown, r: ClientRect | undefined) => {
      const clip = clipOf(data);
      if (clip == null || r == null) return false;
      let c = clipRects.get(clip);
      if (!c) {
        c = clip.getBoundingClientRect();
        clipRects.set(clip, c);
      }
      return r.bottom <= c.top || r.top >= c.bottom;
    };
    const candidates = args.droppableContainers.filter(
      (c) => c.id !== EPIC_PANEL_ZONE_ID && !(isEpicItemId(c.id) && hiddenInClip(c.data.current, args.droppableRects.get(c.id))),
    );
    // 키보드 좌표 계산기는 고른 대상의 좌상단으로 옮긴다 — 좌상단이 정확히 겹치는 대상이 있으면 그것이 고른 대상이다.
    // 왜: 떠 있는 패널의 에픽 항목이 CANCELED 컬럼 위에 겹쳐, 카드 크기 사각형과의 모서리 거리로는 키 큰 컬럼보다
    //     작은 에픽 항목이 더 가까워 → 로 CANCELED 를 골라도 over 가 에픽이 됐다.
    const r0 = args.collisionRect;
    const exact = candidates.find((c) => {
      const r = args.droppableRects.get(c.id);
      return r != null && Math.abs(r.left - r0.left) < 1 && Math.abs(r.top - r0.top) < 1;
    });
    if (exact) return [{ id: exact.id, data: { droppableContainer: exact, value: 0 } }];
    return closestCorners({ ...args, droppableContainers: candidates });
  }
  const hits = pointerWithin(args).filter(
    (h) => !isEpicItemId(h.id) || visibleInClip(h.data?.droppableContainer?.data.current, p),
  );
  // 패널 존 히트도 포함해 판정 — 패널 위면 에픽 항목만 남긴다(존만이면 빈 결과 = no-op).
  if (hits.some((h) => isEpicPanelId(h.id))) return hits.filter((h) => isEpicItemId(h.id));
  if (hits.length > 0) return hits;
  // 보드 컬럼 전체를 감싸는 사각형(합집합)을 한 번의 순회로 구한다.
  const cols = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  let hasCol = false;
  for (const c of args.droppableContainers) {
    const r = isBoardColumnId(c.id) ? args.droppableRects.get(c.id) : undefined;
    if (r == null) continue;
    hasCol = true;
    cols.left = Math.min(cols.left, r.left);
    cols.right = Math.max(cols.right, r.right);
    cols.top = Math.min(cols.top, r.top);
    cols.bottom = Math.max(cols.bottom, r.bottom);
  }
  if (!hasCol || !pointInRect(p, cols)) return [];
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => !isEpicPanelId(c.id)),
  });
};

// 키보드로 고른 에픽 항목이 에픽 목록(clip) 밖으로 가려져 있으면 목록을 스크롤해 드러내고, 스크롤 후의 실제 좌상단을 돌려준다.
// 왜: KeyboardSensor 는 over 노드(없으면 활성 노드)의 스크롤 조상만, 그것도 방향키 방향으로만 굴린다 — over 가 목록 밖
//     (카드·컬럼)이거나 대상이 반대편에 가려져 있으면 가려진 에픽이 over 가 돼도 화면엔 안 보인다.
// 드러낸 항목의 top 을 목록 세로 중앙 바로 위(↓)/아래(↑)에 둔다 — 센서는 좌표가 스크롤 컨테이너 중앙을 방향키 쪽으로
// 넘으면 이동 대신 컨테이너를 한 번 더 굴리므로(두 번 굴러 지나침), 중앙을 넘지 않게 맞춘다.
// scrollIntoView 는 페이지까지 굴려 센서의 페이지 스크롤과 충돌하므로 목록 scrollTop 만 조정한다.
// 측정값(droppableRects)은 스크롤 전 값이라 새 좌표는 노드에서 다시 읽는다.
function revealTarget(container: DroppableContainer | undefined, fallback: Coordinates, down: boolean): Coordinates {
  const node = container?.node.current;
  const clip = clipOf(container?.data.current);
  if (!node || !clip) return fallback;
  const n = node.getBoundingClientRect();
  const c = clip.getBoundingClientRect();
  if (n.top >= c.top && n.bottom <= c.bottom) return fallback;
  const mid = c.top + c.height / 2;
  clip.scrollTop += n.top - (down ? mid - 2 : mid + 2);
  const r = node.getBoundingClientRect();
  return { x: r.left, y: r.top };
}

// 키보드 좌표 — 보드 카드(sortable)는 cardKeyboardCoordinates, 목록 행(useDraggable)은 rowKeyboardCoordinates 로 나눈다.
export const issueKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) =>
  args.context.active?.data.current?.sortable
    ? cardKeyboardCoordinates(event, args)
    : rowKeyboardCoordinates(event, args);

// 보드 카드 — 기존 sortableKeyboardCoordinates.
// - ←/→ 는 에픽 항목·패널 존을 후보에서 뺀다: 떠 있는 패널이 CANCELED 컬럼을 덮어 →가 에픽으로 새면
//   키보드 사용자가 CANCELED 로 상태를 못 바꾼다(기존 키보드 상태 변경 회귀). ↑/↓ 는 에픽을 남겨 패널에 닿게 한다.
// - 결과가 에픽 항목이면(교차 컨테이너라 오프셋 0 → 좌표=항목 좌상단) 가려진 경우 그 항목을 드러낸다(revealTarget).
const cardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { droppableContainers, droppableRects } = args.context;
  if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
    // sortableKeyboardCoordinates 는 getEnabled()·get(id) 만 쓴다 — Map 을 상속한 객체는 Map 메서드가 수신자 검사로
    // 깨지므로 두 메서드만 가진 얇은 래퍼로 후보를 거른다.
    const boardOnly = {
      getEnabled: () => droppableContainers.getEnabled().filter((c) => !isEpicPanelId(c.id)),
      get: (id: UniqueIdentifier) => droppableContainers.get(id),
    } as unknown as typeof droppableContainers;
    return sortableKeyboardCoordinates(event, { ...args, context: { ...args.context, droppableContainers: boardOnly } });
  }
  const next = sortableKeyboardCoordinates(event, args);
  if (!next) return next;
  const epicTarget = droppableContainers.getEnabled().find((c) => {
    const r = isEpicItemId(c.id) ? droppableRects.get(c.id) : undefined;
    return r != null && r.left === next.x && r.top === next.y;
  });
  return epicTarget ? revealTarget(epicTarget, next, event.code === 'ArrowDown') : next;
};

// 목록 행 — 자기 droppable 이 없어 sortableKeyboardCoordinates 가 아무것도 반환하지 않으므로(activeDroppable 필요),
// 방향키로 활성 에픽 항목 사이를 위(←/↑)·아래(→/↓)로 옮긴다. 반환값은 이동한 사각형의 좌상단.
const rowKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { droppableContainers, droppableRects, over } = args.context;
  const down = event.code === 'ArrowDown' || event.code === 'ArrowRight';
  const up = event.code === 'ArrowUp' || event.code === 'ArrowLeft';
  if (!down && !up) return undefined;
  event.preventDefault();
  const targets = droppableContainers
    .getEnabled()
    .filter((c) => isEpicItemId(c.id))
    .map((c) => ({ container: c, rect: droppableRects.get(c.id) }))
    .filter((t): t is { container: DroppableContainer; rect: ClientRect } => t.rect != null)
    .sort((a, b) => a.rect.top - b.rect.top);
  if (targets.length === 0) return undefined;
  const i = targets.findIndex((t) => t.container.id === over?.id);
  const next = i < 0 ? targets[0] : targets[Math.min(targets.length - 1, Math.max(0, i + (down ? 1 : -1)))];
  return revealTarget(next.container, { x: next.rect.left, y: next.rect.top }, down);
};

// 드롭 대상 한국어 이름 — 스크린리더 안내용. 내부 id(epic-3, col-TODO, issue-7)는 읽지 않는다.
// 담당자·우선순위 그룹 보드처럼 카드 위가 상태 변경이 아닌 곳도 있어, 카드는 「어느 컬럼」이 아니라 카드 자체로 부른다.
export function describeDropTarget(over: Pick<Over, 'data'> | null, projectKey: string): string | null {
  const d = over?.data.current as Record<string, unknown> | undefined;
  if (!d) return null;
  if (isEpicDropData(d)) return d.epic ? `에픽 「${d.epic.title}」` : '「에픽 미할당」';
  if (d.zone) return '에픽 패널(놓을 수 없는 곳)';
  if (typeof d.label === 'string') return `「${d.label}」 컬럼`;
  const issue = d.issue as IssueResponse | undefined;
  if (issue) return `${projectKey}-${issue.number} 카드(${statusLabel(issue.status)})`;
  return null;
}

// DndContext 안내 문구 — 기본값은 영어 + 원시 id 를 읽으므로 이슈 키·대상 이름으로 바꾼다.
export function issueDndAnnouncements(projectKey: string): Announcements {
  const key = (a: Pick<Active, 'data'>) => {
    const d = a.data.current as IssueDragData | undefined;
    return d ? `${projectKey}-${d.issue.number}` : '이슈';
  };
  return {
    onDragStart: ({ active }) => `${key(active)} 이슈를 집었습니다.`,
    onDragOver: ({ active, over }) => {
      const target = describeDropTarget(over, projectKey);
      return target ? `${key(active)} 이슈가 ${target} 위에 있습니다.` : `${key(active)} 이슈가 놓을 대상 밖에 있습니다.`;
    },
    onDragEnd: ({ active, over }) => {
      const target = describeDropTarget(over, projectKey);
      return target && over?.data.current?.zone !== true
        ? `${key(active)} 이슈를 ${target}에 놓았습니다.`
        : `${key(active)} 이슈를 놓았습니다. 변경 사항이 없습니다.`;
    },
    onDragCancel: ({ active }) => `${key(active)} 이슈 이동을 취소했습니다.`,
  };
}

// 드래그 가능 항목의 스크린리더 사용법 안내(aria-describedby).
export const ISSUE_DND_SCREEN_READER_INSTRUCTIONS = {
  draggable: 'Space 키로 이슈를 집고, 방향키로 에픽이나 상태 컬럼을 고른 뒤 Space 키로 놓으세요. Esc 키를 누르면 취소됩니다.',
};
