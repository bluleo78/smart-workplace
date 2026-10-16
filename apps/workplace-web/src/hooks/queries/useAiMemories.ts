// WP-55 AI 메모리 쿼리·뮤테이션 — 설정 카드 목록과 채팅 결과 줄 되돌리기가 같은 캐시를 본다(되돌리면 목록을 다시 읽는다).
import { type InfiniteData, useInfiniteQuery, useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  clearAiMemories,
  createAiMemory,
  deleteAiMemory,
  listAiMemories,
  listAiMemoryChanges,
  pinAiMemory,
  undoAiMemory,
  undoAiMemoryChange,
  updateAiMemory,
} from '../../api/aiMemories';
import { CHANGE_UNDO_REFUSED_MESSAGE } from '../../components/ai/memoryChangeLogEntry';
import { chatStreams } from '../../lib/ai/chatStreams';
import {
  extractApiErrorScope,
  MEMORY_SETTINGS_PATH,
  memoryErrorMessage,
  memoryFullMessage,
  UNDO_CHANGED_MESSAGE,
  UNDO_EXPIRED_MESSAGE,
  UNDO_GONE_MESSAGE,
  wasExpiredAtUndo,
} from '../../lib/aiMemory';
import { extractApiErrorCode, handleApiError } from '../../lib/api-error';
import { kstDateKey } from '../../lib/formatters';
import { SHARED_UNDO_ERROR } from '../../lib/sharedAiMemory';
import type { AiMemoryChangePage, AiMemoryItem, AiMemoryKind, AiMemoryScope, UndoAiMemoryRequest } from '../../types/aiMemory';
import { useAuth } from '../useAuth';
import { sharedMemoryKeys } from './useSharedAiMemories';

/** 가득 참 토스트 지속 시간(ms) — action(설정 열기)을 누를 여유. */
const UNDO_FULL_TOAST_MS = 10_000;

/** 키에 사용자 id — 로그아웃이 캐시를 비우지 않아 같은 탭의 다른 계정에 이전 목록이 보이지 않게(useAiPreferences 와 같은 이유). */
export const aiMemoryKeys = {
  all: ['aiMemories'] as const,
  list: (userId: number | null | undefined) => ['aiMemories', 'list', userId ?? null] as const,
  /** WP-385 「AI가 정리한 기록」(무한 목록) — 아래 횟수 키의 앞부분이라 이 키로 무효화하면 둘 다 다시 읽는다. */
  changes: (userId: number | null | undefined) => ['aiMemories', 'changes', userId ?? null] as const,
  /** WP-385 안내 줄의 지난 30일 정리 횟수(한 건짜리 묶음의 count30d). */
  changesCount: (userId: number | null | undefined) => ['aiMemories', 'changes', userId ?? null, 'count'] as const,
};

/**
 * 이 사용자의 메모리 목록과 「AI가 정리한 기록」(목록·안내 줄 횟수 — 같은 키 앞부분)을 함께 다시 읽는 함수 — 메모리가 바뀌면(고치기·지우기·고정·추가·
 * 모두 지우기·되돌리기) 기록의 되돌리기 가능 여부·안내 줄 숫자도 바뀔 수 있어 둘을 늘 같이 무효화한다(한 곳에서만). 닫혀 있는 기록 목록은 비활성
 * 질의라 지금 받지 않고 다음에 열 때 다시 읽는다. 돌려주는 프라미스는 목록 다시 읽기만 기다린다 —
 * 부르는 쪽이 목록이 바뀔 때까지 pending 을 유지하는데, 기록(무한 목록 전체)을 기다리면 그만큼 늦어진다.
 */
function useInvalidateMemories() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return () => {
    void qc.invalidateQueries({ queryKey: aiMemoryKeys.changes(user?.id) });
    return qc.invalidateQueries({ queryKey: aiMemoryKeys.list(user?.id) });
  };
}

/** 채팅 결과 줄 되돌리기 뮤테이션 키 — 진행 중인 줄을 뮤테이션 캐시에서 찾는다(useMutationState). */
const UNDO_MUTATION_KEY = ['aiMemories', 'undo'] as const;

