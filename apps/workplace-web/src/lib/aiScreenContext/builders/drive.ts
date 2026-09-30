// 드라이브 화면 컨텍스트 builder(WP-54). 파일은 drive_file id(driveFileId) — core fileId 는 보내지 않는다.
// 폴더는 list_drive_items 인자명 parentId 로 보낸다.
// 파일 크기는 드라이브 화면과 같은 포매터(formatFileSize)로 — 사용자와 AI 가 같은 표기를 본다.
import { formatFileSize } from '@/lib/formatters';
import type { AiScreenContext } from '@/types/aiScreenContext';

import { buildFacts, buildRefs, clip, fmtKst, LIMITS } from '../common';

/** 드라이브 화면 — 스페이스/폴더 scope + (미리보기가 열린 경우) 파일 focus.
 *  folderCount/fileCount 는 목록 조회 전이면 null — 미로드 값은 보내지 않는다(항목 fact 생략). */
export function buildDriveContext(input: {
  spaceId: number;
  spaceName: string | null;
  folderId: number | null;
  folderPath: string[];
  q: string;
  folderCount: number | null;
  fileCount: number | null;
  preview: { id: number; name: string; size: number | null; updatedAt: string | null } | null;
}): AiScreenContext {
  const path = [input.spaceName ?? `#${input.spaceId}`, ...input.folderPath].join(' / ');
  // 검색 중에는 화면이 검색 결과라 폴더 목록 개수와 다르다 — 개수 fact 생략.
  const counts =
    !input.q && input.folderCount != null && input.fileCount != null ? `폴더 ${input.folderCount} · 파일 ${input.fileCount}` : null;
  const ctx: AiScreenContext = {
    view: '드라이브',
    scope: {
      label: clip(`드라이브 ${path}`, LIMITS.label),
      refs: buildRefs({ spaceId: input.spaceId, parentId: input.folderId }),
      facts: buildFacts([['검색어', input.q], ['항목', counts]]),
    },
  };
  const p = input.preview;
  if (p) {
    ctx.focus = {
      type: '파일',
      label: clip(p.name, LIMITS.label),
      refs: buildRefs({ driveFileId: p.id }),
      facts: buildFacts([['크기', p.size != null ? formatFileSize(p.size) : null], ['수정', p.updatedAt ? fmtKst(p.updatedAt) : null]]),
    };
  }
  return ctx;
}
