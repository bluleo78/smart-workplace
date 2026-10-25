// 관계 유형 삭제 창(WP-887) — 쓰이는 곳이 없으면 확인만 묻고, 있으면 「다른 유형으로 옮기기 / 관계도 함께 삭제」를 고른다(Jira 방식).
// 옮길 수 있는 유형: 자기 자신·차단·외부 전용·숨긴 유형을 뺀 것(서버도 같은 규칙으로 거절한다).
// 창을 연 사이 누가 관계를 걸어 서버가 「사용 중」(409)으로 거절하면, 목록을 다시 받아 고르기 화면으로 바뀐다.

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { extractApiError, extractApiErrorCode } from '@/lib/api-error';
import { relationTypeMoveTargets, relationTypeUsage } from '@/lib/issueRelations';
import { cn } from '@/lib/utils';

import { issueRelationTypeKeys, useDeleteIssueRelationType } from '../../../hooks/queries/useIssueRelationTypes';
import type { IssueRelationTypeAdmin } from '../../../types/issue';

export function DeleteIssueRelationTypeDialog({
  target,
  types,
  open,
  onOpenChange,
}: {
  /** 지울 유형 — 쓰이는 곳 수는 관리 목록의 최신 값. */
  target: IssueRelationTypeAdmin | null;
  types: IssueRelationTypeAdmin[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="relation-type-delete-dialog">
        {target && <DeleteBody target={target} types={types} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function DeleteBody({
  target,
  types,
  onDone,
}: {
  target: IssueRelationTypeAdmin;
  types: IssueRelationTypeAdmin[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const remove = useDeleteIssueRelationType();
  const used = relationTypeUsage(target);
  const candidates = relationTypeMoveTargets(types, target);
  const [mode, setMode] = useState<'move' | 'delete'>(candidates.length > 0 ? 'move' : 'delete');
  // 옮길 곳 — 처음엔 「관련」(가장 흔한 대상), 없으면 첫 후보.
  const [moveTo, setMoveTo] = useState<string>(
    String((candidates.find((t) => t.code === 'RELATES') ?? candidates[0])?.id ?? ''),
  );
  const [error, setError] = useState<string | null>(null);
  const moveTarget = candidates.find((t) => String(t.id) === moveTo);

  async function confirm() {
    setError(null);
    try {
      if (used === 0) await remove.mutateAsync({ id: target.id });
      else if (mode === 'move') await remove.mutateAsync({ id: target.id, moveTo: moveTarget?.id });
      else await remove.mutateAsync({ id: target.id, deleteLinks: true });
      onDone();
    } catch (e) {
      setError(extractApiError(e, '관계 유형을 삭제하지 못했습니다'));
      // 연 사이 누가 관계를 걸었다 — 쓰이는 곳 수를 다시 받아 고르기 화면으로 바꾼다.
      if (extractApiErrorCode(e) === 'RELATION_TYPE_IN_USE') {
        void qc.invalidateQueries({ queryKey: issueRelationTypeKeys.admin() });
      }
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>「{target.name}」 유형 삭제</DialogTitle>
        <DialogDescription data-testid="relation-type-delete-summary">
          {used === 0
            ? '이 유형으로 걸린 관계가 없어요. 삭제할까요?'
            : `이 유형으로 걸린 관계가 ${used}건 있어요${target.externalLinkCount > 0 ? `(외부 링크 ${target.externalLinkCount}건 포함)` : ''}.`}
        </DialogDescription>
      </DialogHeader>

      {used > 0 && (
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'move' | 'delete')} className="gap-2" aria-label="걸린 관계 처리">
          <label
            htmlFor="relation-type-delete-move"
            className={cn('flex gap-3 rounded-md border p-3', mode === 'move' && 'border-foreground', candidates.length === 0 && 'opacity-60')}
          >
            <RadioGroupItem value="move" id="relation-type-delete-move" disabled={candidates.length === 0} className="mt-0.5" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium">다른 유형으로 옮기기</p>
              {candidates.length > 0 ? (
                <>
                  <Select value={moveTo} onValueChange={setMoveTo} disabled={mode !== 'move'}>
                    <SelectTrigger className="w-full" aria-label="옮길 유형" data-testid="relation-type-move-target">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {target.directed && moveTarget && !moveTarget.directed && (
                    <p className="text-xs text-muted-foreground">방향 있는 유형에서 방향 없는 유형으로 옮기면 방향은 사라져요.</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">옮길 수 있는 유형이 없어요.</p>
              )}
            </div>
          </label>
          <label
            htmlFor="relation-type-delete-links"
            className={cn('flex gap-3 rounded-md border p-3', mode === 'delete' && 'border-foreground')}
          >
            <RadioGroupItem value="delete" id="relation-type-delete-links" className="mt-0.5" data-testid="relation-type-delete-links" />
            <div className="space-y-1">
              <p className="text-sm font-medium">관계도 함께 삭제</p>
              <p className="text-xs text-muted-foreground">{used}건이 이슈에서 사라져요. 되돌릴 수 없어요.</p>
            </div>
          </label>
        </RadioGroup>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="relation-type-delete-error">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          취소
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={remove.isPending || (used > 0 && mode === 'move' && !moveTarget)}
          onClick={() => void confirm()}
          data-testid="relation-type-delete-confirm"
        >
          삭제
        </Button>
      </DialogFooter>
    </>
  );
}
