// 에이전트 상세의 「활성 상태」·「역할 할당」(WP-1075) — 예전엔 구성원 › 사용자 상세에서만 다뤘다.
// 에이전트 목록 항목(AgentResponse)에는 역할이 없어 계정 상세(/users/:id)와 역할 목록을 따로 읽는다.
// 개인 비서(PERSONAL)는 주인 전용이라 부모(AgentManagementPage)가 그리지 않는다 — 이름·아이디 편집(AgentIdentitySection)과 같은 원칙.

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { rolesApi } from '../../../api/roles';
import { usersApi } from '../../../api/users';
import { Skeleton } from '../../../components/ui/skeleton';
import { agentKeys } from '../../../hooks/queries/useAgents';
import type { AgentResponse } from '../../../types/agent';
import { UserActiveSection, UserRolesSection } from './UserAccessSections';

// 다른 에이전트로 바뀌면 부모가 key 로 다시 마운트한다(안쪽 섹션의 선택·대화상자 상태도 함께 초기화).
// 계정 상세는 에이전트 목록 키(agentKeys.all) 아래에 둔다 — 삭제·이름 변경 등 에이전트 변경이 목록과 함께 무효화해 스위치와 배지가 어긋나지 않는다.
// 역할 목록은 역할 화면이 react-query 를 쓰지 않아 무효화할 길이 없으니 상세를 열 때마다 다시 읽는다(staleTime 0).
const accessKeys = {
  user: (id: number) => [...agentKeys.all, 'access', id] as const,
  roles: ['agent-access', 'roles'] as const,
};

export function AgentAccessSections({ agent }: { agent: AgentResponse }) {
  const qc = useQueryClient();
  const userQuery = useQuery({
    queryKey: accessKeys.user(agent.id),
    queryFn: () => usersApi.getUserById(agent.id).then((r) => r.data),
  });
  const rolesQuery = useQuery({
    queryKey: accessKeys.roles,
    queryFn: () => rolesApi.getRoles().then((r) => r.data),
    staleTime: 0,
  });

  if (userQuery.isError || rolesQuery.isError) {
    return (
      <p className="text-sm text-destructive" data-testid="agent-access-error">
        역할·활성 상태를 불러오지 못했습니다.
      </p>
    );
  }
  if (!userQuery.data || !rolesQuery.data) {
    return <Skeleton className="h-24 w-full" data-testid="agent-access-loading" />;
  }
  const user = userQuery.data;

  return (
    <div className="space-y-4" data-testid="agent-access-sections">
      <UserActiveSection
        user={user}
        // 공통 비서는 지정을 먼저 풀어야 끌 수 있다 — 지정을 둔 채 정지하면 공통 AI 대화가 정지된 AI 로 돈다(서버도 409).
        lockedReason={agent.type === 'WORKSPACE' ? '공통 비서는 지정을 해제한 뒤 비활성화할 수 있어요.' : undefined}
        // 에이전트 목록과 이 계정 상세(같은 agentKeys.all 아래)를 함께 다시 읽는다 — 스위치와 목록의 「비활성」 배지가 같은 응답에서 바뀐다.
        onChanged={() => void qc.invalidateQueries({ queryKey: agentKeys.all })}
      />
      <UserRolesSection
        user={user}
        allRoles={rolesQuery.data}
        onSaved={(updated) => qc.setQueryData(accessKeys.user(agent.id), updated)}
      />
    </div>
  );
}
