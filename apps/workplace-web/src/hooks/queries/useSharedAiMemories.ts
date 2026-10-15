// WP-386 공용 AI 메모리 쿼리·뮤테이션 — 공간 목록(개수), 공간별 무한 목록(검색은 한 묶음), 직접 추가·고치기·지우기, 공간 기록(무한)·되돌리기.
// 쓰기가 끝나면 그 공간 목록·기록과 공간 목록(개수)을 다시 읽는다. 키에 사용자 id — 같은 탭의 다른 계정에 이전 목록이 보이지 않게(useAiMemories 와 같은 이유).
import { type InfiniteData, useInfiniteQuery, useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  createSharedAiMemory,
  deleteSharedAiMemory,
  listSharedAiMemories,
  listSharedAiMemoryChanges,
  listSharedMemorySpaces,
  undoSharedAiMemoryChange,
  updateSharedAiMemory,
} from '../../api/sharedAiMemories';
import { memoryErrorMessage } from '../../lib/aiMemory';
import { extractApiErrorCode, handleApiError } from '../../lib/api-error';
import { SHARED_UNDO_ERROR, spaceParam } from '../../lib/sharedAiMemory';
import type { SharedAiMemoryChangePage, SharedAiMemoryPage, SharedSpaceRef } from '../../types/sharedAiMemory';
import { useAuth } from '../useAuth';

export const sharedMemoryKeys = {
  all: ['sharedAiMemories'] as const,
  spaces: (userId: number | null | undefined) => ['sharedAiMemories', 'spaces', userId ?? null] as const,
  /** 그 공간의 모든 목록(검색어별) — 쓰기 뒤 한 번에 다시 읽는다. */
  space: (userId: number | null | undefined, ref: SharedSpaceRef | null) =>
    ['sharedAiMemories', 'space', userId ?? null, ref ? spaceParam(ref) : null] as const,
  /** 그 공간의 모든 목록(검색어별) — 기록은 빼고 목록만 다시 읽을 때. */
  lists: (userId: number | null | undefined, ref: SharedSpaceRef | null) => [...sharedMemoryKeys.space(userId, ref), 'list'] as const,
  list: (userId: number | null | undefined, ref: SharedSpaceRef | null, q: string) =>
    [...sharedMemoryKeys.lists(userId, ref), q] as const,
  changes: (userId: number | null | undefined, ref: SharedSpaceRef | null) =>
    [...sharedMemoryKeys.space(userId, ref), 'changes'] as const,
};

/** 내가 읽을 수 있는 공간 목록. */
export function useSharedMemorySpaces() {
  const { user } = useAuth();
  return useQuery({ queryKey: sharedMemoryKeys.spaces(user?.id), queryFn: listSharedMemorySpaces, enabled: user != null });
}

/** 공간 목록 — 인피니트 스크롤(30개씩). q 가 있으면 서버가 맞는 것 전부를 한 묶음으로 준다. */
export function useSharedAiMemories(ref: SharedSpaceRef | null, q: string) {
  const { user } = useAuth();
  const query = q.trim();
  return useInfiniteQuery<SharedAiMemoryPage, Error, InfiniteData<SharedAiMemoryPage>, readonly unknown[], string | null>({
    queryKey: sharedMemoryKeys.list(user?.id, ref, query),
    initialPageParam: null,
    queryFn: ({ pageParam }) => listSharedAiMemories(ref!, { q: query || undefined, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? null,
    enabled: user != null && ref != null,
  });
}

/** 그 공간의 목록·기록과 공간 개수를 다시 읽는 함수. */
function useInvalidateSpace(ref: SharedSpaceRef | null) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: sharedMemoryKeys.space(user?.id, ref) }),
      qc.invalidateQueries({ queryKey: sharedMemoryKeys.spaces(user?.id) }),
    ]);
}

/** 직접 추가 — 가득 참(409)·권한(403)은 서버 문구. */
export function useCreateSharedAiMemory(ref: SharedSpaceRef | null) {
  const invalidate = useInvalidateSpace(ref);
  return useMutation({
    mutationFn: (content: string) => createSharedAiMemory(ref!, content),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(memoryErrorMessage(e, '공용 메모리를 추가하지 못했어요')),
  });
}

export function useUpdateSharedAiMemory(ref: SharedSpaceRef | null) {
  const invalidate = useInvalidateSpace(ref);
  return useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) => updateSharedAiMemory(id, content),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(memoryErrorMessage(e, '공용 메모리를 고치지 못했어요')),
  });
}

