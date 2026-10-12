// 드롭 대상 공용 표시 클래스 — 이슈 에픽 패널·드라이브 폴더 행/경로가 같은 시각 규칙을 쓴다.
// 점선=놓을 수 있음, 실선+진한 배경=지금 놓으면 여기로, 흐림=놓을 수 없음(현재 위치·차단).
// 점선은 알파 없는 outline-primary — /60 은 비텍스트 대비 3:1 미달(라이트 ~2.96, 다크 ~2.76). 오버와는 선 모양·두께·배경으로 구분.
export const DROP_TARGET_CLASS = {
  allowed: 'outline-dashed outline-1 -outline-offset-1 outline-primary bg-primary/5',
  over: 'outline outline-2 -outline-offset-2 outline-primary bg-primary/15',
  dimmed: 'opacity-50',
} as const
