// WP-386 공용 메모리 기록 — 「기록 보기」 버튼 + 기록 목록(데스크톱 대화상자 · 모바일 바텀시트). WP-385 MemoryChangeLog 를 그대로 쓴다
// (문구: 새로 기억함·직접 추가·합침·고침·지움·되돌림 + 행위자). 되돌리기는 서버가 허락한 기록(undoable)에만, 출처 대화 링크는 없다(발화자 추적 금지).
// 열 때만 기록을 부른다. 인피니트 스크롤 root 는 대화상자·시트의 스크롤 영역.
import { History } from 'lucide-react';
import { useMemo, useState } from 'react';

import { InfiniteChangeLogBody } from '@/components/ai/InfiniteChangeLogBody';
import { ResponsiveLogDialog } from '@/components/ai/ResponsiveLogDialog';
import { Button } from '@/components/ui/button';
import { useSharedAiMemoryChanges, useUndoSharedAiMemoryChange } from '@/hooks/queries/useSharedAiMemories';
import { historyIntro, refOf, spaceLabel, toSharedChangeLogEntry } from '@/lib/sharedAiMemory';
import type { SharedMemorySpace } from '@/types/sharedAiMemory';

const TEST_ID_PREFIX = 'shared-memory-history';

/** 「기록 보기」 버튼 — 눌러야 기록을 부르고, 모바일은 바텀시트·데스크톱은 대화상자로 연다. */
export function SharedMemoryHistoryButton({ space }: { space: SharedMemorySpace }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        data-testid="shared-memory-history-open"
        className="text-muted-foreground pointer-coarse:min-h-11"
        onClick={() => setOpen(true)}
      >
        <History className="size-3.5" />
        기록 보기
      </Button>
      <ResponsiveLogDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`기록 — ${spaceLabel(space)}`}
        intro={historyIntro(space)}
        testIdPrefix={TEST_ID_PREFIX}
      >
        {/* 열 때만 본문을 달아 기록을 부른다. */}
        {(scrollRoot) => (open ? <HistoryBody space={space} scrollRoot={scrollRoot} /> : null)}
      </ResponsiveLogDialog>
    </>
  );
}

/** 공간 기록 본문 — 목록 항목으로 바꾸고 되돌리기를 잇는다(상태 안내·빈 상태 문구만 공용 본문에 넘긴다). */
function HistoryBody({ space, scrollRoot }: { space: SharedMemorySpace; scrollRoot: Element | null }) {
  const ref = useMemo(() => refOf(space), [space]);
  const changes = useSharedAiMemoryChanges(ref, true);
  const { undo, isUndoing } = useUndoSharedAiMemoryChange(ref);
  const entries = useMemo(() => (changes.data?.pages ?? []).flatMap((p) => p.items).map(toSharedChangeLogEntry), [changes.data]);
  return (
    <InfiniteChangeLogBody
      query={changes}
      entries={entries}
      // undo 는 실패하면 거부된다 — MemoryChangeLog 가 거부를 받아 누름 표시를 지우고, 토스트는 훅이 띄운다.
      onUndo={(e) => undo(e.id)}
      isUndoing={isUndoing}
      scrollRoot={scrollRoot}
      testIdPrefix={TEST_ID_PREFIX}
      empty={<p className="py-2 text-sm text-muted-foreground">최근 90일 동안 바뀐 내용이 없어요.</p>}
    />
  );
}
