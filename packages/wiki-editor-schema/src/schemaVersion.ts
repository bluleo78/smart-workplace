/**
 * 노트 문서 스키마 판(WP-313) — 웹 에디터와 동기화 서버가 같은 스키마로 붙어 있는지 접속 때 맞춰 본다.
 *
 * 왜: y-prosemirror 는 자기 스키마에 없는 마크·노드가 든 Y 항목을 만나면 그 항목을 지우고, 그 삭제가 모든 접속자에게 퍼진다.
 * 스키마를 바꾼 배포 전에 열어 둔 탭(예: link 마크가 없는 탭)이 붙으면 새 서식 글자가 통째로 사라진다.
 * 그래서 판이 다르면 동기화 서버가 문서를 주기 전에 거부하고, 웹은 새로고침을 안내한다.
 *
 * 규칙: 공용 스키마(노드·마크 이름, attrs, content 규칙)를 바꾸면 반드시 1 올린다.
 * 지문 기록(schemaFingerprint.ts)과 가드 테스트(패키지 schemaVersion.test.ts·웹 wikiEditorExtensions.test.ts)가 판을 올리지 않은 스키마 변경을 잡는다.
 * 의존성 없는 모듈이라 웹은 collab-protocol subpath 로 tiptap 없이 가져간다.
 */
export const WIKI_SCHEMA_VERSION = 1
