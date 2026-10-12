// 목록 행 드래그 고스트 칩 공용 modifier — 이슈 목록 행(epicDnd)·드라이브 행(driveDnd)이 함께 쓴다.
import type { Modifier } from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';

// 뷰포트 좌표(dnd-kit 이 Coordinates 타입을 export 하지 않음).
type Coordinates = { x: number; y: number };

// 목록 행 고스트 칩을 포인터 기준으로 옮기는 DragOverlay modifier.
// 왜: DragOverlay 는 원본 노드(표 행 전체) 왼쪽 위에서 시작해 이동량만큼만 따라간다. 칩(최대 320px)은 행보다 훨씬 좁아,
//     행 오른쪽(담당자·마감 쪽)을 잡으면 칩이 포인터에서 수백 px 왼쪽에 뜬다.
// 어떻게: 잡은 지점의 행 안 오프셋을 칩 안으로 끌어와(가장자리 여유 ROW_CHIP_POINTER_INSET 만큼 안쪽) 칩이 항상 포인터 밑에 오게 한다.
//        행 왼쪽을 잡아 오프셋이 이미 칩 안이면 이동 없음(기존과 같음). 키보드 드래그는 포인터 좌표가 없어 그대로 둔다.
// 드롭 판정은 포인터 좌표만 보므로(issueCollision) 칩 위치를 옮겨도 판정은 바뀌지 않는다.
const ROW_CHIP_POINTER_INSET = 12;
// 칩 크기 안 [여유, 크기-여유] 로 자른다(칩이 여유의 두 배보다 작으면 여유 지점).
const clampInto = (v: number, size: number) =>
  Math.min(Math.max(v, ROW_CHIP_POINTER_INSET), Math.max(size - ROW_CHIP_POINTER_INSET, ROW_CHIP_POINTER_INSET));
// 드래그(activatorEvent)별로 처음 잡은 행 안 오프셋을 고정해 둔다 — 행 사각형은 드래그 중(자동 스크롤·레이아웃 변화) 재측정되지만
// DragOverlay 는 처음 측정한 사각형에 고정되므로, 매번 새 사각형으로 오프셋을 다시 재면 칩이 포인터에서 밀려난다.
const rowGrabOffsets = new WeakMap<Event, Coordinates>();
export const snapRowChipToPointer: Modifier = ({ transform, activatorEvent, activeNodeRect, overlayNodeRect }) => {
  if (!activatorEvent || !overlayNodeRect) return transform;
  let grab = rowGrabOffsets.get(activatorEvent);
  if (!grab) {
    const start = getEventCoordinates(activatorEvent);
    if (!start || !activeNodeRect) return transform;
    grab = { x: start.x - activeNodeRect.left, y: start.y - activeNodeRect.top };
    rowGrabOffsets.set(activatorEvent, grab);
  }
  // 행 안에서 잡은 지점 → 칩 안에서 포인터가 놓일 지점. 차이만큼 칩을 옮긴다.
  return {
    ...transform,
    x: transform.x + grab.x - clampInto(grab.x, overlayNodeRect.width),
    y: transform.y + grab.y - clampInto(grab.y, overlayNodeRect.height),
  };
};
