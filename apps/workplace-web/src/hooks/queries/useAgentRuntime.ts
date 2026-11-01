// AI 실행(WP-1245) 조회·변경 훅 — 템플릿·AI 실행 설정·목록 요약·맡는 프로젝트·실행 위치.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  type AgentRuntimeAction,
  createAgentLocation,
  deleteAgentLocation,
  deleteAgentRuntimeSetting,
  getAgentRuntimeSetting,
  listAgentLocations,
  listAgentRuntimeProjects,
  listAgentRuntimeSummaries,
  listAgentTemplates,
  putAgentRuntimeSetting,
  rotateAgentLocationToken,
  runAgentRuntimeAction,
  setDefaultAgentLocation,
  updateAgentLocation,
} from '../../api/agentRuntime';
import { setAgentRuntime } from '../../api/agents';
import { handleApiError } from '../../lib/api-error';
import type { PutAgentRuntimeSettingRequest } from '../../types/agentRuntime';
import { agentRuntimeKeys, agentRuntimeLiveKeys } from './agentRuntimeKeys';
import { agentKeys } from './useAgents';

export { agentRuntimeKeys };

// 템플릿은 코드에 묶여 릴리스 때만 바뀐다 — 길게 캐시한다.
export function useAgentTemplates() {
  return useQuery({ queryKey: agentRuntimeKeys.templates, queryFn: listAgentTemplates, staleTime: 10 * 60_000 });
}

export function useAgentRuntimeSetting(userId: number) {
  return useQuery({ queryKey: agentRuntimeKeys.setting(userId), queryFn: () => getAgentRuntimeSetting(userId) });
}

export function useAgentRuntimeProjects(userId: number) {
  return useQuery({ queryKey: agentRuntimeKeys.projects(userId), queryFn: () => listAgentRuntimeProjects(userId) });
}

export function useAgentRuntimeSummaries() {
  return useQuery({ queryKey: agentRuntimeKeys.summaries, queryFn: listAgentRuntimeSummaries });
}

// 연결 상태는 runner 의 마지막 소식으로 서버가 읽을 때 계산한다(알림이 없다) — 열린 화면만 다시 읽는다.
// 설치 대기인 위치가 있으면 설치 직후 「연결됨」이 빨리 보이게 10초, 아니면 끊김을 잡으러 1분마다.
export function useAgentLocations(enabled = true) {
  return useQuery({
    queryKey: agentRuntimeKeys.locations,
    queryFn: listAgentLocations,
    enabled,
    refetchInterval: (q) => (q.state.data?.some((l) => l.connection === 'PENDING') ? 10_000 : 60_000),
  });
}

// 설정·상태가 바뀌면 상세·목록 요약·위치 자리 수·에이전트 목록(실행 방식)을 함께 다시 읽는다(템플릿 캐시는 둔다).
function useInvalidateRuntime() {
  const qc = useQueryClient();
  return () => {
    for (const queryKey of agentRuntimeLiveKeys) void qc.invalidateQueries({ queryKey });
    void qc.invalidateQueries({ queryKey: agentKeys.all });
  };
}

export function useSaveAgentRuntimeSetting(userId: number) {
  const invalidate = useInvalidateRuntime();
  return useMutation({
    mutationFn: (body: PutAgentRuntimeSettingRequest) => putAgentRuntimeSetting(userId, body),
    onSuccess: invalidate,
    onError: (e) => handleApiError(e, '실행 설정을 저장하지 못했습니다'),
  });
}

// 실행 설정을 지우고 실행 방식을 정한다 — 요청 하나로(둘로 나누면 중간에 실패할 때 설정만 지워진 채 남는다).
// 「기본」 카드: 실행 방식을 INTERNAL 로 — 서버(AgentRuntimeInternalSwitchGuard)가 같은 트랜잭션에서 설정을 지운다.
// 외부: 작업 공간 AI 는 DB 에 이미 EXTERNAL 이라 설정만 지운다(INTERNAL 을 거치면 그 사이 서버 AI 가 이슈를 가져간다).
export function useUseServerTemplate(userId: number) {
  const invalidate = useInvalidateRuntime();
  return useMutation({
    mutationFn: (runtime: 'INTERNAL' | 'EXTERNAL') =>
      runtime === 'INTERNAL' ? setAgentRuntime(userId, 'INTERNAL') : deleteAgentRuntimeSetting(userId),
    onSuccess: invalidate,
    onError: (e, runtime) =>
      handleApiError(e, runtime === 'EXTERNAL' ? '외부로 바꾸지 못했습니다' : '기본 템플릿으로 바꾸지 못했습니다'),
  });
}

const ACTION_DONE: Record<AgentRuntimeAction, string> = {
  start: 'AI 를 켜는 중입니다',
  stop: 'AI 를 끄는 중입니다',
  restart: 'AI 를 다시 시작합니다',
};

export function useAgentRuntimeAction(userId: number) {
  const invalidate = useInvalidateRuntime();
  return useMutation({
    mutationFn: (action: AgentRuntimeAction) => runAgentRuntimeAction(userId, action),
    onSuccess: (_d, action) => {
      invalidate();
      toast.success(ACTION_DONE[action]);
    },
    onError: (e) => handleApiError(e, '요청을 처리하지 못했습니다'),
  });
}

export function useCreateAgentLocation() {
  const invalidate = useInvalidateRuntime();
  return useMutation({
    mutationFn: createAgentLocation,
    onSuccess: invalidate,
    onError: (e) => handleApiError(e, '실행 위치를 추가하지 못했습니다'),
  });
}

export function useUpdateAgentLocation() {
  const invalidate = useInvalidateRuntime();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; name: string; description: string | null; capacity: number }) =>
      updateAgentLocation(id, body),
    onSuccess: () => {
      invalidate();
      toast.success('실행 위치를 바꿨습니다');
    },
    onError: (e) => handleApiError(e, '실행 위치를 바꾸지 못했습니다'),
  });
}

export function useSetDefaultAgentLocation() {
  const invalidate = useInvalidateRuntime();
  return useMutation({
    mutationFn: setDefaultAgentLocation,
    onSuccess: () => {
      invalidate();
      toast.success('기본 위치로 지정했습니다');
    },
    onError: (e) => handleApiError(e, '기본 위치로 지정하지 못했습니다'),
  });
}

export function useRotateAgentLocationToken() {
  const invalidate = useInvalidateRuntime();
  return useMutation({
    mutationFn: rotateAgentLocationToken,
    onSuccess: invalidate,
    onError: (e) => handleApiError(e, '토큰을 다시 발급하지 못했습니다'),
  });
}

export function useDeleteAgentLocation() {
  const invalidate = useInvalidateRuntime();
  return useMutation({
    mutationFn: deleteAgentLocation,
    onSuccess: () => {
      invalidate();
      toast.success('실행 위치를 삭제했습니다');
    },
    onError: (e) => handleApiError(e, '실행 위치를 삭제하지 못했습니다'),
  });
}
