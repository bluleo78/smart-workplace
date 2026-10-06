import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { homeApi } from '@/api/home';
import { handleApiError } from '@/lib/api-error';

export const homeKeys = {
  all: ['home'] as const,
  myIssues: (params: Record<string, unknown>) => [...homeKeys.all, 'myIssues', params] as const,
  watched: () => [...homeKeys.all, 'watched'] as const,
  activity: (actorKind?: string) => [...homeKeys.all, 'activity', actorKind ?? 'all'] as const,
  sessions: () => [...homeKeys.all, 'sessions'] as const,
};

/**
 * 프로젝트 횡단 내 이슈 — issue_list 위젯/my_tasks 담당 카운트.
 * retry:false — 위젯이 isError 분기로 곧장 에러 UI(재시도 버튼)를 띄우게 한다.
 * 전역 retry:1 의 1초 지연을 없애 실패가 거짓 '빈 상태'로 보이는 창을 제거(#205).
 */
export function useMyIssues(params: Record<string, unknown>, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: homeKeys.myIssues(params),
    queryFn: () => homeApi.myIssues(params).then((r) => r.data),
    retry: false,
    enabled: options?.enabled ?? true,
  });
}

/** 워치 이슈 — my_tasks 워치 카운트. retry:false 이유는 useMyIssues 참조(#205). */
export function useWatchedIssues(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: homeKeys.watched(),
    queryFn: () => homeApi.watchedIssues().then((r) => r.data),
    retry: false,
    enabled: options?.enabled ?? true,
  });
}

/** 최근 활동 — activity 위젯. retry:false 이유는 useMyIssues 참조(#205). */
export function useActivity(actorKind?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: homeKeys.activity(actorKind),
    queryFn: () => homeApi.activity({ actorKind, size: 20 }).then((r) => r.data),
    retry: false,
    enabled: options?.enabled ?? true,
  });
}

/** 세션 목록 — 스위처. */
export function useSessions() {
  return useQuery({
    queryKey: homeKeys.sessions(),
    queryFn: () => homeApi.listSessions().then((r) => r.data),
  });
}

/** 세션 삭제 — 성공 시 목록 갱신. */
export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => homeApi.deleteSession(sessionId).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: homeKeys.sessions() }),
    onError: (err) => handleApiError(err, '세션 삭제에 실패했습니다'),
  });
}
