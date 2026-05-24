// 이슈 유형 (Issue Type) 관련 타입 — 백엔드 IssueType DTO 와 1:1 매칭.
// 아이콘은 lucide-react 의 8종 화이트리스트로 제한된다.

export const ICON_NAMES = [
  'Circle',
  'Bug',
  'BookOpen',
  'Wrench',
  'Star',
  'Zap',
  'Flag',
  'Target',
  // SUBTASK 시스템 유형 전용 아이콘 (Phase 4a).
  'CornerDownRight',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

// 이슈 응답에 embed 되는 유형 요약.
export interface IssueTypeSummary {
  id: number;
  name: string;
  colorToken: string;
  icon: IconName;
}

// 정의 단건 응답 — 설정/관리 화면에서 사용.
export interface IssueTypeResponse {
  id: number;
  projectId: number;
  name: string;
  colorToken: string;
  icon: IconName;
  isSystem: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}
