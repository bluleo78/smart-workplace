// 드라이브 화면 컨텍스트 builder(WP-54). 폴더는 list_drive_items 인자명 parentId 로 보낸다.
// WP-379: app 은 홈 채팅 메모리 범위 선택용(서버로 보내는 screenContext 에선 빠진다).
import type { AiScreenContext } from '@/types/aiScreenContext';

import { buildFacts, buildRefs, clip, LIMITS } from '../common';

/** 드라이브 화면 — 스페이스/폴더 scope. 미리 보는 파일(focus)은 첨부 뷰어가 overlay 로 얹는다(WP-1261, builders/viewer).
 *  folderCount/fileCount 는 목록 조회 전이면 null — 미로드 값은 보내지 않는다(항목 fact 생략). */
export function buildDriveContext(input: {
  spaceId: number;
  spaceName: string | null;
  folderId: number | null;
  folderPath: string[];
  q: string;
  folderCount: number | null;
  fileCount: number | null;
}): AiScreenContext {
  const path = [input.spaceName ?? `#${input.spaceId}`, ...input.folderPath].join(' / ');
  // 검색 중에는 화면이 검색 결과라 폴더 목록 개수와 다르다 — 개수 fact 생략.
  const counts =
    !input.q && input.folderCount != null && input.fileCount != null ? `폴더 ${input.folderCount} · 파일 ${input.fileCount}` : null;
  return {
    view: '드라이브',
    app: 'DRIVE',
    scope: {
      label: clip(`드라이브 ${path}`, LIMITS.label),
      refs: buildRefs({ spaceId: input.spaceId, parentId: input.folderId }),
      facts: buildFacts([['검색어', input.q], ['항목', counts]]),
    },
  };
}
