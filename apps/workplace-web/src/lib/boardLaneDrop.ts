// 보드 상태 드롭 규칙 — 상태 보드와 그룹 보드 스윔레인(WP-1021)이 함께 쓴다. 놓았을 때 바꿀 상태를 정한다.
// 스윔레인은 상태만 바꾸는 곳이다: 같은 레인의 다른 상태 칸(또는 그 칸의 카드)에 놓으면 그 상태로, 다른 레인에 놓으면 아무것도 하지 않는다
// (담당자·우선순위를 드래그로 바꾸지 않는다 — 다중 담당자 이슈는 여러 레인에 있어 「옮긴다」의 뜻이 모호하다).
// 상태 보드는 카드·컬럼 모두 레인이 없어(undefined) 같은 규칙으로 「다른 상태 컬럼·카드면 그 상태」가 된다.
import type { IssueDragData } from './epicDnd';

/** 레인 칸 droppable id — `col-` 로 시작해야 포인터가 칸 사이 틈에 있을 때 보드 컬럼 폴백(issueCollision)이 칸을 찾는다. */
export const laneCellDropId = (lane: string, statusId: number) => `col-lane-${lane}-${statusId}`;

/** 레인 testid — 키보드 놓기 포커스가 같은 레인 안에서 카드를 찾을 때도 쓴다(useKeyboardDropFocus). */
export const laneTestId = (lane: string) => `board-lane-${lane}`;

/** 레인 칸 testid — 키보드 놓기 포커스가 놓은 칸을 찾을 때도 쓴다. */
export const laneCellTestId = (lane: string, statusId: number) => `board-lane-${lane}-col-${statusId}`;

/**
 * 레인 칸 드롭 대상 data — 상태 id·레인 키, label 은 스크린리더 안내(describeDropTarget 「「…」 컬럼」)용.
 * epic·cycleSection·zone 키를 두지 않는다 — 공용 provider 가 그 키로 에픽·사이클 드롭을 가른다.
 */
export type LaneCellDropData = { statusId: number; lane: string; label: string };

/**
 * 놓은 대상이 바꿀 상태 id — 바꾸지 않으면 null.
 * - 대상은 상태 컬럼·레인 칸 또는 카드(IssueDragData — 그 카드의 상태). 상태 id 가 숫자가 아니면(에픽 항목·패널 존·사이클 구간) 무시.
 * - 출발 카드와 대상의 레인이 다르면 무시 — 둘 다 없으면(상태 보드) 같은 것으로 본다.
 * - 이미 그 상태면 무시.
 */
export function boardDropStatusId(
  src: Pick<IssueDragData, 'lane' | 'statusId'> | undefined,
  over: { lane?: unknown; statusId?: unknown } | undefined,
): number | null {
  if (!src || !over) return null;
  if (typeof over.statusId !== 'number' || (over.lane ?? undefined) !== (src.lane ?? undefined)) return null;
  return over.statusId === src.statusId ? null : over.statusId;
}
