// 버전 만들기·편집 대화상자(WP-888) — 이름·설명·시작일·출시일. 서버가 거절하면(이름 중복·날짜 순서·상한 등) 문구를 창 안에 보이고 닫지 않는다
// (구성요소 편집 창과 같은 방식). 저장 요청도 여기서 보낸다 — 목록과 상세 둘 다 같은 창을 쓰기 때문.
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { extractApiError } from '@/lib/api-error';
import { INCOMPLETE_DATE_MESSAGE, isIncompleteDateInput } from '@/lib/dateInput';

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

  // 덜 넣은 날짜 안내(WP-1644, 판정 이유는 lib/dateInput) — 막지 않으면 만들기는 날짜가 빠지고, 고치기는 저장된 날짜가 clear* 로 지워진다.
  // 저장 때 칸 요소를 직접 읽으려고 잡아 둔다.
  const startRef = useRef<HTMLInputElement | null>(null);
  const releaseRef = useRef<HTMLInputElement | null>(null);
  const [incomplete, setIncomplete] = useState({ start: false, release: false });

  /**
   * 이미 선 안내 중 덜 넣음이 풀린 칸의 안내를 거둔다 — 폼의 change·keyUp·blur 에서 부른다(칸을 비우면 change 가 없고,
   * 달력으로 고르면 change 만 온다). 바뀐 것이 없으면 같은 상태를 돌려 다시 그리지 않는다.
   */
  const recheckDates = () =>
    setIncomplete((prev) => {
      const next = {
        start: prev.start && isIncompleteDateInput(startRef.current),
        release: prev.release && isIncompleteDateInput(releaseRef.current),
      };
      return next.start === prev.start && next.release === prev.release ? prev : next;
    });

  const dateInvalid = isVersionDateRangeInvalid(startDate, releaseDate);
  // 입력을 바꾸면 옛 서버 오류(이름 중복 등)를 지운다 — 서버 오류는 그때 보낸 값에 대한 답이라 값이 바뀌면 더는 맞지 않는다(WP-1558).
  const edit = (set: (v: string) => void) => (v: string) => {
    setError(null);
    set(v);
  };

  async function save() {
    // 덜 넣은 날짜가 있으면 요청 없이 안내만 세운다 — 칸마다 따로 판정하고(이미 고친 칸의 지난 안내는 거둔다), 폼 제출 경로는 이 함수 하나다.
    const next = { start: isIncompleteDateInput(startRef.current), release: isIncompleteDateInput(releaseRef.current) };
    setIncomplete(next);
    if (next.start || next.release) return;
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
      {/* noValidate — 브라우저 기본 검사가 덜 넣은 날짜(badInput)를 먼저 잡으면 save() 에 닿지 못해 칸 아래 안내 대신 브라우저 말풍선이
          뜬다(WP-1644). 이 폼의 검사(이름 필수·날짜 범위·덜 넣은 날짜)는 모두 save() 와 단추 비활성이 맡는다 — 이슈 만들기(WP-900)와 같다. */}
      <form
        className="space-y-4"
        noValidate
        onChange={recheckDates}
        onKeyUp={recheckDates}
        onBlur={recheckDates}
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
            onChange={(e) => edit(setName)(e.target.value)}
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
            onChange={(e) => edit(setDescription)(e.target.value)}
            data-testid="version-description-input"
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="시작일" htmlFor="version-start" error={incomplete.start ? INCOMPLETE_DATE_MESSAGE : undefined}>
            <Input
              id="version-start"
              type="date"
              ref={startRef}
              value={startDate}
              onChange={(e) => edit(setStartDate)(e.target.value)}
              data-testid="version-start-input"
            />
          </FormField>
          <FormField label="출시일" htmlFor="version-release" error={incomplete.release ? INCOMPLETE_DATE_MESSAGE : undefined}>
            <Input
              id="version-release"
              type="date"
              ref={releaseRef}
              value={releaseDate}
              onChange={(e) => edit(setReleaseDate)(e.target.value)}
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
