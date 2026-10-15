// 프로젝트별 커스텀 필드 — 5 가지 타입의 JSONB 값을 정의/저장한다 (Phase 4c).
// 백엔드 dto (IssueFieldDef/IssueFieldEntry) 와 1:1 매칭.

export const FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'MULTI_SELECT'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

// 영문 enum → 한국어 레이블 매핑 (UI 표시용) — 설정 화면 필드 목록·타입 셀렉트가 공유한다.
export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  TEXT: '텍스트',
  NUMBER: '숫자',
  DATE: '날짜',
  SELECT: '선택',
  MULTI_SELECT: '복수 선택',
};

// 프로젝트 단위 커스텀 필드 정의. SELECT/MULTI_SELECT 만 options 사용.
export interface IssueFieldDef {
  id: number;
  projectId: number;
  name: string;
  type: FieldType;
  options: string[] | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

// 이슈 응답에 임베드되는 단일 필드 값.
// value 의 실제 모양은 type 에 따라 string|number|string[] 로 달라진다 — 위젯이 분기 처리.
export interface IssueFieldEntry {
  defId: number;
  name: string;
  type: FieldType;
  value: unknown;
}
