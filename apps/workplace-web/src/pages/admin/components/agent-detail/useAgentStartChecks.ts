// 에이전트 「실행 전 확인」 계산(WP-1511) — 예전엔 상태 섹션의 RunGroup 안에 있던 값들을 훅으로 옮겼다.
// 화면의 확인 목록·시작 단추와 AI 화면 참고(「실행 전 확인」 근거)가 같은 판정을 쓰게 한 곳에 둔다. 새로 받는 것은 없다 —
// 같은 react-query 키라 RunGroup 과 함께 불러도 다시 받지 않는다.

import { useAgentBoundAccount } from '../../../../hooks/queries/useAgentAccounts';
import { useAgentProviderCredentialMeta } from '../../../../hooks/queries/useAgentProviderCredential';
import { useAgentLocations, useAgentRepoCredentials, useAgentRuntimeProjects } from '../../../../hooks/queries/useAgentRuntime';
import { accountFits } from '../../../../lib/agentAccount';
import { type AccountCheck, startBlockReason } from '../../../../lib/agentRunMode';
import { freeSeats } from '../../../../lib/agentRuntimeStatus';
import { failedWithoutData } from '../../../../lib/queryFailure';
import { missingRepoHosts as missingHostsOf } from '../../../../lib/repoHosts';
import type { AgentResponse } from '../../../../types/agent';
import type { WorksRun } from './AgentStatusSection';

/**
 * 실행 전 확인 계산 — AI 계정(템플릿이 쓰는 종류로 연결됐는지, WP-1296)·맡는 프로젝트·실행 환경 여유.
 * blockReason 은 시작을 막는 첫 이유(없으면 null), 나머지는 확인 목록이 그리는 값이다.
 * run 이 null(Works 가 실행하지 않거나 실행 설정을 못 받음)이면 훅은 그대로 부르되 조회를 모두 끈다 —
 * 훅은 조건부로 부를 수 없어서, 상세 화면이 한 번만 불러 근거를 얻을 수 있게 한 것이다(받지 못한 값은 싣지 않는다).
 */
export function useAgentStartChecks(agent: AgentResponse, run: WorksRun | null) {
  const template = run?.template ?? null;
  const saved = run?.saved ?? null;
  const draft = run?.draft ?? null;
  const active = run != null;
  const locations = useAgentLocations(active);
  const projects = useAgentRuntimeProjects(agent.id, active);
  const credential = useAgentProviderCredentialMeta(active ? agent.id : null);
  // 계정 목록에서 고른 계정(WP-1451) — runner 는 묶인 계정을 AI 의 옛 연결보다 먼저 쓴다(서버 requireLoginAccount 와 같은 판정).
  // 템플릿이 계정을 쓰지 않으면 확인할 것이 없으니 받지 않는다(아래 accountCheck 도 그때는 판정하지 않는다).
  const bound = useAgentBoundAccount(template?.account ? agent.id : null);
  const needsRepos = template?.requires.includes('repo') ?? false;
  const repoCredentials = useAgentRepoCredentials(agent.id, active && needsRepos);
  // 실행 전 확인 — AI 계정(템플릿이 쓰는 종류로 연결됐는지, WP-1296)·맡는 프로젝트·실행 환경 여유.
  const defaultLocation = locations.data?.find((l) => l.isDefault) ?? null;
  // 초안이 있으면 초안 값 그대로 — 초안의 null 은 「워크스페이스 기본」이라 ?? 로 저장값에 떨어지면 안 된다.
  const locationId = draft ? draft.locationId : (saved?.locationId ?? null);
  const target = locationId == null ? defaultLocation : (locations.data?.find((l) => l.id === locationId) ?? null);
  const account = template?.account ?? null;
  // 템플릿이 요구하는 계정이 있을 때만 확인한다 — 맞는지는 공용 규칙(accountFits) 하나로 본다.
  // 묶인 계정이 있으면 그것만 본다(맞지 않아도 옛 연결로 내려가지 않는다). 옛 연결로 내려가는 것은 묶인 계정 조회가 「없음(404 → null)」으로
  // 끝났을 때뿐이다 — 받는 중이면 아직 모르고(어긋남 안내를 띄우지 않는다), 404 가 아닌 오류면 옛 연결로 판정하지 않고 「불러오지 못했어요」만 보인다.
  // 계정이 필요 없는 방식이면 꺼 둔 조회가 늘 pending 이라 「확인하고 있어요」에 머물지 않게 판정하지 않는다(null).
  // 앞서 받은 값이 있으면 그 뒤 다시 받기가 실패해도 그 값으로 판정한다 — 실패는 값 없이 실패했을 때(다시 부르는 중 포함)만.
  const accountCheck: AccountCheck =
    account == null ? null : failedWithoutData(bound) ? 'error' : bound.isPending ? 'loading' : null;
  const connected = accountCheck != null ? undefined : bound.data ? bound.data.provider : credential.data?.provider;
  const accountOk = account != null && connected != null && template != null && accountFits(connected, { mode: 'WORKSPACE', template });
  const projectCount = projects.data?.length ?? 0;
  // 맡는 프로젝트 저장소 호스트 중 토큰이 없는 것(WP-1268) — 두 목록을 다 받은 뒤에만 판정해 로딩 중에 잠깐 「빠짐」으로 깜박이지 않게.
  const missingRepoHosts = needsRepos && projects.data && repoCredentials.data ? missingHostsOf(projects.data, repoCredentials.data) : [];
  const seatOk = target != null && freeSeats(target) > 0;
  const blockReason = startBlockReason({
    account,
    accountOk,
    accountCheck,
    needsRepos,
    missingRepoHosts,
    projectCount,
    hasLocation: (locations.data?.length ?? 0) > 0,
    seatOk,
    missingRequired: draft?.missingRequired ?? false,
    inactive: !agent.isActive,
  });
  return {
    blockReason,
    projects,
    account,
    accountCheck,
    accountOk,
    connected,
    needsRepos,
    missingRepoHosts,
    projectCount,
    seatOk,
    target,
  };
}
