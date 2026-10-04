// ai-agent HTTP 서버 공용 설정 상수 — index.ts 는 import 시 서버를 띄우므로 테스트가 참조할 값만 분리한다.
// WP-232: 메인 AI 채팅 이력이 최대 128k 토큰(한글 기준 UTF-8 수백 KB)까지 실려 오므로 express 기본 100kb 로는 413 이 난다.
export const JSON_BODY_LIMIT = '4mb';
