// 라벨 피커 검색·인라인 만들기 판정(WP-412) — LabelPickerPopover 에서 뺀 순수 함수(화면 없이 단위 테스트로 고정).

/** 검색어로 라벨을 거른다 — 부분 일치, 대소문자 무시(찾기는 관대하게). */
export function filterLabelsByName<T extends { name: string }>(labels: T[], search: string): T[] {
  const q = search.toLowerCase();
  return labels.filter((l) => l.name.toLowerCase().includes(q));
}

/**
 * 「라벨 만들기」로 만들 이름 — 만들 수 없으면 null.
 * 서버 유일 제약(project_id, name)이 대소문자를 구분하므로 정확 일치일 때만 「이미 있음」으로 본다
 * (그래서 「Bug」는 「bug」 가 있어도 새 라벨이고, 일부만 겹치는 이름도 만들 수 있다).
 */
export function labelNameToCreate(search: string, existing: { name: string }[]): string | null {
  const name = search.trim();
  if (name.length === 0 || existing.some((l) => l.name === name)) return null;
  return name;
}
