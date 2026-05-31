import { useMutation, useQuery } from '@tanstack/react-query';
import { homeApi } from '@/api/home';
import { handleApiError } from '@/lib/api-error';
import type { ComposeRequest } from '@/types/home';

export const homeKeys = {
  all: ['home'] as const,
  myIssues: (params: Record<string, unknown>) => [...homeKeys.all, 'myIssues', params] as const,
  watched: () => [...homeKeys.all, 'watched'] as const,
  activity: (actorKind?: string) => [...homeKeys.all, 'activity', actorKind ?? 'all'] as const,
};

/** 프로젝트 횡단 내 이슈 — issue_list 위젯/my_tasks 담당 카운트. */
export function useMyIssues(params: Record<string, unknown>) {
  return useQuery({
    queryKey: homeKeys.myIssues(params),
    queryFn: () => homeApi.myIssues(params).then((r) => r.data),
  });
}

/** 워치 이슈 — my_tasks 워치 카운트. */
export function useWatchedIssues() {
  return useQuery({
    queryKey: homeKeys.watched(),
    queryFn: () => homeApi.watchedIssues().then((r) => r.data),
  });
}

/** 최근 활동 — activity 위젯. */
export function useActivity(actorKind?: string) {
  return useQuery({
    queryKey: homeKeys.activity(actorKind),
    queryFn: () => homeApi.activity({ actorKind, size: 20 }).then((r) => r.data),
  });
}

/** 챗 명령 compose. 성공 시 호출부가 sessionId 추적 + 캔버스 재구성. 에러는 토스트. */
export function useHomeCompose() {
  return useMutation({
    mutationFn: (body: ComposeRequest) => homeApi.compose(body).then((r) => r.data),
    onError: (err) => handleApiError(err, 'AI 구성에 실패했어요'),
  });
}
