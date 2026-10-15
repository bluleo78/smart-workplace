// 메모리 변경 기록 목록 — 개인 「AI가 정리한 기록」(WP-385)과 공용 메모리 「변경 이력」(WP-386)이 같은 모양을 쓴다.
// 날짜 묶음(오늘·어제·날짜, KST) 아래 항목마다: 아이콘 + 무슨 일이 있었는지 + 시각, 메모리 내용, 보조 줄(이전 내용·사유·출처 대화), 오른쪽 되돌리기.
// 되돌린 항목은 흐리게 + "되돌림 · 시각"(버튼 없음). 되돌리기 요청·거절 토스트는 부르는 쪽(훅)이 맡는다.
// 접근성: 묶음 section 은 제목(h3)으로 이름을 받고(한 번만 읽힘), 되돌리기 버튼은 동작 문구·내용을 설명으로 잇고,
// 되돌린 뒤 버튼이 사라지면 포커스를 그 항목의 되돌림 표시로 옮긴다.
import { Clock, GitMerge, type LucideIcon, PenLine, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Fragment, type ReactNode, useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';

import type { MemoryChangeIcon, MemoryChangeLogEntry } from '@/components/ai/memoryChangeLogEntry';
import { Button } from '@/components/ui/button';
import { CHAT_PARAM } from '@/lib/aiChatLink';
import { MEMORY_LINK } from '@/lib/aiMemory';
import { formatClockTime, formatDayGroupLabel } from '@/lib/formatters';
import { groupConsecutive } from '@/lib/groupConsecutive';
import { cn } from '@/lib/utils';

const ICONS: Record<MemoryChangeIcon, LucideIcon> = {
  ADDED: Plus,
  MERGED: GitMerge,
  UPDATED: PenLine,
  FORGOTTEN: Trash2,
  DECAYED: Clock,
  DELETED: Trash2,
  RESTORED: RotateCcw,
};

export function MemoryChangeLog({
  entries,
  onUndo,
  isUndoing,
  now,
  testId,
}: {
  entries: readonly MemoryChangeLogEntry[];
  /**
   * 없으면 되돌리기 버튼을 두지 않는다(읽기 전용 이력). 돌려준 프라미스의 거부(실패)를 여기서 받아 누름 표시를 지운다 — 토스트는 부르는 쪽이 맡는다.
   */
  onUndo?: (entry: MemoryChangeLogEntry) => Promise<unknown>;
  isUndoing?: (id: number) => boolean;
  /** 묶음 기준 시각 — 생략하면 지금. */
  now?: Date;
  testId?: string;
}) {
  // 순서를 유지한 채 날짜(KST) 묶음으로 나눈다 — 기록은 최신순으로 온다.
  const at = now ?? new Date();
  const groups = groupConsecutive(entries, (e) => formatDayGroupLabel(e.at, at));
  // 같은 화면에 목록이 둘(개인·공용) 떠도 id 가 겹치지 않게 — 묶음 이름은 공백이 있어 IDREF 로 쓸 수 없다.
  const baseId = useId();
  return (
    <div data-testid={testId} className="space-y-4">
      {groups.map((g, gi) => {
        const headingId = `${baseId}-g${gi}`;
        return (
          <section key={g.label} aria-labelledby={headingId} className="space-y-1">
            <h3 id={headingId} className="text-xs font-medium text-muted-foreground">
              {g.label}
            </h3>
            <ul className="divide-y rounded-md border">
              {g.entries.map((e) => (
                <ChangeItem
                  key={e.id}
                  idPrefix={`${baseId}-e${e.id}`}
                  entry={e}
                  onUndo={onUndo}
                  undoing={isUndoing?.(e.id) ?? false}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** 보조 줄 조각 — 이전 내용(취소선)·사유·출처 대화 링크를 " · " 로 잇는다. */
function detailParts(e: MemoryChangeLogEntry): ReactNode[] {
  const parts: ReactNode[] = [];
  if (e.before.length > 0) {
    parts.push(
      <>
        {e.beforeLabel ?? '이전'}:{' '}
        {e.before.map((b, i) => (
          <Fragment key={i}>
            {i > 0 && ' · '}
            <span className="line-through decoration-muted-foreground/60">{b}</span>
          </Fragment>
        ))}
      </>,
    );
  }
  if (e.note) parts.push(<>{e.note}</>);
  if (e.source) {
    parts.push(
      <>
        출처:{' '}
        <Link data-testid="memory-log-source" to={`/?${CHAT_PARAM}=${e.source.id}`} className={MEMORY_LINK}>
          {e.source.title || '제목 없는 대화'}
        </Link>
      </>,
    );
  }
  return parts;
}

function ChangeItem({
  idPrefix,
  entry: e,
  onUndo,
  undoing,
}: {
  /** 이 항목 안 요소 id 의 앞부분 — 되돌리기 버튼의 설명(aria-describedby)이 가리킨다. */
  idPrefix: string;
  entry: MemoryChangeLogEntry;
  onUndo?: (entry: MemoryChangeLogEntry) => Promise<unknown>;
  undoing: boolean;
}) {
  const Icon = ICONS[e.icon];
  const done = e.undoneAt != null;
  const parts = detailParts(e);
  const labelId = `${idPrefix}-label`;
  const contentId = `${idPrefix}-content`;
  // 이 화면에서 되돌리기를 눌렀는가 — 처음부터 되돌린 항목(목록을 열 때)에는 포커스를 옮기지 않는다.
  const undoClicked = useRef(false);
  const undoneRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // 되돌리기 성공으로 버튼이 사라지면 포커스가 body 로 떨어진다 — 그 자리의 되돌림 표시로 옮긴다.
    if (done && undoClicked.current) {
      undoClicked.current = false;
      undoneRef.current?.focus();
    }
  }, [done]);
  return (
    <li data-testid="memory-log-item" className="flex items-start gap-3 px-3 py-2.5 pointer-coarse:py-3">
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground', done && 'opacity-60')} />
      <div className={cn('min-w-0 flex-1 space-y-0.5', done && 'opacity-60')}>
        <p className="text-xs text-muted-foreground">
          <span id={labelId} data-testid="memory-log-label" className="font-medium text-foreground">
            {e.label}
          </span>
          {e.actor && <> · {e.actor}</>} · <span className="whitespace-nowrap">{formatClockTime(e.at)}</span>
        </p>
        <p
          id={contentId}
          data-testid="memory-log-content"
          className={cn('break-keep text-sm [overflow-wrap:anywhere]', e.removed && 'text-muted-foreground line-through')}
        >
          {e.content}
        </p>
        {parts.length > 0 && (
          <p data-testid="memory-log-details" className="break-keep text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {parts.map((p, i) => (
              <Fragment key={i}>
                {i > 0 && ' · '}
                {p}
              </Fragment>
            ))}
          </p>
        )}
      </div>
      {done ? (
        <span
          ref={undoneRef}
          data-testid="memory-log-undone"
          // 되돌린 직후 포커스를 받는 자리(탭 순서에는 넣지 않는다).
          tabIndex={-1}
          className="shrink-0 pt-0.5 text-xs whitespace-nowrap text-muted-foreground"
        >
          되돌림 · {formatClockTime(e.undoneAt)}
        </span>
      ) : (
        e.undoable &&
        onUndo && (
          <Button
            data-testid="memory-log-undo"
            variant="outline"
            size="sm"
            // 터치는 44px(다른 메모리 버튼과 같은 기준).
            className="h-7 shrink-0 px-2.5 text-xs pointer-coarse:h-11"
            aria-describedby={`${labelId} ${contentId}`}
            disabled={undoing}
            onClick={() => {
              undoClicked.current = true;
              // 실패(거부)면 바로 누름 표시를 지운다 — 나중에 다시 읽은 기록에서 이 항목이 되돌림으로 바뀌어도(다른 탭에서 되돌림) 포커스를 빼앗지
              // 않게. 거절 뒤 다시 읽은 기록이 화면에 닿기 전이라 렌더 순서에 기대지 않는다.
              void onUndo(e).catch(() => {
                undoClicked.current = false;
              });
            }}
          >
            되돌리기
          </Button>
        )
      )}
    </li>
  );
}
