// 버전 만들기·편집 대화상자(WP-888) — 이름·설명·시작일·출시일. 서버가 거절하면(이름 중복·날짜 순서·상한 등) 문구를 창 안에 보이고 닫지 않는다
// (구성요소 편집 창과 같은 방식). 저장 요청도 여기서 보낸다 — 목록과 상세 둘 다 같은 창을 쓰기 때문.
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { extractApiError } from '@/lib/api-error';

import { useCreateVersion, useUpdateVersion } from '../../../hooks/queries/useVersions';
import { isVersionDateRangeInvalid, versionPatch } from '../../../lib/versions';
import { VERSION_DESCRIPTION_MAX, VERSION_NAME_MAX, type VersionResponse } from '../../../types/version';

export function VersionFormDialog({
  projectKey,
  open,
  target,
  onClose,
}: {
  projectKey: string;
  open: boolean;
  /** 편집 대상 — null 이면 만들기. */
  target: VersionResponse | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* 대상이 바뀔 때마다 입력을 새로 채우려고 key 로 다시 그린다(만들기는 'new'). */}
      {open && <VersionForm key={target?.id ?? 'new'} projectKey={projectKey} target={target} onClose={onClose} />}
    </Dialog>
  );
}

function VersionForm({
  projectKey,
  target,
  onClose,
}: {
  projectKey: string;
  target: VersionResponse | null;
  onClose: () => void;
}) {
  const create = useCreateVersion(projectKey);
  const update = useUpdateVersion(projectKey);
  const [name, setName] = useState(target?.name ?? '');
  const [description, setDescription] = useState(target?.description ?? '');
  const [startDate, setStartDate] = useState(target?.startDate ?? '');
  const [releaseDate, setReleaseDate] = useState(target?.releaseDate ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dateInvalid = isVersionDateRangeInvalid(startDate, releaseDate);

  async function save() {
    if (!name.trim() || dateInvalid || saving) return;
    setError(null);
    setSaving(true);
    try {
      if (target) {
        // 편집 — 바뀐 필드만 보낸다. 바뀐 게 없으면 요청 없이 닫는다.
        const body = versionPatch(target, { name, description, startDate, releaseDate });
        if (Object.keys(body).length > 0) {
          await update.mutateAsync({ id: target.id, body });
          toast.success('버전을 수정했어요');
        }
      } else {
        await create.mutateAsync({
          name: name.trim(),
          description: description.trim() || null,
          startDate: startDate || null,
          releaseDate: releaseDate || null,
        });
        toast.success('버전을 만들었어요');
      }
      onClose();
    } catch (e) {
      setError(extractApiError(e, '저장하지 못했습니다'));
    } finally {
      setSaving(false);
    }
  }

  const title = target ? '버전 편집' : '버전 만들기';
  return (
    <DialogContent data-testid="version-form-dialog">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="sr-only">{title}</DialogDescription>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <FormField label="이름" htmlFor="version-name" required>
          <Input
            id="version-name"
            value={name}
            maxLength={VERSION_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: v1.5.3"
            data-testid="version-name-input"
          />
        </FormField>
        <FormField label="설명" htmlFor="version-description">
          <Textarea
            id="version-description"
            value={description}
            maxLength={VERSION_DESCRIPTION_MAX}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="version-description-input"
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="시작일" htmlFor="version-start">
            <Input
              id="version-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              data-testid="version-start-input"
            />
          </FormField>
          <FormField label="출시일" htmlFor="version-release">
            <Input
              id="version-release"
              type="date"
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
              aria-invalid={dateInvalid}
              data-testid="version-release-input"
            />
          </FormField>
        </div>
        {dateInvalid && (
          <p role="alert" className="text-sm text-destructive" data-testid="version-date-error">
            시작일은 출시일보다 늦을 수 없어요.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="version-form-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={!name.trim() || dateInvalid || saving} data-testid="version-save">
            저장
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
