// 버전 삭제 확인(WP-888) — 보관한 버전만 지운다. 붙어 있던 수정·영향 이슈 수를 보여 주고, 다른 버전으로 옮길지 떼기만 할지 고른다
// (옮기면 같은 종류로 간다: 수정 → 수정, 영향 → 영향). 이슈가 없으면 옮길 곳을 묻지 않는다.
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { extractApiError } from '@/lib/api-error';
import { isCountFresh } from '@/lib/versions';

import { useDeleteVersion, useVersionIssueCount, useVersions } from '../../../hooks/queries/useVersions';
import type { VersionResponse } from '../../../types/version';

export function VersionDeleteDialog({
  projectKey,
  version,
  onClose,
  onDeleted,
}: {
  projectKey: string;
  /** 삭제할 버전 — null 이면 닫힘. */
  version: VersionResponse | null;
  onClose: () => void;
  /** 삭제가 끝난 뒤(상세 화면이 목록으로 돌아가는 데 쓴다). */
  onDeleted?: () => void;
}) {
  // 열림 상태는 DeleteForm 의 Dialog 가 갖는다 — 대상이 있을 때만 그려 대상마다 입력을 새로 채운다.
  return version ? (
    <DeleteForm key={version.id} projectKey={projectKey} version={version} onClose={onClose} onDeleted={onDeleted} />
  ) : null;
}

type Choice = 'move' | 'detach';

function DeleteForm({
  projectKey,
  version,
  onClose,
  onDeleted,
}: {
  projectKey: string;
  version: VersionResponse;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const versions = useVersions(projectKey);
  const count = useVersionIssueCount(projectKey, version.id);
  const del = useDeleteVersion(projectKey);
  const [choice, setChoice] = useState<Choice>('detach');
  const [target, setTarget] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 옮길 대상 — 자기 자신을 뺀 보관되지 않은 버전(출시된 것도 된다).
  const targets = useMemo(
    () => (versions.data ?? []).filter((x) => x.status !== 'ARCHIVED' && x.id !== version.id),
    [versions.data, version.id],
  );
  const fix = count.data?.fix ?? 0;
  const affects = count.data?.affects ?? 0;
  const hasIssues = fix + affects > 0;
  // 붙은 이슈 수를 새로 읽기 전에는 삭제하지 않는다 — 못 읽은 채 지우면 영향 안내 없이 이슈에서 조용히 떼어진다.
  const countReady = isCountFresh(count);
  const moveTo = choice === 'move' ? (target ?? targets[0]?.id ?? null) : null;

  async function submit() {
    if (del.isPending || !countReady) return;
    setError(null);
    try {
      await del.mutateAsync({ id: version.id, moveTo: hasIssues ? moveTo : null });
      toast.success('버전을 삭제했어요');
      onClose();
      onDeleted?.();
    } catch (e) {
      setError(extractApiError(e, '삭제하지 못했습니다'));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="version-delete-dialog">
        <DialogHeader>
          <DialogTitle>버전 삭제</DialogTitle>
          <DialogDescription>
            &quot;{version.name}&quot; 버전을 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        {hasIssues && (
          <div className="space-y-2" data-testid="version-delete-impact">
            <p className="text-sm text-muted-foreground">
              수정 버전으로 붙은 이슈 {fix}건, 영향 버전으로 붙은 이슈 {affects}건이 있어요.
            </p>
            <RadioGroup value={choice} onValueChange={(v) => setChoice(v as Choice)}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="move" id="version-delete-move" disabled={targets.length === 0} />
                <Label htmlFor="version-delete-move">다른 버전으로 옮기기</Label>
              </div>
              {choice === 'move' && targets.length > 0 && (
                <div className="pl-6">
                  <Select value={String(moveTo)} onValueChange={(v) => setTarget(Number(v))}>
                    <SelectTrigger className="w-full" aria-label="옮길 버전" data-testid="version-delete-target">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {targets.map((x) => (
                        <SelectItem key={x.id} value={String(x.id)}>
                          {x.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-center gap-2">
                <RadioGroupItem value="detach" id="version-delete-detach" />
                <Label htmlFor="version-delete-detach">이슈에서 떼기</Label>
              </div>
            </RadioGroup>
          </div>
        )}
        {count.isError && (
          // 수를 읽지 못하면 삭제는 계속 잠겨 있으므로, 이유와 다시 시도를 함께 보인다.
          <div role="alert" className="flex items-center gap-2 text-sm text-destructive" data-testid="version-delete-count-error">
            <span>붙은 이슈 수를 불러오지 못했습니다</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void count.refetch()} data-testid="version-delete-count-retry">
              다시 시도
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="version-delete-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={del.isPending || !countReady}
            onClick={() => void submit()}
            data-testid="version-delete-confirm"
          >
            삭제
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
