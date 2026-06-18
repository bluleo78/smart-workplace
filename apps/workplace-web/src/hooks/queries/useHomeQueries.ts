import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getAccessToken } from '@/api/client';
import { homeApi } from '@/api/home';
import { handleApiError } from '@/lib/api-error';
import type { ComposeRequest } from '@/types/home';

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
export function useMyIssues(params: Record<string, unknown>) {
  return useQuery({
    queryKey: homeKeys.myIssues(params),
    queryFn: () => homeApi.myIssues(params).then((r) => r.data),
    retry: false,
  });
}

/** 워치 이슈 — my_tasks 워치 카운트. retry:false 이유는 useMyIssues 참조(#205). */
export function useWatchedIssues() {
  return useQuery({
    queryKey: homeKeys.watched(),
    queryFn: () => homeApi.watchedIssues().then((r) => r.data),
    retry: false,
  });
}

/** 최근 활동 — activity 위젯. retry:false 이유는 useMyIssues 참조(#205). */
export function useActivity(actorKind?: string) {
  return useQuery({
    queryKey: homeKeys.activity(actorKind),
    queryFn: () => homeApi.activity({ actorKind, size: 20 }).then((r) => r.data),
    retry: false,
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

/**
 * SSE 스트리밍 compose 헬퍼 — 블로킹 mutation 대신 ReadableStream SSE 루프를 사용.
 * delta 이벤트마다 onDelta 콜백을 호출해 어시스턴트 말풍선을 점진 갱신하고,
 * done 이벤트에서 { sessionId } 를 반환한다. AbortSignal 로 취소 가능.
 */
export async function composeStream(
  body: ComposeRequest,
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<{ sessionId?: string }> {
  const token = getAccessToken();
  const res = await fetch('/api/v1/home/compose', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
    credentials: 'include',
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // SSE 파서 상태 — buffer: 미처리 청크, event: 현재 이벤트 타입, data: 현재 data 누적.
  let buffer = '';
  let event = 'message';
  let data = '';
  let result: { sessionId?: string } = {};

  // 완성된 이벤트 디스패치 — event/data 조합을 처리 후 상태 리셋.
  const dispatch = () => {
    if (data) {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      if (event === 'delta') onDelta(parsed.text as string);
      else if (event === 'done') result = { sessionId: parsed.sessionId as string | undefined };
      else if (event === 'error') throw new Error((parsed.message as string | undefined) ?? 'compose_failed');
    }
    event = 'message';
    data = '';
  };

  // 청크 단위 읽기 → 줄 단위로 SSE 파싱.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line === '') {
        dispatch();
        continue;
      }
      if (line.startsWith(':')) continue; // SSE 주석 무시
      const ci = line.indexOf(':');
      const field = ci === -1 ? line : line.slice(0, ci);
      const raw = ci === -1 ? '' : line.slice(ci + 1);
      const val = raw.startsWith(' ') ? raw.slice(1) : raw;
      if (field === 'event') event = val;
      else if (field === 'data') data = data ? `${data}\n${val}` : val;
    }
  }
  return result;
}

/** 챗 명령 compose. 성공 시 호출부가 sessionId 추적 + 캔버스 재구성. 에러는 토스트. */
export function useHomeCompose() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ComposeRequest) => homeApi.compose(body).then((r) => r.data),
    // 새 세션 생성/마지막 메시지 시각 갱신을 스위처 목록에 반영.
    onSuccess: () => qc.invalidateQueries({ queryKey: homeKeys.sessions() }),
    onError: (err) => handleApiError(err, 'AI 구성에 실패했습니다'),
  });
}
