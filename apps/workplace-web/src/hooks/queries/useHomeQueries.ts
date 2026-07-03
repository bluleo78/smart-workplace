import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { homeApi } from '@/api/home';
import { onAiStreamEvent } from '@/lib/aiEventBus';
import { handleApiError } from '@/lib/api-error';
import type { ChatRequest, PendingAction, ToolEventDto, WidgetSpec } from '@/types/home';

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

interface ChatDeltaPayload {
  correlationId?: string;
  text?: string;
}
interface ChatProgressPayload {
  correlationId?: string;
  label?: string;
}
interface ChatPendingActionPayload {
  correlationId?: string;
  actions?: PendingAction[];
}
interface ChatToolPayload extends Record<string, unknown> {
  correlationId?: string;
}
interface ChatDonePayload {
  correlationId?: string;
  sessionId?: string;
  widgets?: WidgetSpec[] | null;
}
interface ChatErrorPayload {
  correlationId?: string;
  message?: string;
  cancelled?: boolean;
}

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * AI 채팅 생성(#593 편입) — POST 로 시작해 correlationId 를 받고, 실제 델타/progress/pending_action/
 * tool/done/error 는 통합 /events 채널(aiEventBus 로 중계됨)에서 correlationId 로 필터링해 수신한다.
 * useChatSession.ts 의 Promise 체이닝(.then/.catch/.finally) + AbortController 소비 패턴을 그대로
 * 유지하기 위해 외부 시그니처는 바꾸지 않는다 — 내부만 fetch+ReadableStream 파서에서 시작+구독으로 교체.
 *
 * #333 M2: progress·pending_action 이벤트 소비 추가.
 * - onProgress: 위임 진행 라벨 — assistant 말풍선 위 ghost 진행 줄로 표시.
 * - onPendingAction: 확인 카드 제안 객체 — 도크가 승인/취소 카드로 렌더.
 */
export async function chatStream(
  body: ChatRequest,
  onDelta: (text: string) => void,
  signal: AbortSignal,
  onProgress?: (label: string) => void,
  onPendingAction?: (actions: PendingAction[]) => void,
  onTool?: (evt: ToolEventDto) => void,
): Promise<{ sessionId?: string; widgets?: WidgetSpec[] }> {
  if (signal.aborted) throw abortError();

  const startRes = await homeApi.startChat({ sessionId: body.sessionId, query: body.query });
  const correlationId = startRes.data.correlationId;

  if (signal.aborted) {
    // 시작 응답이 도착하기 전에 이미 abort 됐다 — 서버에 즉시 취소 요청.
    void homeApi.cancelChat(correlationId).catch(() => {});
    throw abortError();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const unsubs: Array<() => void> = [];
    const teardown = () => {
      unsubs.forEach((u) => u());
      unsubs.length = 0;
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      teardown();
      void homeApi.cancelChat(correlationId).catch(() => {});
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort);
    unsubs.push(() => signal.removeEventListener('abort', onAbort));

    unsubs.push(
      onAiStreamEvent('home.chat.delta', (data) => {
        const p = data as ChatDeltaPayload;
        if (p.correlationId !== correlationId || typeof p.text !== 'string') return;
        onDelta(p.text);
      }),
    );
    unsubs.push(
      onAiStreamEvent('home.chat.progress', (data) => {
        const p = data as ChatProgressPayload;
        if (p.correlationId !== correlationId || typeof p.label !== 'string') return;
        onProgress?.(p.label);
      }),
    );
    unsubs.push(
      onAiStreamEvent('home.chat.pending_action', (data) => {
        const p = data as ChatPendingActionPayload;
        if (p.correlationId !== correlationId) return;
        if (p.actions && p.actions.length > 0) onPendingAction?.(p.actions);
      }),
    );
    unsubs.push(
      onAiStreamEvent('home.chat.tool', (data) => {
        const p = data as ChatToolPayload;
        if (p.correlationId !== correlationId) return;
        onTool?.(p as unknown as ToolEventDto);
      }),
    );
    unsubs.push(
      onAiStreamEvent('home.chat.done', (data) => {
        const p = data as ChatDonePayload;
        if (p.correlationId !== correlationId) return;
        settled = true;
        teardown();
        resolve({ sessionId: p.sessionId, widgets: p.widgets ?? undefined });
      }),
    );
    unsubs.push(
      onAiStreamEvent('home.chat.error', (data) => {
        const p = data as ChatErrorPayload;
        if (p.correlationId !== correlationId) return;
        settled = true;
        teardown();
        // 이 구독은 onAbort() 가 먼저 teardown() 했다면 이미 해제돼 있으므로, 여기 도달했다는
        // 것 자체가 이 클라이언트의 취소가 아니다 — cancelled:true 는 서버측 300초 타임아웃을
        // 뜻한다(useWikiAiStream.ts 와 동일 추론). AbortError 로 삼키면 로딩 상태가 조용히
        // 사라지므로, 반드시 실제 에러로 표면화한다.
        if (p.cancelled) {
          reject(new Error('생성 시간이 초과되었습니다.'));
        } else {
          reject(new Error(p.message ?? 'chat_failed'));
        }
      }),
    );
  });
}

