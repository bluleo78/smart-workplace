// 멘션 후보용 워크스페이스 AGENT 유저. 채널 비멤버 AGENT 도 @멘션→자동 멤버추가 가능하도록 노출.
//
// #833: 계정 관리 API(/users, user:read = ADMIN 전용) 대신 구성원 디렉터리(/members)를 쓴다. @멘션
// 후보를 고르는 일은 디렉터리 조회이지 계정 관리가 아니며, 이전 구현은 일반 구성원에게 403 이었다.
// kind=AGENT 는 서버에서 거르므로 클라이언트 필터가 필요 없다.
import { useQuery } from '@tanstack/react-query';

import type { MentionCandidate } from '@/components/mentions/types';

import { membersApi } from '../../api/members';

export const mentionAgentKeys = {
  all: ['mention-agents'] as const,
};

export function useMentionAgents() {
  return useQuery<MentionCandidate[]>({
    queryKey: mentionAgentKeys.all,
    queryFn: async () => {
      // WP-183: 한 페이지(100건)에서 끊지 않고 마지막 페이지까지 모두 받는다 — 101번째 에이전트부터 멘션 후보에서
      // 조용히 빠지지 않게. 에이전트 수는 많지 않아 보통 한 번 요청으로 끝난다.
      const agents = [];
      for (let page = 0; ; page++) {
        const { data } = await membersApi.getMembers({ kind: 'AGENT', page, size: 100 });
        agents.push(...data.content);
        if (page + 1 >= data.totalPages) break;
      }
      return agents.map((m) => ({
        userId: m.userId,
        username: m.username,
        name: m.name,
        kind: 'AGENT' as const,
      }));
    },
    staleTime: 60_000,
  });
}