/**
 * 채팅 결과 줄 되돌리기. 성공하면 그 줄을 되돌림으로 바꾸고 설정 목록을 다시 읽는다.
 * 실패: 이미 지워짐(GONE·NOT_FOUND) → "이미 지워진 메모리예요", 가득 참 → "…설정에서 정리해 주세요" + "설정 열기",
 * 고친 뒤 또 바뀜(CHANGED) → "그 뒤에 바뀐 메모리라 되돌리지 않았어요"(줄은 되돌리지 않은 채 남는다).
 * 패널이 하나를 두고 모든 줄이 함께 쓰므로 진행 중 상태는 줄마다 따로 본다(isUndoing) — 뮤테이션 하나의 isPending·variables 는 마지막 요청만
 * 가리켜, 다른 줄을 빨리 누르면 앞 줄의 진행 중 표시가 풀린다. 진행 중 요청은 뮤테이션 캐시(useMutationState)에서 읽어 패널이 다시 마운트돼도
 * 유지되고 따로 상태를 들지 않는다.
 */
export function useUndoAiMemory() {
  const invalidate = useInvalidateMemories();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pending = useMutationState({
    filters: { mutationKey: UNDO_MUTATION_KEY, status: 'pending' },
    select: (m) => m.state.variables as UndoAiMemoryRequest,
  });
  const mutation = useMutation({
    mutationKey: UNDO_MUTATION_KEY,
    mutationFn: (body: UndoAiMemoryRequest) => undoAiMemory(body),
    onSuccess: (_data, body) => {
      chatStreams.markMemoryUndone(body.messageId, body.blockIndex);
      void invalidate();
      // WP-386: 공용 결과 줄을 되돌렸으면 설정 공용 탭의 목록·기록·개수도 다시 읽는다(개인 줄이면 해당 쿼리가 없어 비용 없음).
      void qc.invalidateQueries({ queryKey: sharedMemoryKeys.all });
    },
    onError: (e) => {
      const code = extractApiErrorCode(e);
      if (code === 'AI_MEMORY_FULL') {
        // 설정으로 이동하는 action 토스트라 기본(약 4초)보다 오래 둔다 — 읽고 누를 시간을 준다. 범위는 서버 409 errors.scope 기준.
        toast.error(memoryFullMessage(extractApiErrorScope(e)), {
          duration: UNDO_FULL_TOAST_MS,
          action: { label: '설정 열기', onClick: () => navigate(MEMORY_SETTINGS_PATH) },
        });
      } else if (code === 'AI_MEMORY_GONE' || code === 'AI_MEMORY_NOT_FOUND') {
        toast.error(UNDO_GONE_MESSAGE);
      } else if (code === 'AI_MEMORY_CHANGED') {
        toast.error(UNDO_CHANGED_MESSAGE);
      } else if (code && SHARED_UNDO_ERROR[code]) {
        // WP-386: 공용 결과 줄 — 그 뒤 바뀜·이미 되돌림·권한 없음·가득 참.
        toast.error(SHARED_UNDO_ERROR[code]);
      } else {
        handleApiError(e, '메모리를 되돌리지 못했어요');
      }
    },
  });
  return {
    /** 되돌리기 요청. */
    undo: mutation.mutate,
    /** 그 줄의 되돌리기가 진행 중인가. */
    isUndoing: (messageId: number | undefined, blockIndex: number) =>
      messageId != null && pending.some((r) => r.messageId === messageId && r.blockIndex === blockIndex),
  };
}

/** 본인 메모리 목록 — 로그인 전에는 부르지 않는다. */
export function useAiMemories() {
  const { user } = useAuth();
  return useQuery({ queryKey: aiMemoryKeys.list(user?.id), queryFn: listAiMemories, enabled: user != null });
}

/**
 * 직접 추가 — 설정 삭제 토스트의 되돌리기도 이 경로로 다시 만든다(목록 갱신·오류 토스트를 한 곳에 둔다). failMessage 는 서버 문구가 없을 때의 토스트.
 * 오류 처리를 훅 옵션에 두므로 부른 행이 지워져 언마운트된 뒤(삭제 토스트)에도 실패 토스트가 뜬다.
 */
