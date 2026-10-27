// 에픽 색(WP-1017) — 에픽마다 정한 색 토큰(라벨과 같은 12색)을 화면에 칠하는 공용 도우미.
// 서버는 새 에픽에 자동 색을 붙이고(IssueResponse.epicColor), 하위 이슈의 부모 요약은 parent.type.colorToken 에 이미 에픽 색을 실어 보낸다.
// 그래서 하위 쪽(ParentChip·목록 그룹 머리 등)은 그대로 parent.type.colorToken 을 쓰고, 에픽 행 자신만 여기서 epicColor 를 고른다.

import type { IssueResponse } from '../types/issue';
import type { IssueTypeSummary } from '../types/issueType';
import type { ColorToken } from '../types/label';
import { LABEL_COLORS } from './labelColors';

type EpicLike = Pick<IssueResponse, 'epicColor'> & { type?: IssueTypeSummary | null };

/** 에픽의 색 토큰 — 에픽 색이 있으면 그 색, 없으면(색을 정하기 전·구 서버 응답) 유형 색. 둘 다 없으면 undefined. */
export function epicColorToken(epic: EpicLike): string | undefined {
  return ownEpicColor(epic) ?? epic.type?.colorToken ?? undefined;
}

// 예전에 에픽이었던 이슈는 epic_color 가 남아 있다(IssueResponse.epicColor 주석) — 서버 부모 요약(parentTypeColor)처럼 지금 유형이 EPIC 일 때만 쓴다.
function ownEpicColor(epic: EpicLike): string | undefined {
  return epic.type?.name === 'EPIC' ? (epic.epicColor ?? undefined) : undefined;
}

/**
 * 유형 색을 에픽 색으로 바꾼 유형 요약 — 에픽 행으로 부모 요약(ParentRef)을 만들 때(낙관적 반영·AI 위임 작업 묶음 머리) 서버의 부모 요약과
 * 같은 색이 되게 한다. 유형이 없으면 null.
 */
export function epicTypeSummary(epic: EpicLike): IssueTypeSummary | null {
  if (!epic.type) return null;
  const color = ownEpicColor(epic);
  return color ? { ...epic.type, colorToken: color } : epic.type;
}

/** 색 토큰 → 색점(배경) 클래스. 모르는 토큰은 GRAY. 에픽 패널·시트·고르개의 ● 에 쓴다. */
export function epicDotClass(token: string | null | undefined): string {
  return (LABEL_COLORS[token as ColorToken] ?? LABEL_COLORS.GRAY).dot;
}
