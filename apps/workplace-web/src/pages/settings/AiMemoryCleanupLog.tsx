// WP-385 「AI가 정리한 기록」 — 메모리 카드 안 안내 줄(지난 30일 정리 횟수 + 기록 보기)과 기록 목록(데스크톱 대화상자 · 모바일 바텀시트).
// 대화가 끝나고 30분 뒤 AI 가 새로 기억·합침·고침·지움을 하고, 90일 동안 쓰지 않은 AI 저장 메모리는 지운다. 항목마다 되돌릴 수 있다.
// 지난 30일 정리가 0번이면(또는 기록을 못 읽었으면) 안내 줄을 숨긴다 — 오류 토스트는 띄우지 않는다.
import { Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import { InfiniteChangeLogBody } from '@/components/ai/InfiniteChangeLogBody';
import { ResponsiveLogDialog } from '@/components/ai/ResponsiveLogDialog';
import { useAiMemoryChangeCount, useAiMemoryChanges, useUndoAiMemoryChange } from '@/hooks/queries/useAiMemories';
import { toChangeLogEntry } from '@/lib/aiMemoryChange';

const TITLE = 'AI가 정리한 기록';
const INTRO = '대화가 끝나고 30분이 지나면 AI가 메모리를 정리해요. 직접 추가했거나 고정한 메모리는 바꾸지 않아요.';
const TEST_ID_PREFIX = 'ai-memory-cleanup';

/** 카드 안 안내 줄(횟수만 읽는다) + 기록 열기(열었을 때만 기록 목록을 읽는다). */
export function AiMemoryCleanupNotice() {
  const [open, setOpen] = useState(false);
  const changes = useAiMemoryChanges(open);
  const count = useAiMemoryChangeCount().data ?? 0;
  if (count === 0) return null;

  return (
    <>
      <div
        data-testid="ai-memory-cleanup-notice"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-ai-accent-subtle px-3 py-2 text-xs text-muted-foreground"
      >
        <Sparkles aria-hidden className="size-3.5 shrink-0 text-ai-accent" />
        <span className="min-w-0 flex-1 break-keep">
          지난 30일 동안 AI가 메모리를 <span className="font-medium text-foreground">{count}번</span> 정리했어요
        </span>
        <button
          type="button"
          data-testid="ai-memory-cleanup-open"
          onClick={() => setOpen(true)}
          className="inline-flex shrink-0 items-center rounded-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80 pointer-coarse:min-h-11"
        >
          기록 보기
        </button>
      </div>
      <ResponsiveLogDialog
        open={open}
        onClose={() => setOpen(false)}
        title={TITLE}
        intro={`${INTRO} 지난 30일 기록이에요.`}
        // 본문 안내 문구와 겹치지 않게 짧고 다른 문장으로 둔다 — 스크린리더가 같은 말을 두 번 읽지 않는다.
        sheetDescription="지난 30일 동안 AI가 정리한 기록"
        testIdPrefix={TEST_ID_PREFIX}
      >
        {(scrollRoot) => <CleanupLogBody changes={changes} scrollRoot={scrollRoot} />}
      </ResponsiveLogDialog>
    </>
  );
}

/** 개인 정리 기록 본문 — 목록 항목으로 바꾸고 되돌리기를 잇는다(상태 안내는 InfiniteChangeLogBody 가 맡는다. 안내 줄 횟수는 따로 읽어 목록보다 먼저 보일 수 있다). */
function CleanupLogBody({
  changes,
  scrollRoot,
}: {
  changes: ReturnType<typeof useAiMemoryChanges>;
  scrollRoot: Element | null;
}) {
  const { undo, isUndoing } = useUndoAiMemoryChange();
  const entries = useMemo(() => (changes.data?.pages ?? []).flatMap((p) => p.items).map(toChangeLogEntry), [changes.data]);
  return (
    <InfiniteChangeLogBody
      query={changes}
      entries={entries}
      onUndo={(e) => undo(e.id)}
      isUndoing={isUndoing}
      scrollRoot={scrollRoot}
      testIdPrefix={TEST_ID_PREFIX}
    />
  );
}
