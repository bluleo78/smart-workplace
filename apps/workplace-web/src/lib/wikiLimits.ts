// 노트(위키) 입력 한도 — 서버 검증과 같은 값을 화면 여러 곳이 함께 쓴다.

/** 노트 제목 최대 길이 — 서버 CreatePageRequest 의 @Size(max = 255). 넘기면 400 이라 입력·자동 제목을 여기서 자른다. */
export const WIKI_TITLE_MAX = 255