export function useCreateAiMemory(failMessage = '메모리를 추가하지 못했어요') {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: (body: { kind: AiMemoryKind; content: string; scope?: AiMemoryScope; expiresOn?: string }) => createAiMemory(body),
    // 목록을 다시 읽을 때까지 pending 유지 — 폼이 닫히고 새 목록이 바로 보이게(옛 내용이 한 번 보이지 않게).
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(memoryErrorMessage(e, failMessage)),
  });
}

/** 제자리 고치기 — scope 키는 범위를 바꿀 때만 싣는다(null = 공통으로). 기한은 바꿀 때만 expiresOn 또는 clearExpiry(WP-380). content 없이도 된다(만료 행 되살리기). */
export function useUpdateAiMemory() {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      content?: string;
      scope?: AiMemoryScope | null;
      expiresOn?: string;
      clearExpiry?: true;
    }) => updateAiMemory(id, body),
    // 목록을 다시 읽을 때까지 pending 유지 — 편집기가 닫힐 때 이미 새 내용·새 위치가 보인다.
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(memoryErrorMessage(e, '메모리를 고치지 못했어요')),
  });
}

/**
 * 고정 토글(WP-383) — 목록을 다시 읽을 때까지 pending(고정 행이 묶음 맨 위로 옮겨 보일 때 풀린다). 실패는 서버 문구(고정 가득 참 포함).
 * 실패해도 다시 읽는다 — 409(가득 참)는 다른 탭·기기에서 고정이 바뀌었다는 뜻이라 화면의 고정 수·막힘을 서버에 맞춘다.
 */
export function usePinAiMemory() {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: ({ id, pinned }: { id: number; pinned: boolean }) => pinAiMemory(id, pinned),
    onSettled: () => invalidate(),
    onError: (e) => toast.error(memoryErrorMessage(e, '고정을 바꾸지 못했어요')),
  });
}

/**
 * 지우기 — 즉시 지우고 "메모리를 삭제했어요" + "되돌리기" 토스트. 되돌리기는 같은 kind·content·scope·expiresOn 으로 다시 만든다(직접 추가 경로라 USER).
 * 만료 항목은 되돌리기가 없다 — 지난 기한으로는 다시 만들 수 없다(서버 400). 지울 때는 유효였어도 누르기 전에 자정(KST)이 지나 기한이 지났으면
 * 요청하지 않고 그 이유를 토스트로 알린다.
 */
export function useDeleteAiMemory() {
  const invalidate = useInvalidateMemories();
  const restore = useCreateAiMemory('메모리를 되돌리지 못했어요');
  return useMutation({
    mutationFn: (item: AiMemoryItem) => deleteAiMemory(item.id),
    onSuccess: (deleted) => {
      if (deleted.expired) {
        toast.success('메모리를 삭제했어요');
      } else {
        toast.success('메모리를 삭제했어요', {
          action: {
            label: '되돌리기',
            // 같은 범위·기한으로 다시 만든다(공통·기한 없음이면 키 생략). 오늘은 누르는 순간에 다시 잰다 — 지운 뒤 자정이 지났을 수 있다.
            onClick: () => {
              if (wasExpiredAtUndo(deleted.expiresOn, kstDateKey(new Date()))) {
                toast.error(UNDO_EXPIRED_MESSAGE);
                return;
              }
              restore.mutate({
                kind: deleted.kind,
                content: deleted.content,
                ...(deleted.scope ? { scope: deleted.scope } : {}),
                ...(deleted.expiresOn ? { expiresOn: deleted.expiresOn } : {}),
              });
            },
          },
        });
      }
      // 목록을 다시 읽을 때까지 pending 유지 — 지운 줄이 남아 삭제 버튼이 다시 켜져 두 번째 DELETE(404)가 나가지 않게.
      return invalidate();
    },
    onError: (e) => toast.error(memoryErrorMessage(e, '메모리를 지우지 못했어요')),
  });
}

/** 모두 지우기(확인 대화상자 뒤). 되돌릴 수 없다. */
export function useClearAiMemories() {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: clearAiMemories,
    onSuccess: () => invalidate(),
    onError: (e) => handleApiError(e, '메모리를 지우지 못했어요'),
  });
}

/**
 * 안내 줄의 지난 30일 정리 횟수(WP-385) — 기록 한 건짜리 묶음(size=1)의 count30d 만 읽는다(설정 화면에 들어올 때 기록 30건을 받지 않게).
 * 실패해도 토스트를 띄우지 않는다(안내 줄이 숨는다 — 설정 화면에 들어올 때마다 오류 토스트가 뜨지 않게).
 */
