// 관계 유형 추가·편집 창(WP-887) — 이름, 방향(있음/없음), A 쪽·B 쪽 말. 미리보기로 두 이슈 화면에서 실제로 어떻게 보이는지 보여 준다.
// 말은 「이 이슈는 ___」의 서술어다 — A → B 관계에서 A 이슈 화면엔 A 쪽 말, B 이슈 화면엔 B 쪽 말이 묶음 제목으로 나온다.
// 서버가 거절하면(이름 중복 409 등) 그 문구를 창 안에 보이고 닫지 않는다 — 고치던 값을 잃지 않게(WP-660 과 같은 원칙).

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { extractApiError, extractApiErrorCode } from '@/lib/api-error';
import { relationTypeUsage } from '@/lib/issueRelations';
import { cn } from '@/lib/utils';
import { trimInvisible } from '@/lib/visibleText';

import { useCreateIssueRelationType, useUpdateIssueRelationType } from '../../../hooks/queries/useIssueRelationTypes';
import type { IssueRelationTypeAdmin, SaveIssueRelationTypeRequest } from '../../../types/issue';

/** 이름·말 최대 길이 — 서버와 같다. */
const MAX_LEN = 30;

export function IssueRelationTypeDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 고칠 유형 — 없으면 추가 창. */
  editing: IssueRelationTypeAdmin | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="relation-type-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? '관계 유형 편집' : '관계 유형 추가'}</DialogTitle>
          <DialogDescription className="sr-only">관계 유형의 이름과 두 이슈 화면에서 보일 말을 정합니다.</DialogDescription>
        </DialogHeader>
        {/* 본문은 열릴 때마다 새로 마운트돼 입력이 처음 값으로 돌아간다. */}
        <RelationTypeForm editing={editing} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RelationTypeForm({ editing, onDone }: { editing: IssueRelationTypeAdmin | null; onDone: () => void }) {
  const [name, setName] = useState(editing?.name ?? '');
  const [directed, setDirected] = useState(editing?.directed ?? true);
  const [outward, setOutward] = useState(editing?.outwardLabel ?? '');
  const [inward, setInward] = useState(editing?.inwardLabel ?? '');
  const [showErrors, setShowErrors] = useState(false);
  // 서버 거절 — 이름 중복은 이름 칸 아래, 그 밖은 창 아래에 보인다.
  const [serverError, setServerError] = useState<{ field: 'name' | 'form'; message: string } | null>(null);

  const create = useCreateIssueRelationType();
  const update = useUpdateIssueRelationType();
  const pending = create.isPending || update.isPending;
  // 쓰이는 관계가 있으면 방향을 바꿀 수 없다(서버도 409) — 미리 막고 이유를 보인다.
  const inUse = editing != null && relationTypeUsage(editing) > 0;

  // 제로폭 공백·점자 빈칸처럼 보이지 않는 글자만이면 빈 칸으로 본다(WP-1106) — 서버도 같은 기준으로 400.
  const lengthError = (v: string, what: string) => {
    const t = trimInvisible(v);
    return !t ? `${what}을 입력해 주세요` : t.length > MAX_LEN ? `${what}은 ${MAX_LEN}자 이하로 입력해 주세요` : undefined;
  };
  const nameError = lengthError(name, '이름');
  const outwardError = lengthError(outward, '말');
  const inwardError = directed ? lengthError(inward, '말') : undefined;

  async function submit() {
    if (nameError || outwardError || inwardError) {
      setShowErrors(true);
      return;
    }
    const body: SaveIssueRelationTypeRequest = {
      name: trimInvisible(name),
      directed,
      outwardLabel: trimInvisible(outward),
      inwardLabel: directed ? trimInvisible(inward) : null,
    };
    setServerError(null);
    try {
      if (editing) await update.mutateAsync({ id: editing.id, body });
      else await create.mutateAsync(body);
      onDone();
    } catch (e) {
      const message = extractApiError(e, editing ? '관계 유형을 고치지 못했습니다' : '관계 유형을 추가하지 못했습니다');
      setServerError({ field: extractApiErrorCode(e) === 'RELATION_TYPE_NAME_TAKEN' ? 'name' : 'form', message });
    }
  }

  // 미리보기 말 — 비어 있으면 자리표시.
  const a = trimInvisible(outward) || '…';
  const b = directed ? trimInvisible(inward) || '…' : a;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending) void submit();
      }}
    >
      <FormField
        label="이름"
        htmlFor="relation-type-name"
        error={(serverError?.field === 'name' ? serverError.message : undefined) ?? (showErrors ? nameError : undefined)}
      >
        <Input
          id="relation-type-name"
          value={name}
          placeholder="예: 테스트"
          onChange={(e) => {
            setName(e.target.value);
            if (serverError?.field === 'name') setServerError(null);
          }}
          data-testid="relation-type-name"
        />
      </FormField>

      <div className="space-y-2">
        <Label id="relation-type-direction-label">방향</Label>
        {/* 두 칸짜리 고르개 — 방향 있음(A·B 말이 다름) / 없음(양쪽 같은 말). */}
        <div
          role="radiogroup"
          aria-labelledby="relation-type-direction-label"
          className="inline-flex rounded-md border p-0.5"
        >
          {[
            { value: true, label: '방향 있음' },
            { value: false, label: '방향 없음 (양쪽 같은 말)' },
          ].map((o) => (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={directed === o.value}
              disabled={inUse}
              onClick={() => setDirected(o.value)}
              className={cn(
                'rounded px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-11',
                directed === o.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
              data-testid={`relation-type-directed-${o.value}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {inUse && (
          <p className="text-xs text-muted-foreground" data-testid="relation-type-direction-locked">
            이 유형으로 걸린 관계가 있어 방향은 바꿀 수 없어요.
          </p>
        )}
      </div>

      <FormField
        label={directed ? 'A → B 일 때 A 이슈에서 보이는 말' : '두 이슈에서 보이는 말'}
        htmlFor="relation-type-outward"
        error={showErrors ? outwardError : undefined}
      >
        <Input
          id="relation-type-outward"
          value={outward}
          placeholder={directed ? '예: 테스트 케이스' : '예: 관련'}
          onChange={(e) => setOutward(e.target.value)}
          data-testid="relation-type-outward"
        />
      </FormField>
      {directed && (
        <FormField label="A → B 일 때 B 이슈에서 보이는 말" htmlFor="relation-type-inward" error={showErrors ? inwardError : undefined}>
          <Input
            id="relation-type-inward"
            value={inward}
            placeholder="예: 테스트 대상"
            onChange={(e) => setInward(e.target.value)}
            data-testid="relation-type-inward"
          />
        </FormField>
      )}

      {/* 미리보기 — #31 이 A, #12 가 B 인 관계가 각 이슈의 「관계」 묶음에 어떻게 보이는지. */}
      <div className="space-y-1 rounded-md bg-muted/60 px-3 py-2.5 text-sm" data-testid="relation-type-preview">
        <p className="text-xs text-muted-foreground">미리보기</p>
        <p>
          <span className="text-muted-foreground">#31 에서:</span> <strong className="font-semibold">{a}</strong>
          <span className="text-muted-foreground"> · </span>
          <span className="font-mono text-xs text-muted-foreground">#12</span>
        </p>
        <p>
          <span className="text-muted-foreground">#12 에서:</span> <strong className="font-semibold">{b}</strong>
          <span className="text-muted-foreground"> · </span>
          <span className="font-mono text-xs text-muted-foreground">#31</span>
        </p>
      </div>

      {serverError?.field === 'form' && (
        <p role="alert" className="text-sm text-destructive" data-testid="relation-type-error">
          {serverError.message}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          취소
        </Button>
        <Button type="submit" disabled={pending} data-testid="relation-type-submit">
          {editing ? '저장' : '추가'}
        </Button>
      </DialogFooter>
    </form>
  );
}
