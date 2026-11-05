// 라벨 피커 검색·인라인 만들기 판정(WP-412) — LabelPickerPopover 에서 뺀 순수 함수(화면 없이 단위 테스트로 고정).

import { normalizeSingleLine } from '@/lib/visibleText';

/** 검색어로 라벨을 거른다 — 부분 일치, 대소문자 무시(찾기는 관대하게). */
export function filterLabelsByName<T extends { name: string }>(labels: T[], search: string): T[] {
  const q = search.toLowerCase();
  return labels.filter((l) => l.name.toLowerCase().includes(q));
}

/**
 * 「라벨 만들기」로 만들 이름 — 만들 수 없으면 null.
 * 이름은 서버 `SingleLineTitles.normalize` 와 같게 다듬고(normalizeSingleLine), 서버 유일 제약(project_id, lower(name), WP-911)처럼
 * 대소문자를 무시해 같은 이름이 있으면 「이미 있음」으로 본다 — 「Bug」 가 있을 때 「bug」 를 만들면 409 였다.
 * 그래서 이미 있는 쉼표 라벨을 다른 대소문자로 쳐도 만들기 행·쉼표 오류(WP-1386)가 뜨지 않고 목록의 그 라벨을 고른다. 일부만 겹치는 이름은 만들 수 있다.
 * 데스크톱 선택기(LabelPickerPopover)와 모바일 라벨 시트(MobileMultiPickerSheet 의 createName)가 같이 쓴다.
 */
export function labelNameToCreate(search: string, existing: { name: string }[]): string | null {
  const name = normalizeSingleLine(search);
  if (name.length === 0 || existing.some((l) => sameLabelName(l.name, name))) return null;
  return name;
}

/** 라벨 이름이 같은가 — 대소문자 무시(서버 유일 인덱스 lower(name) 과 같은 기준, WP-911). */
function sameLabelName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
