// WP-55 채팅 메모리 결과 줄(시안 A) — 답변 말풍선들 아래·후속 질문 위에 한 줄씩. ActionResultLine 과 같은 작은 muted 시스템 기록이고
// 🧠 + 문구 + " · 되돌리기". 되돌린 뒤엔 문구 취소선 + " · 되돌림"(흐리게). 메시지 id 가 없거나(답변 중) 요청 중이면 되돌리기는 회색·클릭 불가.
// 긴 문구는 좁은 패널(≈380px)에서 넘치지 않게 강제 줄바꿈하고, 터치 기기에선 되돌리기의 위아래 터치 영역을 넓힌다.
import { useUndoAiMemory } from '@/hooks/queries/useAiMemories';
import { HIT_AREA_Y_COARSE } from '@/lib/hitArea';
import { cn } from '@/lib/utils';
import type { MemoryBlock } from '@/types/home';

const PREFIX: Record<MemoryBlock['action'], string> = {
  saved: '메모리에 저장함',
  updated: '메모리를 고침',
  forgotten: '메모리에서 지움',
};

interface Props {
  block: MemoryBlock;
  /** 그 메시지의 memory 블록 순번(되돌리기 blockIndex). */
  blockIndex: number;
  /** 저장된 메시지 id — 없으면 되돌리기 비활성(done 전). */
  messageId?: number;
}

/** 메모리 결과 한 줄 — 동작 문구 + 되돌리기(또는 되돌림 표시). */
export function MemoryResultLine({ block, blockIndex, messageId }: Props) {
  const undo = useUndoAiMemory();
  const ready = messageId != null && !undo.isPending;
  return (
    <div
      className="flex w-full items-start gap-1.5 px-1 text-xs text-muted-foreground"
      data-testid="chat-memory-result"
      data-action={block.action}
      data-undone={block.undone ? 'true' : 'false'}
    >
      <span aria-hidden className="shrink-0 leading-4">🧠</span>
      <span className="min-w-0 flex-1 leading-4 [overflow-wrap:anywhere]">
        <span className={cn(block.undone && 'line-through opacity-60')}>
          {PREFIX[block.action]}: "{block.content}"
        </span>
        {block.undone ? (
          <span className="opacity-60"> · 되돌림</span>
        ) : (
          <>
            {' · '}
            <button
              type="button"
              data-testid="chat-memory-undo"
              disabled={!ready}
              onClick={() => messageId != null && undo.mutate({ messageId, blockIndex })}
              className={cn(
                HIT_AREA_Y_COARSE,
                'rounded-sm text-foreground/80 underline-offset-2 hover:underline',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                'disabled:cursor-not-allowed disabled:text-muted-foreground/60 disabled:no-underline',
              )}
            >
              되돌리기
            </button>
          </>
        )}
      </span>
    </div>
  );
}
