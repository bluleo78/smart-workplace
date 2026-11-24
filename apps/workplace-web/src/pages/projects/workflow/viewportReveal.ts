/** 화면 좌표 사각형(좌상단·우하단) — 캔버스 시야와 노드 위치를 같은 단위로 다룬다 */
export type Rect = { left: number; top: number; right: number; bottom: number }

/**
 * 새 노드를 더한 뒤 캔버스 밖이면 최소한만큼 시야를 옮기기 위한 순수 계산 — 좌표는 화면(px) 기준.
 * 반환값은 `setViewport` 에 더할 이동량이다(양수 = 대상이 화면에서 오른쪽·아래로 밀린다 = 시야는 왼쪽·위를 더 본다).
 * 캔버스가 이미 대상을 다 담으면 `{ dx: 0, dy: 0 }`, 한 축만 벗어났으면 그 축만 보정한다.
 * 대상이 캔버스 안쪽보다 넓(높)어 잘릴 수 없으면 왼쪽(위) 모서리를 맞춘다.
 */
export function revealOffset(canvas: Rect, target: Rect, pad = 8): { dx: number; dy: number } {
  // 아직 그려지지 않은 곳(첫 페인트·jsdom)에서는 오프셋을 만들지 않는다
  if (canvas.right - canvas.left <= 0 || canvas.bottom - canvas.top <= 0) {
    return { dx: 0, dy: 0 }
  }

  // 캔버스 안쪽(여백 제외)보다 넓거나 높은 대상은 어느 쪽을 맞춰도 한쪽은 잘린다.
  // 이때는 늘 왼쪽·위 모서리를 맞춘다 — 오른쪽·아래를 맞추면 왼쪽 모서리가 잘려
  // 새 노드가 어디서 시작하는지 보이지 않는다(「+ 노드」 처럼 오른쪽에만 벗어나면서 더 넓은 노드).
  const innerWidth = canvas.right - canvas.left - pad * 2
  const innerHeight = canvas.bottom - canvas.top - pad * 2

  let dx = 0
  if (target.left < canvas.left + pad || target.right - target.left > innerWidth) {
    dx = canvas.left + pad - target.left
  } else if (target.right > canvas.right - pad) {
    dx = canvas.right - pad - target.right
  }

  let dy = 0
  if (target.top < canvas.top + pad || target.bottom - target.top > innerHeight) {
    dy = canvas.top + pad - target.top
  } else if (target.bottom > canvas.bottom - pad) {
    dy = canvas.bottom - pad - target.bottom
  }

  return { dx, dy }
}
