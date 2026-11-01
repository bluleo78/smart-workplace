// 첨부 미리 보기 화면 컨텍스트 builder(WP-1261) — 뷰어가 지금 보여 주는 항목 하나를 「파일」 대상으로 만든다.
// 뷰어는 overlay 층으로 등록해 페이지 컨텍스트(메일·이슈·채널) 위에 얹는다(store·overlayScreenContext).
// 식별자는 항목이 실은 aiRefs(AI 도구 인자명 그대로) — 없으면 이름·크기·형식만 알린다(추측할 id 를 보내지 않는다).
// 파일 크기는 드라이브 화면과 같은 포매터(formatFileSize)로 — 사용자와 AI 가 같은 표기를 본다.
import type { ViewerItem } from '@/components/viewer/types';
import { formatFileSize } from '@/lib/formatters';
import type { AiScreenContext } from '@/types/aiScreenContext';

import { buildFacts, buildRefs, clip, LIMITS } from '../common';

/** 미리 보는 항목 → 화면 컨텍스트(대상 = 파일). view 는 페이지가 없을 때만 쓰인다. */
export function buildViewerContext(item: Pick<ViewerItem, 'name' | 'mimeType' | 'sizeBytes' | 'aiRefs'>): AiScreenContext {
  return {
    view: '미리 보기',
    focus: {
      type: '파일',
      label: clip(item.name, LIMITS.label),
      refs: buildRefs(item.aiRefs ?? {}),
      facts: buildFacts([
        ['크기', item.sizeBytes != null ? formatFileSize(item.sizeBytes) : null],
        ['형식', item.mimeType],
      ]),
    },
  };
}
