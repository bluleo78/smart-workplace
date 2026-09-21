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
      const res = await membersApi.getMembers({ kind: 'AGENT', size: 100 });
      return res.data.content.map((m) => ({
        userId: m.userId,
        username: m.username,
        name: m.name,
        kind: 'AGENT' as const,
      }));
    },
    staleTime: 60_000,
  });
}
