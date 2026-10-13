// WP-55 AI 메모리 쿼리·뮤테이션 — 설정 카드 목록과 채팅 결과 줄 되돌리기가 같은 캐시를 본다(되돌리면 목록을 다시 읽는다).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { undoAiMemory } from '../../api/aiMemories';
import { chatStreams } from '../../lib/ai/chatStreams';
import { MEMORY_SETTINGS_PATH, memoryErrorCode, UNDO_FULL_MESSAGE, UNDO_GONE_MESSAGE } from '../../lib/aiMemory';
import { handleApiError } from '../../lib/api-error';
import type { UndoAiMemoryRequest } from '../../types/aiMemory';
import { useAuth } from '../useAuth';

/** 가득 참 토스트 지속 시간(ms) — action(설정 열기)을 누를 여유. */
const UNDO_FULL_TOAST_MS = 10_000;

/** 키에 사용자 id — 로그아웃이 캐시를 비우지 않아 같은 탭의 다른 계정에 이전 목록이 보이지 않게(useAiPreferences 와 같은 이유). */
export const aiMemoryKeys = {
  all: ['aiMemories'] as const,
  list: (userId: number | null | undefined) => ['aiMemories', 'list', userId ?? null] as const,
};

/**
 * 채팅 결과 줄 되돌리기. 성공하면 그 줄을 되돌림으로 바꾸고 설정 목록을 다시 읽는다.
 * 실패: 이미 지워짐(GONE·NOT_FOUND) → "이미 지워진 메모리예요", 가득 참 → "…설정에서 정리해 주세요" + "설정 열기".
 */
export function useUndoAiMemory() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (body: UndoAiMemoryRequest) => undoAiMemory(body),
    onSuccess: (_data, body) => {
      chatStreams.markMemoryUndone(body.messageId, body.blockIndex);
      void qc.invalidateQueries({ queryKey: aiMemoryKeys.list(user?.id) });
    },
    onError: (e) => {
      const code = memoryErrorCode(e);
      if (code === 'AI_MEMORY_FULL') {
        // 설정으로 이동하는 action 토스트라 기본(약 4초)보다 오래 둔다 — 읽고 누를 시간을 준다.
        toast.error(UNDO_FULL_MESSAGE, {
          duration: UNDO_FULL_TOAST_MS,
          action: { label: '설정 열기', onClick: () => navigate(MEMORY_SETTINGS_PATH) },
        });
      } else if (code === 'AI_MEMORY_GONE' || code === 'AI_MEMORY_NOT_FOUND') {
        toast.error(UNDO_GONE_MESSAGE);
      } else {
        handleApiError(e, '메모리를 되돌리지 못했어요');
      }
    },
  });
}
