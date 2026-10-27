// 모바일 에픽 선택 시트의 값 변환(WP-1039) — 상세·생성 칩의 에픽 시트(EpicPickerSheet)와 행 메뉴 시트(useIssueRowActions)가 같은 값·문구를 쓴다.
// 「에픽 없음」 값(NO_EPIC_OPTION)은 시트 안에서만 쓰고, 밖으로는 null 로 주고받는다.

import { isHiddenParent, parentProjectKey, type ParentTargetInput } from '../../../../lib/parentRef';
import type { ParentRef } from '../../../../types/issue';

/** 에픽 시트의 「에픽 없음」 옵션 값 — 에픽 번호(양의 정수)와 겹치지 않는 문자열. 시트 밖으로는 null 로 주고받는다. */
const NO_EPIC_OPTION = 'none';

/** 에픽 시트 「에픽 없음」 줄 — 상세·생성 칩의 시트와 행 메뉴(useIssueRowActions)의 시트가 같은 값·문구를 쓴다. */
export const NO_EPIC_SHEET_OPTION = { value: NO_EPIC_OPTION, label: '에픽 없음' };

/** 에픽 시트에서 고른 값 → 이 프로젝트 에픽 번호(null = 에픽 없음). */
export function epicFromSheetValue(v: string): number | null {
  return v === NO_EPIC_OPTION ? null : Number(v);
}

/**
 * 에픽 시트의 체크 값(WP-1039) — 지금 고른 에픽(부모)을 시트 값으로 바꾼다. 없으면 「에픽 없음」, 이 프로젝트 에픽이면 그 번호 줄,
 * 다른 프로젝트·가려진 에픽이면 체크 없음(null — 이 프로젝트 줄 어디에도 해당하지 않고 「에픽 없음」도 아니다).
 */
export function epicSheetValue(
  selected: Pick<ParentRef, 'projectKey' | 'number' | 'hidden'> | null | undefined,
  projectKey: string,
): string | null {
  if (selected == null) return NO_EPIC_OPTION;
  if (isHiddenParent(selected) || parentProjectKey(selected, projectKey) !== projectKey) return null;
  return String(selected.number);
}

/** 에픽 시트에서 고른 에픽 — 이 프로젝트 에픽은 projectKey 없이, 다른 프로젝트 에픽은 그 키와 함께. 제목은 칩 글자(생성 폼)용. */
export type EpicSheetTarget = ParentTargetInput & { projectKey?: string; title: string };
