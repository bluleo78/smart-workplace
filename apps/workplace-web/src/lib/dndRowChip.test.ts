// @vitest-environment jsdom
// 행 고스트 칩 modifier 테스트 — 잡은 지점 보정·재측정 시 오프셋 유지·키보드 드래그 무보정. (MouseEvent/KeyboardEvent 생성에 jsdom 필요)
import type { ClientRect } from '@dnd-kit/core';
import { describe, expect, it } from 'vitest';

import { snapRowChipToPointer } from './dndRowChip';

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
