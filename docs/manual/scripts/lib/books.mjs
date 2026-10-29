// 매뉴얼 책(사용자·운영자) 설정. 빌드·검사·캡처 스크립트가 공통으로 읽는다.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 저장소 루트 절대 경로. 이 파일은 docs/manual/scripts/lib/ 에 있으므로 네 단계 위다.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

// dir·appFile·appSrc 는 저장소 루트 기준 상대 경로.
// parts 는 장(part) 번호 → 부 제목. 비어 있으면 그 책은 부 구분이 없고 프론트매터 part 도 요구하지 않는다.
export const BOOKS = {
  user: {
    key: 'user',
    title: 'Gen:iA Works 사용자 매뉴얼',
    subtitle: '사람과 AI 가 함께 일하는 업무 공간',
    dir: 'docs/manual/user',
    parts: { 1: '시작하기', 2: '앱', 3: '개인 설정', 4: '관리자 설정', 5: '참조' },
    appFile: 'apps/workplace-web/src/App.tsx',
    appSrc: 'apps/workplace-web/src',
    pdfName: 'genia-works-user-manual.pdf',
  },
  operator: {
    key: 'operator',
    title: 'Gen:iA Works 운영자 매뉴얼',
    subtitle: '플랫폼 운영(슈퍼어드민)',
    dir: 'docs/manual/operator',
    parts: {},
    appFile: 'apps/workplace-admin/src/App.tsx',
    appSrc: 'apps/workplace-admin/src',
    pdfName: 'genia-works-operator-manual.pdf',
  },
};

/** 책이 부(part) 구분을 쓰는지. 쓰면 장마다 프론트매터 part 가 필요하고 목차·본문에 부 속지가 들어간다. */
export function hasParts(book) {
  return Object.keys(book.parts).length > 0;
}

/**
 * 명령줄의 책 이름을 책 설정 목록으로 바꾼다(build·check·prose·capture 공용).
 * 이름이 없으면 all 이 true 일 때 모든 책, 아니면 user 한 권. 모르는 이름이면 허용 목록을 보이고 exit 2(사용법 오류).
 */
export function resolveBooks(name, { all = false } = {}) {
  if (!name) return all ? Object.values(BOOKS) : [BOOKS.user];
  if (!BOOKS[name]) {
    console.error(`알 수 없는 책: ${name} (허용: ${Object.keys(BOOKS).join(', ')})`);
    process.exit(2);
  }
  return [BOOKS[name]];
}
