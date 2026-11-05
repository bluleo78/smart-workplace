// 라벨 이름 검증(WP-1386) — 백엔드 LabelService.COMMA_MESSAGE 와 같은 규칙·문구.
// 이슈 목록 필터 `label=` 이 값을 쉼표로 나눈 이름 목록으로 읽어(서버 SearchParams.csv), 이름에 쉼표가 든 라벨은 이름으로 찾을 수 없었다.
// 그래서 새로 만들거나 이름을 바꿀 때 ASCII 쉼표를 막는다. 구분자가 아닌 전각 쉼표(，)는 막지 않는다.

import { normalizeSingleLine } from '@/lib/visibleText';

/** 쉼표가 든 라벨 이름에 보이는 문구 — 서버 400 문구와 같다. */
export const LABEL_NAME_COMMA_MESSAGE = '라벨 이름에는 쉼표(,)를 쓸 수 없습니다';

/**
 * 새로 만들 라벨 이름의 오류 문구 — 쓸 수 있으면 null. 화면은 이 문구를 입력칸 아래에 보이고 요청을 보내지 않는다.
 * 빈 이름·40자 상한은 화면마다 이미 막으므로(빈 값 무시·maxLength) 여기서는 쉼표만 본다.
 */
export function labelNameError(name: string): string | null {
  return name.includes(',') ? LABEL_NAME_COMMA_MESSAGE : null;
}

/**
 * 라벨 이름 변경의 오류 문구 — 지금 이름 그대로면 쉼표가 있어도 null.
 * 이미 있는 쉼표 라벨은 이관하지 않으므로 편집 창에서 색만 바꿔 저장(이름도 함께 보냄)은 되게 한다(서버 update 와 같은 규칙).
 * 「그대로」는 서버가 저장 전에 다듬는 것(SingleLineTitles.normalize — 앞뒤 보이지 않는 글자·줄바꿈 등)과 같은 normalizeSingleLine 으로 비교한다.
 */
export function labelRenameError(name: string, currentName: string): string | null {
  return normalizeSingleLine(name) === currentName ? null : labelNameError(name);
}
