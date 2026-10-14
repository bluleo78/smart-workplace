// WP-384 지난 대화 검색 — 메인 AI 채팅 라우터 전용 로컬 읽기 도구(공유 패키지·외부 MCP 에는 없다).
// API /home/sessions/search 를 요청자 대행(Internal + X-On-Behalf-Of)으로 부른다. 지금 대화는 도구가 묶어 빼고(모델이 고르지 못한다),
// 결과 줄의 [제목](/?chat=<id>) 를 AI 가 출처 링크로 그대로 붙인다 — 웹이 이 링크를 같은 탭 딥링크로 연다.
import type { McpTool } from '@smart-workplace/mcp-tools-shared';
import { z } from 'zod';

import type { ConversationHitDto, WorkplaceApiClient } from '../clients/workplace-api.js';
import { oneLine } from '../agent/memory-block.js';
import { isEndpointMissing, SEARCH_RESULT_IS_DATA } from './memory-tools.js';

/** 메모리 꺼짐 — 지난 대화 검색도 메모리 설정에 묶여 있다(스펙 5). */
export const CONVERSATION_SEARCH_OFF = '메모리가 꺼져 있어 지난 대화를 찾을 수 없다 — 기억나는 척하지 말 것';

/** 구 API(검색 엔드포인트 없음 — 404·405). 채팅을 끊지 않고 결과로 알린다. */
export const CONVERSATION_SEARCH_UNAVAILABLE = '지금은 지난 대화 찾기를 쓸 수 없다';

export const searchConversationsInput = z.object({
  query: z.string().trim().min(1).describe('찾을 말 — 지난 대화의 주제 낱말(예: "보고서 마감", "결제 모듈 배포 순서")'),
  limit: z.number().int().min(1).max(10).optional().describe('최대 대화 수(기본 5, 최대 10)'),
});

const DEEP_LINK = /^\/\?chat=[0-9A-Za-z-]+$/;
const SEOUL_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' });

/** 링크 텍스트용 제목 — 마크다운 링크를 깨는 대괄호를 지우고, 비면 "제목 없는 대화". */
function linkTitle(title: string | null): string {
  const t = oneLine((title ?? '').replace(/[[\]]/g, ''));
  return t || '제목 없는 대화';
}

/** 서버 링크가 딥링크 모양이면 그대로, 아니면 sessionId 로 다시 만든다(엉뚱한 링크를 출처로 싣지 않게). */
function linkOf(h: ConversationHitDto): string {
  return DEEP_LINK.test(h.link) ? h.link : `/?chat=${encodeURIComponent(h.sessionId)}`;
}

function hitLines(h: ConversationHitDto, n: number): string[] {
  const date = SEOUL_DATE.format(new Date(h.lastMessageAt));
  return [
    `${n}. [${linkTitle(h.title)}](${linkOf(h)}) · ${date}`,
    ...(h.question ? [`   질문: ${oneLine(h.question)}`] : []),
    ...(h.answerExcerpt ? [`   답: ${oneLine(h.answerExcerpt)}`] : []),
  ];
}

/**
 * search_conversations(WP-384). onBehalfOfId = 요청자(사람), homeSessionId = 지금 대화(있으면 결과에서 뺀다).
 * 404·405(구 API)는 "쓸 수 없음" 결과로, 그 밖의 오류는 던진다 — 어댑터가 도구 오류로 돌려준다.
 */
export function buildConversationSearchTool(
  client: WorkplaceApiClient,
  onBehalfOfId: number,
  homeSessionId?: string,
): McpTool {
  return {
    name: 'search_conversations',
    description:
      '사용자와 나눈 지난 대화에서 관련 있는 것을 찾습니다. "지난번에", "예전에 얘기한", "저번 대화" 같은 요청이나 기억에 없는 이전 합의·결정을 물을 때 씁니다. 지금 대화는 빼고 찾습니다. 결과의 [제목](링크) 를 답에 출처로 붙이세요.',
    inputSchema: searchConversationsInput,
    annotations: { readOnlyHint: true },
    async handler(args) {
      const p = searchConversationsInput.parse(args);
      let r;
      try {
        r = await client.searchConversations(onBehalfOfId, {
          q: p.query,
          ...(homeSessionId ? { excludeSessionId: homeSessionId } : {}),
          ...(p.limit ? { limit: p.limit } : {}),
        });
      } catch (e) {
        if (isEndpointMissing(e)) return CONVERSATION_SEARCH_UNAVAILABLE;
        throw e;
      }
      if (!r.memoryEnabled) return CONVERSATION_SEARCH_OFF;
      if (r.items.length === 0) return `"${p.query}" 관련 지난 대화를 찾지 못했다.`;
      return [
        `"${p.query}" 관련 지난 대화 ${r.items.length}개 — 답에 쓴 대화는 결과의 [제목](링크) 를 그대로 붙여 출처를 밝힌다. ${SEARCH_RESULT_IS_DATA}:`,
        ...r.items.flatMap((h, i) => hitLines(h, i + 1)),
      ].join('\n');
    },
  };
}
