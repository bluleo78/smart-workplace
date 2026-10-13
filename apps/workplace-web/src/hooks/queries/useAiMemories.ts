// WP-55 AI 메모리 쿼리·뮤테이션 — 설정 카드 목록과 채팅 결과 줄 되돌리기가 같은 캐시를 본다(되돌리면 목록을 다시 읽는다).
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { clearAiMemories, createAiMemory, deleteAiMemory, listAiMemories, undoAiMemory, updateAiMemory } from '../../api/aiMemories';
import { chatStreams } from '../../lib/ai/chatStreams';
import {
  MEMORY_SETTINGS_PATH,
  memoryErrorMessage,
  UNDO_CHANGED_MESSAGE,
  UNDO_FULL_MESSAGE,
  UNDO_GONE_MESSAGE,
} from '../../lib/aiMemory';
import { extractApiErrorCode, handleApiError } from '../../lib/api-error';
import type { AiMemoryItem, AiMemoryKind, UndoAiMemoryRequest } from '../../types/aiMemory';
import { useAuth } from '../useAuth';

/** 가득 참 토스트 지속 시간(ms) — action(설정 열기)을 누를 여유. */
const UNDO_FULL_TOAST_MS = 10_000;

/** 키에 사용자 id — 로그아웃이 캐시를 비우지 않아 같은 탭의 다른 계정에 이전 목록이 보이지 않게(useAiPreferences 와 같은 이유). */
export const aiMemoryKeys = {
  all: ['aiMemories'] as const,
  list: (userId: number | null | undefined) => ['aiMemories', 'list', userId ?? null] as const,
};

/** 이 사용자의 목록 키로 다시 읽는 함수. */
function useInvalidateMemories() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return () => qc.invalidateQueries({ queryKey: aiMemoryKeys.list(user?.id) });
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
    },
    onError: (e) => {
      const code = extractApiErrorCode(e);
      if (code === 'AI_MEMORY_FULL') {
        // 설정으로 이동하는 action 토스트라 기본(약 4초)보다 오래 둔다 — 읽고 누를 시간을 준다.
        toast.error(UNDO_FULL_MESSAGE, {
          duration: UNDO_FULL_TOAST_MS,
          action: { label: '설정 열기', onClick: () => navigate(MEMORY_SETTINGS_PATH) },
        });
      } else if (code === 'AI_MEMORY_GONE' || code === 'AI_MEMORY_NOT_FOUND') {
        toast.error(UNDO_GONE_MESSAGE);
      } else if (code === 'AI_MEMORY_CHANGED') {
        toast.error(UNDO_CHANGED_MESSAGE);
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
    mutationFn: (body: { kind: AiMemoryKind; content: string }) => createAiMemory(body),
    // 목록을 다시 읽을 때까지 pending 유지 — 폼이 닫히고 새 목록이 바로 보이게(옛 내용이 한 번 보이지 않게).
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(memoryErrorMessage(e, failMessage)),
  });
}

/** 제자리 고치기. */
export function useUpdateAiMemory() {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: (v: { id: number; content: string }) => updateAiMemory(v.id, { content: v.content }),
    // 목록을 다시 읽을 때까지 pending 유지 — 편집기가 닫힐 때 이미 새 내용·새 위치가 보인다.
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(memoryErrorMessage(e, '메모리를 고치지 못했어요')),
  });
}

/**
 * 지우기 — 즉시 지우고 "메모리를 삭제했어요" + "되돌리기" 토스트. 되돌리기는 같은 kind·content 로 다시 만든다(직접 추가 경로라 USER, 판정 11).
 */
export function useDeleteAiMemory() {
  const invalidate = useInvalidateMemories();
  const restore = useCreateAiMemory('메모리를 되돌리지 못했어요');
  return useMutation({
    mutationFn: (item: AiMemoryItem) => deleteAiMemory(item.id),
    onSuccess: (deleted) => {
      toast.success('메모리를 삭제했어요', {
        action: { label: '되돌리기', onClick: () => restore.mutate({ kind: deleted.kind, content: deleted.content }) },
      });
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
