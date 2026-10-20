// 메일 작성창 첨부 칩 목록(WP-574) — 본문 아래·보내기 줄 바로 위. 첨부가 많으면 줄바꿈한다.
// 칩: 파일 종류 아이콘 · 이름(확장자는 남기고 앞부분 말줄임) · 크기 · ✕(첨부 빼기).
// 올리는 중은 칩 아래 얇은 진행 막대 + %, 실패는 destructive 톤 + 사유(+ 다시 시도로 풀리는 실패면 「다시 시도」).
// 보내기가 잠겨 있으면(올리는 중·실패) 합계 옆에 이유를 한 줄로 알린다(모바일은 상단 바 아래 상태 줄이 대신한다 — MailComposeDock).
// 데스크톱 아래 고정 줄(collapsible)은 칩을 한 줄만 보이고, 넘치면 「+N개」로 펼친다 — 고정 줄이 본문을 덮지 않게.

import { AlertCircle, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import { FileTypeIcon } from '@/components/drive/FileTypeIcon';
import { splitName } from '@/components/viewer/viewerNav';
import { formatFileSize } from '@/lib/formatters';
import { HIT_AREA } from '@/lib/hitArea';
import {
  type AttachmentTotals,
  COMPOSE_ATTACHMENT_LIMIT_LABEL,
  type ComposeAttachment,
  type SendBlock,
} from '@/lib/mailComposeAttachments';
import { cn } from '@/lib/utils';

export function MailComposeAttachmentChips({
  items,
  totals,
  failedCount,
  onRemove,
  onRetry,
  block,
  showBlockLine = true,
  collapsible = false,
}: {
  items: ComposeAttachment[];
  totals: AttachmentTotals;
  /** 실패 칩 수 — 합계 줄에 「실패 N」으로 붙인다(합계 개수엔 실패가 빠져 있어서). */
  failedCount: number;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
  /** 보내기 잠금(없으면 null) — useMailComposeAttachments 가 한 번 계산해 넘긴다. */
  block: SendBlock | null;
  /** 잠금 이유를 합계 옆에 보일지 — 모바일은 상단 바 아래 상태 줄이 보이므로 끈다(낭독용 live 영역은 늘 여기 있다). */
  showBlockLine?: boolean;
  /** 칩을 한 줄로 접고 넘치면 「+N개」로 펼친다(데스크톱 아래 고정 줄). */
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // 고정 줄은 손봐야 하는 실패 칩을 앞에 둔다 — 한 줄로 접혀도 무엇이 실패했는지(다시 시도·빼기) 바로 보이게. 나머지는 넣은 순서 그대로.
  const shown = collapsible ? [...items.filter((a) => a.status === 'error'), ...items.filter((a) => a.status !== 'error')] : items;
  const { listRef, hiddenFrom, rowHeight } = useFirstRowOverflow(collapsible, shown);
  // 접힌 상태에서 둘째 줄부터 숨는 칩 수(펼침 단추 「+N개」).
  const overflow = hiddenFrom == null ? 0 : shown.length - hiddenFrom;
  const collapsed = collapsible && !expanded && overflow > 0;
  const blockTone = block?.tone === 'error' ? 'text-destructive-text' : 'text-muted-foreground';

  return (
    <>
      {/* 보내기 잠금 이유를 보조기기에 알리는 live 영역 — 칩이 없을 때도 늘 마운트해 두고 글만 바꾼다.
          첫 칩과 함께 영역이 생기면 처음 문구(「올리는 중」)를 읽지 않는 화면 낭독기가 있다. 눈에 보이는 문구는 따로 둔다. */}
      <span role="status" className="sr-only" data-testid="mail-compose-attachments-status">
        {block?.reason ?? ''}
      </span>
      {items.length > 0 && (
        <section aria-label="첨부 파일" data-testid="mail-compose-attachments" className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            {/* 합계 — 보낼 첨부(실패 제외)의 개수·크기와 한 메일 상한. 인용문 본문 이미지처럼 칩에 없는 크기가 들어가면
                칩 크기를 더해도 맞지 않아 헷갈리므로 그 크기를 문구로 밝힌다. 실패 칩은 개수에서 빠지므로 따로 센다. */}
            <span className="text-muted-foreground" data-testid="mail-compose-attachments-total">
              첨부 {totals.count}개{failedCount > 0 && ` · 실패 ${failedCount}`} · {formatFileSize(totals.bytes)} /{' '}
              {COMPOSE_ATTACHMENT_LIMIT_LABEL}
              {totals.reservedBytes > 0 && ` · 본문 이미지 ${formatFileSize(totals.reservedBytes)} 포함`}
            </span>
            {/* 보내기가 잠긴 이유(눈에 보이는 줄) — 낭독은 위 live 영역이 하므로 aria-hidden. 색은 고른 이유의 톤을 따른다. */}
            {showBlockLine && block && (
              <span aria-hidden data-testid="mail-compose-send-blocked" className={blockTone}>
                {block.reason}
              </span>
            )}
            {collapsible && (overflow > 0 || expanded) && (
              <button
                type="button"
                data-testid="mail-compose-attachments-more"
                aria-expanded={!collapsed}
                onClick={() => setExpanded((v) => !v)}
                className={cn('ml-auto shrink-0 rounded px-1 font-medium text-primary hover:underline', HIT_AREA)}
              >
                {collapsed ? `+${overflow}개` : '접기'}
              </button>
            )}
          </div>
          <ul
            ref={listRef}
            // 접힌 동안은 첫 줄 높이로 자르고(포커스 링 몫 4px 더), 둘째 줄부터는 보이지도 초점을 받지도 않게 invisible.
            className={cn('-m-0.5 flex flex-wrap gap-2 p-0.5', collapsed && 'overflow-hidden')}
            style={collapsed && rowHeight ? { maxHeight: rowHeight + 4 } : undefined}
          >
            {shown.map((a, i) => (
              <AttachmentChip
                key={a.key}
                item={a}
                hidden={collapsed && hiddenFrom != null && i >= hiddenFrom}
                narrow={collapsible}
                onRemove={() => onRemove(a.key)}
                onRetry={() => onRetry(a.key)}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * 칩 목록에서 첫 줄 밖으로 넘친 첫 칩의 순번과 첫 줄 높이를 잰다 — 폭이 바뀌거나 칩이 바뀌면 다시 잰다.
 * 숨김은 visibility 로만 하므로(배치는 그대로) 접힘 여부와 무관하게 같은 값이 나온다.
 */
function useFirstRowOverflow(enabled: boolean, items: ComposeAttachment[]) {
  const listRef = useRef<HTMLUListElement>(null);
  const [state, setState] = useState<{ hiddenFrom: number | null; rowHeight: number }>({ hiddenFrom: null, rowHeight: 0 });
  useLayoutEffect(() => {
    const ul = listRef.current;
    if (!enabled || !ul) return;
    const measure = () => {
      const chips = Array.from(ul.children) as HTMLElement[];
      if (chips.length === 0) return;
      const top = chips[0].offsetTop;
      const idx = chips.findIndex((c) => c.offsetTop > top + 1);
      const next = { hiddenFrom: idx === -1 ? null : idx, rowHeight: chips[0].offsetHeight };
      setState((prev) => (prev.hiddenFrom === next.hiddenFrom && prev.rowHeight === next.rowHeight ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ul);
    return () => ro.disconnect();
  }, [enabled, items]);
  return { listRef, ...state };
}

/**
 * 칩 하나. 받은 메일 첨부 칩(MailInboxPage AttachmentList)과 같은 크기·모양을 써서 보내는 첨부와 받은 첨부가 한 모양으로 보이게 한다.
 * 터치(모바일)에선 칩 높이와 ✕·다시 시도를 44px 로 키운다 — 칩이 세로로 쌓여 hit 영역을 밖으로 넓히면 이웃 칩과 겹치므로 안쪽으로 키운다.
 */
function AttachmentChip({
  item,
  hidden,
  narrow,
  onRemove,
  onRetry,
}: {
  item: ComposeAttachment;
  hidden: boolean;
  /** 고정 줄(한 줄로 접힘)에선 칩 폭을 줄여 한 줄에 여러 개가 보이게 한다 — 긴 이름 하나가 줄을 다 차지하지 않게. */
  narrow: boolean;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const [head, tail] = splitName(item.name);
  const failed = item.status === 'error';
  const uploading = item.status === 'uploading';
  return (
    // min-w-0·max-w-full — 좁은 화면에서 이름이 줄바꿈 대신 말줄임되게(받은 첨부 칩과 같은 이유).
    <li
      data-testid={`mail-compose-attachment-${item.key}`}
      data-status={item.status}
      aria-busy={uploading || undefined}
      aria-hidden={hidden || undefined}
      className={cn(
        'relative flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border py-1 pr-1 pl-2 text-xs pointer-coarse:min-h-11 pointer-coarse:py-0 pointer-coarse:pr-0',
        // 실패 칩은 이름과 사유를 함께 읽어야 하므로 줄이지 않는다.
        narrow && !failed ? 'sm:max-w-[14rem]' : 'sm:max-w-[20rem]',
        failed ? 'border-destructive/40 bg-destructive-subtle text-destructive-text' : 'bg-muted',
        hidden && 'invisible',
      )}
    >
      {failed ? (
        <AlertCircle className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <FileTypeIcon mimeType={item.mimeType} className="size-3.5" />
      )}
      {/* whitespace-pre — 잘리는 자리 끝 공백이 flex 항목 끝에서 사라지지 않게. */}
      <span className="flex min-w-0" title={item.name}>
        <span className="min-w-0 truncate whitespace-pre">{head}</span>
        <span className="shrink-0 whitespace-pre">{tail}</span>
      </span>
      {/* 실패 사유는 서버 문구라 길 수 있다 — 이름을 다 밀어내지 않게 사유도 말줄임(전체는 title). */}
      <span
        className={cn('tabular-nums', failed ? 'min-w-0 max-w-[11rem] truncate' : 'shrink-0 text-muted-foreground')}
        title={failed ? item.error : undefined}
      >
        {failed ? item.error : uploading ? `${item.progress}%` : formatFileSize(item.size)}
      </span>
      {failed && item.retryable && (
        <button
          type="button"
          data-testid="mail-compose-attachment-retry"
          onClick={onRetry}
          className={cn(
            'shrink-0 rounded px-1 font-medium underline-offset-2 hover:underline pointer-coarse:min-h-11 pointer-coarse:px-2',
            HIT_AREA,
          )}
        >
          다시 시도
        </button>
      )}
      <button
        type="button"
        aria-label={`${item.name} 첨부 빼기`}
        title="첨부 빼기"
        data-testid="mail-compose-attachment-remove"
        onClick={onRemove}
        className={cn(
          'flex shrink-0 items-center justify-center rounded p-0.5 hover:bg-accent pointer-coarse:size-11 pointer-coarse:p-0',
          failed ? 'hover:bg-destructive/10' : 'text-muted-foreground hover:text-foreground',
          HIT_AREA,
        )}
      >
        <X className="size-3.5" />
      </button>
      {/* 진행 막대 — 칩 맨 아래 2px. 글자를 가리지 않고 진행만 알린다. 0%(첫 진행 이벤트 전)는 흐르는 불확정 막대로
          멈춘 것처럼 보이지 않게 한다(동작 줄이기면 멈춘 채 둔다). */}
      {uploading && (
        <span
          role="progressbar"
          aria-label={`${item.name} 올리는 중`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={item.progress}
          className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-primary/15"
        >
          {item.progress === 0 ? (
            <span
              data-testid="mail-compose-attachment-indeterminate"
              className="block h-full animate-convert-indeterminate bg-primary motion-reduce:animate-none"
            />
          ) : (
            <span className="block h-full bg-primary transition-[width] duration-200" style={{ width: `${item.progress}%` }} />
          )}
        </span>
      )}
    </li>
  );
}
