// 쓰기 응답(POST·PATCH)을 캐시에 넣을 때 링크 미리보기를 지키는 공용 규칙(WP-874).
// 미리보기는 messaging.message.link-previews SSE 가 진실원이다 — REST 응답은 미리보기를 (다시) 가져오기 전 상태라,
// 캐시에 같은 id 메시지가 이미 있으면 그 linkPreviews 를 남긴다(SSE 가 응답보다 먼저 왔을 때 덮어쓰지 않게).
import type { QueryClient } from '@tanstack/react-query';

import type { MessageResponse } from '../../types/messaging';
import { findMessageInCache } from './useToggleReaction';

/** 서버 응답 saved 에 캐시의 linkPreviews 를 얹어 돌려준다. 캐시에 없으면(첫 반영) 응답 그대로. */
export function withLatestLinkPreviews(qc: QueryClient, channelId: number, saved: MessageResponse): MessageResponse {
  const cached = findMessageInCache(qc, channelId, saved.id)?.linkPreviews;
  return cached ? { ...saved, linkPreviews: cached } : saved;
}
