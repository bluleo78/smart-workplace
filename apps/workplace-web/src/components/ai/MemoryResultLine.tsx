// WP-55 채팅 메모리 결과 줄(시안 A) — 답변 말풍선들 아래·후속 질문 위에 한 줄씩. ActionResultLine 과 같은 작은 muted 시스템 기록이고
// 🧠 + 문구 + " · 되돌리기". 되돌린 뒤엔 문구 취소선 + " · 되돌림"(흐리게). 메시지 id 가 없거나(답변 중) 요청 중이면 되돌리기는 회색·클릭 불가.
// 긴 문구는 좁은 패널(≈380px)에서 넘치지 않게 강제 줄바꿈하고, 터치 기기에선 되돌리기의 위아래 터치 영역을 넓힌다.
// 되돌리기는 평소에도 링크로 보이게(primary + 밑줄, 시안) 하고, " · 되돌리기"/" · 되돌림" 은 한 덩어리(nowrap)로 묶어 "·" 만 줄 끝에 남지 않게 한다.
// 되돌리기 요청(뮤테이션)은 패널(AIChatPanel)이 하나를 두고 줄마다 넘긴다 — 줄 수만큼 관찰자를 만들지 않게.
import { HIT_AREA_Y_COARSE } from '@/lib/hitArea';
import { cn } from '@/lib/utils';
import type { UndoAiMemoryRequest } from '@/types/aiMemory';
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
  /** 되돌리기 요청(패널 공용 뮤테이션). */
  onUndo: (req: UndoAiMemoryRequest) => void;
  /** 이 줄의 되돌리기 요청이 진행 중인가 — 진행 중이면 비활성. */
  pending: boolean;
}

/** 메모리 결과 한 줄 — 동작 문구 + 되돌리기(또는 되돌림 표시). */
export function MemoryResultLine({ block, blockIndex, messageId, onUndo, pending }: Props) {
  const ready = messageId != null && !pending;
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
        {/* 구분점과 동작을 한 nowrap 덩어리로 — 좁은 줄에서 덩어리째 다음 줄로 내려가 "·" 가 줄 끝에 매달리지 않는다. */}
        <span className={cn('whitespace-nowrap', block.undone && 'opacity-60')}>
          {' · '}
          {block.undone ? (
            '되돌림'
          ) : (
            <button
              type="button"
              data-testid="chat-memory-undo"
              disabled={!ready}
              onClick={() => messageId != null && onUndo({ messageId, blockIndex })}
              className={cn(
                HIT_AREA_Y_COARSE,
                'rounded-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                'disabled:cursor-not-allowed disabled:text-muted-foreground/60 disabled:no-underline',
              )}
            >
              되돌리기
            </button>
          )}
        </span>
      </span>
    </div>
  );
}
