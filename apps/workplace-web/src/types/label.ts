// 라벨 관련 타입 — 백엔드 DTO 와 1:1 매칭.
// ColorToken 은 12색 화이트리스트로, 임의 색상 입력은 허용하지 않는다.

export const COLOR_TOKENS = [
  'GRAY',
  'RED',
  'ORANGE',
  'YELLOW',
  'GREEN',
  'TEAL',
  'CYAN',
  'BLUE',
  'INDIGO',
  'PURPLE',
  'PINK',
  'BROWN',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

// 프로젝트 라벨 단건 응답.
export interface LabelResponse {
  id: number;
  projectId: number;
  name: string;
  colorToken: ColorToken;
  createdAt: string;
  updatedAt: string;
}

// 이슈에 첨부된 라벨 요약 — IssueResponse 안에 embed.
export interface LabelSummary {
  id: number;
  name: string;
  colorToken: ColorToken;
}
