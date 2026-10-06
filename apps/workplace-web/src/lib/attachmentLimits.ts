// 첨부 공용 한도 — 이슈 첨부·메인 AI 채팅 첨부(WP-234)가 같은 서버 상한(workplace.storage.attachment)을 쓰므로 한 곳에 둔다.
// API 클라이언트를 끌어오지 않는 순수 상수 모듈이라 lib 규칙·vitest 에서도 가볍게 import 한다.

/** 파일당 업로드 상한 — 서버 workplace.storage.attachment 와 같은 25MB. */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