export function useAiMemoryChangeCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: aiMemoryKeys.changesCount(user?.id),
    queryFn: async () => (await listAiMemoryChanges(null, 1)).count30d,
    enabled: user != null,
  });
}

/**
 * 「AI가 정리한 기록」(WP-385) — 커서 무한 목록. 기록 대화상자·시트가 열렸을 때만 읽는다(open). 실패해도 토스트를 띄우지 않는다
 * (기록 대화상자는 다시 시도 버튼을 보인다).
 */
export function useAiMemoryChanges(open: boolean) {
  const { user } = useAuth();
  return useInfiniteQuery<AiMemoryChangePage, Error, InfiniteData<AiMemoryChangePage>, readonly unknown[], string | null>({
    queryKey: aiMemoryKeys.changes(user?.id),
    initialPageParam: null,
    queryFn: ({ pageParam }) => listAiMemoryChanges(pageParam),
    getNextPageParam: (last) => last.nextCursor,
    enabled: user != null && open,
  });
}

/** 기록 되돌리기 뮤테이션 키 — 진행 중인 항목을 뮤테이션 캐시에서 찾는다(채팅 결과 줄 되돌리기와 같은 방식). */
const UNDO_CHANGE_MUTATION_KEY = ['aiMemories', 'changes', 'undo'] as const;

/**
 * 기록 하나 되돌리기(WP-385). 성공하면 그 항목을 응답(되돌림 표시)으로 바꿔 끼우고 설정 목록·기록을 다시 읽는다.
 * 그 뒤 메모리가 바뀌었으면(AI_MEMORY_CHANGED) "그 뒤에 메모리가 바뀌어 되돌릴 수 없어요" + 목록·기록 다시 읽기. 이미 되돌렸거나 없으면 기록을 다시 읽어 맞춘다.
 */
export function useUndoAiMemoryChange() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const invalidateList = useInvalidateMemories();
  const key = aiMemoryKeys.changes(user?.id);
  const pending = useMutationState({
    filters: { mutationKey: UNDO_CHANGE_MUTATION_KEY, status: 'pending' },
    select: (m) => m.state.variables as number,
  });
  const mutation = useMutation({
    mutationKey: UNDO_CHANGE_MUTATION_KEY,
    mutationFn: (id: number) => undoAiMemoryChange(id),
    onSuccess: ({ change }) => {
      qc.setQueryData<InfiniteData<AiMemoryChangePage>>(key, (data) =>
        data && {
          ...data,
          pages: data.pages.map((p) => ({ ...p, items: p.items.map((c) => (c.id === change.id ? change : c)) })),
        },
      );
      toast.success('되돌렸어요');
      void invalidateList();
    },
    onError: (e) => {
      const code = extractApiErrorCode(e);
      if (code === 'AI_MEMORY_CHANGED') {
        // 그 뒤에 메모리가 바뀌었다 — 메모리 목록과 기록을 서버 상태로 맞춘다(다른 탭에서 바꿨을 수 있다).
        toast.error(CHANGE_UNDO_REFUSED_MESSAGE);
        void invalidateList();
      } else if (code === 'AI_MEMORY_CHANGE_UNDONE' || code === 'AI_MEMORY_NOT_FOUND') {
        // 다른 탭에서 이미 되돌렸거나 기록이 사라졌다 — 서버 상태로 맞춘다.
        toast.error('이미 되돌린 기록이에요');
        void qc.invalidateQueries({ queryKey: key });
      } else {
        handleApiError(e, '되돌리지 못했어요');
      }
    },
  });
  return {
    /**
     * 되돌리기 요청 — 실패하면 거부되는 프라미스(토스트는 위 onError 가 띄운다). 기록 목록이 거부를 받아 이 항목의 "누름" 표시를 지운다
     * (MemoryChangeLog) — 부르는 쪽은 거부를 잡아야 한다.
     */
    undo: mutation.mutateAsync,
    /** 그 항목의 되돌리기가 진행 중인가. */
    isUndoing: (id: number) => pending.includes(id),
  };
}
