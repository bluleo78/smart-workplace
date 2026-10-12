// 파일 이름 보조 함수(WP-335).

/** 확장자 앞까지의 길이 — 마지막 점 앞까지. 점이 없거나 맨 앞 점(.env 같은 숨김 파일)뿐이면 전체 길이. 이름 변경 칸의 초기 선택 범위로 쓴다. */
export function fileStemLength(name: string): number {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? dot : name.length
}