/** 지우기 — 되돌리기는 기록에서 한다는 안내를 함께 띄운다. */
export function useDeleteSharedAiMemory(ref: SharedSpaceRef | null) {
  const invalidate = useInvalidateSpace(ref);
  return useMutation({
    mutationFn: (id: number) => deleteSharedAiMemory(id),
    onSuccess: () => {
      toast.success('지웠어요. 기록에서 되돌릴 수 있어요');
      return invalidate();
    },
    onError: (e) => toast.error(memoryErrorMessage(e, '공용 메모리를 지우지 못했어요')),
  });
}

/** 공간 기록 — 대화상자를 열 때만 부른다(enabled). 실패해도 토스트 없이 다시 시도 버튼. */
export function useSharedAiMemoryChanges(ref: SharedSpaceRef | null, enabled: boolean) {
  const { user } = useAuth();
  return useInfiniteQuery<SharedAiMemoryChangePage, Error, InfiniteData<SharedAiMemoryChangePage>, readonly unknown[], string | null>({
    queryKey: sharedMemoryKeys.changes(user?.id, ref),
    initialPageParam: null,
    queryFn: ({ pageParam }) => listSharedAiMemoryChanges(ref!, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? null,
    enabled: enabled && user != null && ref != null,
  });
}

const UNDO_SHARED_MUTATION_KEY = ['sharedAiMemories', 'changes', 'undo'] as const;

/**
 * 기록 하나 되돌리기. 성공하면 그 항목을 응답으로 바꿔 끼우고 목록·개수를 다시 읽는다(방금 바꿔 끼운 기록은 다시 받지 않는다 —
 * 열려 있는 기록 묶음을 전부 다시 받지 않도록 목록 키 아래 `list`·공간 개수만 무효화한다).
 * 409 CHANGED → 「그 뒤에 메모리가 바뀌어 되돌릴 수 없어요」 + 목록·기록 다시 읽기(개인 기록 되돌리기와 같다), 409 CHANGE_UNDONE·404 → 기록을 다시 읽어 맞춘다.
 * undo 는 mutateAsync — 실패하면 거부되는 프라미스를 돌려줘 MemoryChangeLog 가 그 항목의 「누름」 표시를 지운다(부르는 쪽이 거부를 잡는다).
 */
export function useUndoSharedAiMemoryChange(ref: SharedSpaceRef | null) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const invalidate = useInvalidateSpace(ref);
  const invalidateListsAndSpaces = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: sharedMemoryKeys.lists(user?.id, ref) }),
      qc.invalidateQueries({ queryKey: sharedMemoryKeys.spaces(user?.id) }),
    ]);
  const key = sharedMemoryKeys.changes(user?.id, ref);
  const pending = useMutationState({
    filters: { mutationKey: UNDO_SHARED_MUTATION_KEY, status: 'pending' },
    select: (m) => m.state.variables as number,
  });
  const mutation = useMutation({
    mutationKey: UNDO_SHARED_MUTATION_KEY,
    mutationFn: (id: number) => undoSharedAiMemoryChange(id),
    onSuccess: ({ change }) => {
      qc.setQueryData<InfiniteData<SharedAiMemoryChangePage>>(key, (data) =>
        data && { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((c) => (c.id === change.id ? change : c)) })) },
      );
      toast.success('되돌렸어요');
      // 기록은 위에서 바꿔 끼웠으니 다시 받지 않고(refetchType none → 낡음 표시만), 공간 목록·개수만 다시 읽는다.
      void qc.invalidateQueries({ queryKey: key, refetchType: 'none' });
      void invalidateListsAndSpaces();
    },
    onError: (e) => {
      const code = extractApiErrorCode(e);
      const message = code ? SHARED_UNDO_ERROR[code] : undefined;
      if (message) toast.error(message);
      else handleApiError(e, '되돌리지 못했어요');
      if (code === 'SHARED_MEMORY_CHANGED') void invalidate();
      else if (code === 'SHARED_MEMORY_CHANGE_UNDONE' || code === 'SHARED_MEMORY_NOT_FOUND') void qc.invalidateQueries({ queryKey: key });
    },
  });
  return { undo: mutation.mutateAsync, isUndoing: (id: number) => pending.includes(id) };
}
