// 에픽으로 바꿀 때 딸린 하위 태스크의 유형을 함께 바꾸는 흐름(WP-2098)의 순수 함수 모음.
// 왜: 에픽 아래에는 하위 태스크를 둘 수 없어, 바꿀 유형 후보·기본값·대상 자식을 화면과 분리해 판정한다.

import type { IssueResponse } from '@/types/issue';
import type { IssueTypeResponse } from '@/types/issueType';

/** 바꿀 유형 후보 — 프로젝트 유형 중 EPIC·SUBTASK 를 뺀 것(원래 순서). 서버 규칙과 같다. */
export function convertTargetTypes(types: IssueTypeResponse[]): IssueTypeResponse[] {
  return types.filter((t) => t.name !== 'EPIC' && t.name !== 'SUBTASK');
}

/** 기본 선택 유형 id — TASK, 없으면 첫 후보, 후보가 없으면 undefined. */
export function defaultConvertTypeId(types: IssueTypeResponse[]): number | undefined {
  const candidates = convertTargetTypes(types);
  return (candidates.find((t) => t.name === 'TASK') ?? candidates[0])?.id;
}

/** 자식 중 하위 태스크(SUBTASK)만 — 유형 변경 대상이다. */
export function subtaskChildrenOf(children: IssueResponse[]): IssueResponse[] {
  return children.filter((c) => c.type?.name === 'SUBTASK');
}
