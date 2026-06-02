// 멘션 후보용 워크스페이스 AGENT 유저. 채널 비멤버 AGENT 도 @멘션→자동 멤버추가 가능하도록 노출.
import { useQuery } from '@tanstack/react-query';

import { usersApi } from '../../api/users';
import type { MentionCandidate } from '@/components/mentions/types';

export const mentionAgentKeys = {
  all: ['mention-agents'] as const,
};

export function useMentionAgents() {
  return useQuery<MentionCandidate[]>({
    queryKey: mentionAgentKeys.all,
    queryFn: async () => {
      const res = await usersApi.getUsers({ size: 100 });
      return res.data.content
        .filter((u) => u.kind === 'AGENT')
        .map((u) => ({
          userId: u.id,
          username: u.username,
          name: u.name,
          kind: 'AGENT' as const,
        }));
    },
    staleTime: 60_000,
  });
}
