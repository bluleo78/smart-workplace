// 메모리 카드의 한 줄(WP-55, 시안 A) — 종류 배지 + 내용 + 메타(AI가 저장/직접 추가 · 날짜) + 수정·삭제.
// 수정은 제자리 입력(300자 카운트, 취소/저장), 삭제는 즉시 + 되돌리기 토스트(훅). 터치 기기는 아이콘 버튼을 44px 로 키운다.
// 배치: 데스크톱은 [배지][내용+메타][아이콘] 한 줄. 터치(모바일)는 아이콘 두 개(88px)가 오른쪽을 먹어 내용이 11자 폭으로 접히던 문제가 있어
// 아이콘을 메타 줄 오른쪽으로 내리고(내용은 아이콘 아래 폭까지 쓴다), 44px 터치 영역은 음수 마진으로 줄 높이를 늘리지 않은 채 유지한다.
// WP-379: 제자리 고치기에서 범위도 옮긴다(가득 찬 범위는 고를 수 없다).
// WP-383: 수정 앞 핀(고정) 토글 — 고정이면 채운 핀 + 메타 맨 앞 "고정"(터치는 채운 핀이 대신해 글자는 sr-only). 범위 고정이 가득이면 고정 안 된 행의 핀을 막고
// 데스크톱은 호버·포커스 툴팁, 터치는 탭 토스트로 이유를 알린다(고정 풀기는 늘 된다). 터치에선 배지를 첫 줄에만 두고 메타를 배지 열부터 시작해 행이 두 줄로 유지된다.
// 핀 이름은 늘 "고정"이고 상태는 aria-pressed 가 말한다. 막힌 핀은 disabled 가 아닌 aria-disabled 버튼 — 포커스·탭을 받아 이유를 알리고, 흐림(opacity) 대신
// 한 단계 옅은 색 + not-allowed 커서로 보통 핀과 구분하면서도 눌러 볼 수 있어 보이게 한다.
// WP-380: 메타 끝에 기한("10월 24일까지"), 고치기에서 기한도 고른다. 만료 행(서버 expired)은 흐리게 + "만료됨 · …까지 · …에 지워져요" + 기한 연장·계속 기억.
import { Pencil, Pin, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDeleteAiMemory, usePinAiMemory, useUpdateAiMemory } from '@/hooks/queries/useAiMemories';
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer';
import { type AiMemoryScopeKey, expiryPatch, MEMORY_LINK, purgeDateKey, scopeKeyOf } from '@/lib/aiMemory';
import { formatDateOnly, formatDateOnlyMonthDay } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { AiMemoryContentEditor } from '@/pages/settings/AiMemoryContentEditor';
import { AiMemoryExpiryPicker } from '@/pages/settings/AiMemoryExpiryPicker';
import { AiMemoryScopeSelect } from '@/pages/settings/AiMemoryScopeSelect';
import type { AiMemoryItem } from '@/types/aiMemory';

/** 종류 배지 — 선호는 AI 보라(ai-accent), 맥락은 info(하늘). 둘 다 라이트/다크 토큰 쌍(시안 A). */
export const KIND_BADGE = {
  PREFERENCE: { label: '선호', variant: 'ai' },
  CONTEXT: { label: '맥락', variant: 'info' },
} as const;

