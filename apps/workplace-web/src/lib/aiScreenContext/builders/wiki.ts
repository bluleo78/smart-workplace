// 위키 화면 컨텍스트 builder(WP-54) — pageId/spaceId 는 get_wiki_page/list_wiki_pages 인자와 동일.
import type { AiScreenContext } from '@/types/aiScreenContext';

import { buildFacts, buildRefs, clip, fmtKst, LIMITS } from '../common';

/** 위키 화면 컨텍스트 생성 — page 가 null 이면 스페이스 루트(또는 페이지 미로딩)로 scope 만 싣는다. */
export function buildWikiContext(input: {
  spaceId: number;
  spaceName: string | null;
  page: { id: number; title: string; updatedAt: string } | null;
}): AiScreenContext {
  const scope = {
    label: clip(`위키 스페이스 ${input.spaceName ?? `#${input.spaceId}`}`, LIMITS.label),
    refs: buildRefs({ spaceId: input.spaceId }),
  };
  if (!input.page) return { view: '위키', scope };
  return {
    view: '위키 페이지',
    focus: {
      type: '위키 페이지',
      label: clip(input.page.title.trim() || '제목 없음', LIMITS.label),
      refs: buildRefs({ pageId: input.page.id }),
      facts: buildFacts([['수정', fmtKst(input.page.updatedAt)]]),
    },
    scope,
  };
}
