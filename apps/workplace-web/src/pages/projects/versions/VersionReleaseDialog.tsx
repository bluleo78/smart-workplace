// 버전 출시 대화상자(WP-888) — 출시일(기본: 기존 출시 예정일, 없으면 오늘)을 확인하고, 아직 끝나지 않은 수정 버전 이슈가 있으면
// 다음 미출시 버전으로 옮길지 그대로 둘지 고른다. 옮길 대상은 같은 프로젝트의 다른 미출시 버전만(서버도 같은 규칙으로 거절한다).
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { extractApiError } from '@/lib/api-error';

import { useReleaseVersion, useVersionIssueCount, useVersions } from '../../../hooks/queries/useVersions';
import { kstDateKey } from '../../../lib/formatters';
import { isCountFresh, nextUnreleased } from '../../../lib/versions';
import type { VersionResponse } from '../../../types/version';

export function VersionReleaseDialog({
  projectKey,
  version,
  onClose,
}: {
  projectKey: string;
  /** 출시할 버전 — null 이면 닫힘. */
  version: VersionResponse | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={version != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      {version && <ReleaseForm key={version.id} projectKey={projectKey} version={version} onClose={onClose} />}
    </Dialog>
  );
}

type Choice = 'move' | 'keep';

function ReleaseForm({
  projectKey,
  version,
  onClose,
}: {
  projectKey: string;
  version: VersionResponse;
  onClose: () => void;
}) {
  const versions = useVersions(projectKey);
  const count = useVersionIssueCount(projectKey, version.id);
  const release = useReleaseVersion(projectKey);
  const [date, setDate] = useState(version.releaseDate ?? kstDateKey(new Date()));
  const [choice, setChoice] = useState<Choice>('move');
  // 사용자가 고른 대상 — 없으면 목록 순서상 다음 미출시 버전을 기본으로.
  const [pickedTarget, setPickedTarget] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useMemo(() => versions.data ?? [], [versions.data]);
  // 옮길 수 있는 대상 — 자기 자신을 뺀 미출시 버전(목록 순서).
  const targets = useMemo(() => list.filter((x) => x.status === 'UNRELEASED' && x.id !== version.id), [list, version.id]);
  const unresolved = count.data?.unresolvedFix ?? 0;
  const targetId = pickedTarget ?? nextUnreleased(list, version.id)?.id ?? targets[0]?.id ?? null;
  // 옮길 대상이 없으면 「그대로 두기」만 가능하다.
  const moving = unresolved > 0 && choice === 'move' && targetId != null && targets.length > 0;

  // 끝나지 않은 이슈 수를 읽기 전에는 출시하지 않는다 — 읽는 중엔 옮기기 선택지가 숨어 있어 되돌릴 수 없는 출시가 이슈를 두고 나갈 수 있다.
  // 캐시에 남은 옛 수가 아니라 이번 열림에서 새로 읽은 수여야 한다(isCountFresh).
  const countReady = isCountFresh(count);

  async function submit() {
    if (!date || release.isPending || !countReady) return;
    setError(null);
    try {
      await release.mutateAsync({
        id: version.id,
        body: { releaseDate: date, ...(moving && targetId != null ? { moveUnresolvedTo: targetId } : {}) },
      });
      toast.success('버전을 출시했어요');
      onClose();
    } catch (e) {
      setError(extractApiError(e, '출시하지 못했습니다'));
    }
  }

  return (
    <DialogContent data-testid="version-release-dialog">
      {/* DialogContent 는 grid 라 자식이 min-width:auto 로 줄바꿈 없는 긴 버전 이름 폭까지 늘어나 창을 넘친다(WP-1137).
          자식(RadioGroup 도 grid 라 그 안의 칸까지)에 min-w-0 을 주어 창 폭에 묶고, 제목은 닫기(X) 자리를 비우고 줄을 바꾸며 고르는 칸은 말줄임으로 자른다. */}
      <DialogHeader className="min-w-0">
        <DialogTitle className="pr-6 leading-snug wrap-anywhere">{version.name} 출시</DialogTitle>
        <DialogDescription className="sr-only">{version.name} 출시</DialogDescription>
      </DialogHeader>
      <form
        className="min-w-0 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormField label="출시일" htmlFor="version-release-date" required>
          <Input
            id="version-release-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="version-release-date"
          />
        </FormField>
        {unresolved > 0 && (
          <div className="space-y-2" data-testid="version-release-unresolved">
            <p className="text-sm">아직 끝나지 않은 이슈 {unresolved}건이 있어요.</p>
            <RadioGroup value={choice} onValueChange={(v) => setChoice(v as Choice)}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="move" id="version-release-move" disabled={targets.length === 0} />
                <Label htmlFor="version-release-move">다음 버전으로 옮기기</Label>
              </div>
              {choice === 'move' && targets.length > 0 && (
                <div className="min-w-0 pl-6">
                  <Select value={targetId == null ? undefined : String(targetId)} onValueChange={(v) => setPickedTarget(Number(v))}>
                    <SelectTrigger className="w-full min-w-0 *:data-[slot=select-value]:block *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate" aria-label="옮길 버전" data-testid="version-release-target">
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
                <RadioGroupItem value="keep" id="version-release-keep" />
                <Label htmlFor="version-release-keep">그대로 두기</Label>
              </div>
            </RadioGroup>
          </div>
        )}
        {count.isError && (
          // 수를 읽지 못하면 출시는 계속 잠겨 있으므로, 이유와 다시 시도를 함께 보인다.
          <div role="alert" className="flex items-center gap-2 text-sm text-destructive" data-testid="version-release-count-error">
            <span>끝나지 않은 이슈 수를 불러오지 못했습니다</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void count.refetch()} data-testid="version-release-count-retry">
              다시 시도
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="version-release-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={!date || release.isPending || !countReady} data-testid="version-release-submit">
            출시
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
