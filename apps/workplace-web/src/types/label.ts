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

// 색 견본의 한국어 이름 — 스크린리더·툴팁이 코드값(GRAY) 대신 읽는다(WP-849). 캘린더 팔레트(calendarPalette label)와 같은 말투.
export const COLOR_TOKEN_LABELS: Record<ColorToken, string> = {
  GRAY: '회색',
  RED: '빨강',
  ORANGE: '주황',
  YELLOW: '노랑',
  GREEN: '초록',
  TEAL: '청록',
  CYAN: '하늘',
  BLUE: '파랑',
  INDIGO: '남색',
  PURPLE: '보라',
  PINK: '분홍',
  BROWN: '갈색',
};

// 새 라벨 기본 색 — 설정 화면 기본 선택값이자 이슈 선택기에서 바로 만든 라벨의 색(WP-394).
export const DEFAULT_LABEL_COLOR: ColorToken = 'GRAY';

// 프로젝트 라벨 단건 응답.
export interface LabelResponse {
  id: number;
  projectId: number;
  name: string;
  colorToken: ColorToken;
  createdAt: string;
  updatedAt: string;
  // 요청자가 이 라벨을 수정·삭제할 수 있는지 — OWNER·ADMIN 또는 만든 멤버(WP-394). 구 서버 응답엔 없다(롤링 배포).
  viewerCanManage?: boolean;
}

// 이슈에 첨부된 라벨 요약 — IssueResponse 안에 embed.
export interface LabelSummary {
  id: number;
  name: string;
  colorToken: ColorToken;
}