export function AiMemoryRow({
  item,
  fullScopes,
  pinFullHint,
}: {
  item: AiMemoryItem;
  fullScopes: ReadonlySet<AiMemoryScopeKey>;
  /** 이 범위 고정이 가득일 때의 안내 문구(가득이 아니면 null) — 고정 안 된 행의 핀을 막는다. */
  pinFullHint: string | null;
}) {
  const update = useUpdateAiMemory();
  const remove = useDeleteAiMemory();
  const pin = usePinAiMemory();
  // 터치(거친 포인터)는 호버가 없어 막힌 핀의 이유를 툴팁 대신 토스트로 알린다.
  const coarse = useIsCoarsePointer();
  const pinned = item.pinned === true;
  // 고정 풀기는 늘 된다 — 막는 것은 가득 찬 범위에서 새로 고정하는 것뿐.
  const pinBlocked = !pinned && pinFullHint != null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const scope = scopeKeyOf(item.scope);
  const [draftScope, setDraftScope] = useState<AiMemoryScopeKey>(scope);
  const expiry = item.expiresOn ?? null;
  const [draftExpiry, setDraftExpiry] = useState<string | null>(expiry);
  const expired = item.expired === true;
  const badge = KIND_BADGE[item.kind];

  const startEdit = () => {
    setDraft(item.content);
    setDraftScope(scope);
    setDraftExpiry(expiry);
    setEditing(true);
  };
  const save = () => {
    const scopeChanged = draftScope !== scope;
    const expiryBody = expiryPatch(expiry, draftExpiry);
    // 바뀐 게 없으면 요청하지 않고 닫는다(updatedAt 이 바뀌어 맨 위로 튀지 않게).
    if (draft.trim() === item.content && !scopeChanged && Object.keys(expiryBody).length === 0) return setEditing(false);
    update.mutate(
      // 범위는 바뀔 때만 싣는다(present-flag — 키가 있으면 서버가 옮긴다, 공통은 null). 기한도 바뀔 때만(지정 또는 없애기).
      { id: item.id, content: draft, ...(scopeChanged ? { scope: draftScope === 'COMMON' ? null : draftScope } : {}), ...expiryBody },
      { onSuccess: () => setEditing(false) },
    );
  };
  /** 만료 행 되살리기 — 기한 연장(새 날짜) 또는 계속 기억(null). 내용은 그대로. 그 범위가 가득이면 서버 409 를 훅이 토스트로 띄운다. */
  const revive = (next: string | null) => update.mutate({ id: item.id, ...expiryPatch(expiry, next) });

  const onPin = () => {
    if (pinBlocked) {
      if (coarse) toast.info(pinFullHint);
      return;
    }
    pin.mutate({ id: item.id, pinned: !pinned });
  };
  const pinButton = (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        'size-7 pointer-coarse:size-11',
        pinned
          ? 'text-primary hover:text-primary'
          : pinBlocked
            ? 'cursor-not-allowed text-muted-foreground/70 hover:bg-transparent hover:text-muted-foreground/70'
            : 'text-muted-foreground',
      )}
      aria-label="고정"
      aria-pressed={pinned}
      aria-disabled={pinBlocked || undefined}
      data-testid="ai-memory-pin"
      disabled={pin.isPending}
      onClick={onPin}
    >
      <Pin className={cn('size-3.5', pinned && 'fill-current')} />
    </Button>
  );

  return (
    <li
      data-testid="ai-memory-row"
      data-id={item.id}
      data-expired={expired ? 'true' : undefined}
      // 3열 격자(배지·내용·아이콘). 터치는 2열로 접고 내용(p)이 아이콘 열까지 가로지르며, 아이콘은 메타 줄(2행)로 내려온다.
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-2 pointer-coarse:py-3.5"
    >
      <Badge
        variant={badge.variant}
        className={cn('col-[1] row-[1/span_2] mt-0.5 pointer-coarse:row-[1]', expired && 'opacity-60')}
        data-testid="ai-memory-kind"
      >
        {badge.label}
      </Badge>
      {editing ? (
        <div className="col-[2/span_2] row-[1/span_2] min-w-0 space-y-1.5">
          <AiMemoryContentEditor
            value={draft}
            onChange={setDraft}
            onCancel={() => setEditing(false)}
            onSubmit={save}
            submitLabel="저장"
            pending={update.isPending}
            rows={2}
            ariaLabel="메모리 내용"
            testIdPrefix="ai-memory-edit"
            fields={
              <>
                <AiMemoryScopeSelect value={draftScope} onChange={setDraftScope} fullScopes={fullScopes} current={scope} testId="ai-memory-edit-scope" />
                <AiMemoryExpiryPicker value={draftExpiry} onChange={setDraftExpiry} testId="ai-memory-edit-expiry" />
              </>
            }
          />
        </div>
      ) : (
        <>
          <p
            data-testid="ai-memory-content"
            className={cn(
              'col-[2] row-[1] min-w-0 whitespace-pre-wrap break-keep text-sm [overflow-wrap:anywhere] pointer-coarse:col-[2/span_2]',
              expired && 'text-muted-foreground opacity-60',
            )}
          >
            {item.content}
          </p>
          {/* 날짜는 하이픈·공백에서 끊기지 않게 한 덩어리로 — " · " 에서만 줄이 바뀐다. */}
          <p
            data-testid="ai-memory-meta"
            className="col-[2] row-[2] min-w-0 text-xs text-muted-foreground pointer-coarse:col-[1/span_2] pointer-coarse:self-center"
          >
            {expired && expiry ? (
              <>
                만료됨 · <span className="whitespace-nowrap">{formatDateOnlyMonthDay(expiry)}까지</span> ·{' '}
                <span className="whitespace-nowrap">{formatDateOnlyMonthDay(purgeDateKey(expiry))}에 지워져요</span>
                {' · '}
                <AiMemoryExpiryPicker value={expiry} onChange={revive} testId="ai-memory-extend" variant="link" disabled={update.isPending} />
                {' · '}
                <button type="button" data-testid="ai-memory-keep" className={MEMORY_LINK} disabled={update.isPending} onClick={() => revive(null)}>
                  계속 기억
                </button>
              </>
            ) : (
              <>
                {pinned && (
                  // 터치는 같은 줄의 채운 핀이 바로 옆이라 글자는 화면에서만 뺀다(메타가 한 줄에 들어가게, 읽기 도구엔 남긴다).
                  <span className="pointer-coarse:sr-only">
                    <span data-testid="ai-memory-pinned" className="font-medium text-foreground">
                      고정
                    </span>
                    {' · '}
                  </span>
                )}
                {item.source === 'AI' ? 'AI가 저장' : '직접 추가'} · <span className="whitespace-nowrap">{formatDateOnly(item.updatedAt)}</span>
                {expiry && (
                  <>
                    {' · '}
                    <span data-testid="ai-memory-expiry" className="whitespace-nowrap">
                      {formatDateOnlyMonthDay(expiry)}까지
                    </span>
                  </>
                )}
              </>
            )}
          </p>
          <div className="col-[3] row-[1/span_2] flex gap-0.5 pointer-coarse:row-[2] pointer-coarse:-my-3.5 pointer-coarse:-mr-1.5">
            {pinBlocked ? (
              // 터치는 호버가 없어 툴팁을 열지 않는다(탭하면 onPin 이 토스트).
              <Tooltip open={coarse ? false : undefined}>
                <TooltipTrigger asChild>{pinButton}</TooltipTrigger>
                <TooltipContent>{pinFullHint}</TooltipContent>
              </Tooltip>
            ) : (
              pinButton
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 pointer-coarse:size-11"
              aria-label="수정"
              data-testid="ai-memory-edit"
              onClick={startEdit}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive pointer-coarse:size-11"
              aria-label="삭제"
              data-testid="ai-memory-delete"
              disabled={remove.isPending}
              onClick={() => remove.mutate(item)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
