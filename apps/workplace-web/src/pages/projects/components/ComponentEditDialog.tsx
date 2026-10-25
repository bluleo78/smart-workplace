// 구성요소 추가·편집 대화창(WP-933) — 이름·설명·담당자. 서버가 거절하면(이름 중복·담당자 무효 등) 문구를 창 안에 보이고 닫지 않는다
// (라벨 편집 창과 같은 방식이라 호출부 훅은 실패 토스트를 띄우지 않는다).
// 담당자는 이 프로젝트의 활성 사람 구성원만 고를 수 있다(AI 는 담당자로 들어가는 순간 작업이 시작돼 제외). 저장된 담당자가 무효가 됐으면
// 선택지에 「(구성원 아님)」으로 남겨, 창을 열고 다른 것만 고쳐도 담당자가 몰래 바뀌지 않게 한다.

import { useState } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { extractApiError } from '@/lib/api-error';

import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { assigneeCandidates } from '../../../lib/assigneeCandidates';
import type { ComponentDraft } from '../../../lib/issueComponents';
import { COMPONENT_DESCRIPTION_MAX, COMPONENT_NAME_MAX, type ComponentResponse } from '../../../types/component';

/** 담당자 「없음」 선택값 — Radix Select 는 빈 문자열 값을 쓸 수 없어 토큰을 둔다. */
const NO_ASSIGNEE = 'none';

export function ComponentEditDialog({
  projectKey,
  open,
  target,
  onSave,
  onClose,
}: {
  projectKey: string;
  open: boolean;
  /** 편집 대상 — null 이면 추가. */
  target: ComponentResponse | null;
  /** 저장 — resolve 되면 닫고, reject 되면 서버 문구를 창 안에 보인다. */
  onSave: (draft: ComponentDraft) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* 대상이 바뀔 때마다 입력을 새로 채우려고 key 로 다시 그린다(추가는 'new'). */}
      {open && <EditForm key={target?.id ?? 'new'} projectKey={projectKey} target={target} onSave={onSave} onClose={onClose} />}
    </Dialog>
  );
}

function EditForm({
  projectKey,
  target,
  onSave,
  onClose,
}: {
  projectKey: string;
  target: ComponentResponse | null;
  onSave: (draft: ComponentDraft) => Promise<unknown>;
  onClose: () => void;
}) {
  const members = useProjectMembers(projectKey);
  const [name, setName] = useState(target?.name ?? '');
  const [description, setDescription] = useState(target?.description ?? '');
  const [assigneeId, setAssigneeId] = useState<number | null>(target?.defaultAssignee?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 담당자 선택지 — 활성 사람 구성원. 저장된 담당자가 무효이면(구성원에서 빠짐·비활성) 「(구성원 아님)」으로 남긴다.
  // 판단은 서버 플래그(defaultAssigneeValid)로 한다 — 구성원 목록을 아직 불러오는 동안 유효한 담당자가 잠깐 「구성원 아님」으로 비치지 않게.
  const candidates = assigneeCandidates(members.data?.filter((m) => m.kind === 'HUMAN'));
  const stale = target?.defaultAssignee && target.defaultAssigneeValid === false ? target.defaultAssignee : null;

  async function save() {
    if (!name.trim() || saving) return;
    setError(null);
    setSaving(true);
    try {
      await onSave({ name, description, assigneeId });
      onClose();
    } catch (e) {
      setError(extractApiError(e, '저장하지 못했습니다'));
    } finally {
      setSaving(false);
    }
  }

  const title = target ? '구성요소 편집' : '구성요소 추가';
  return (
    <DialogContent data-testid="component-edit-dialog">
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
        <FormField label="이름" htmlFor="component-name" required>
          <Input
            id="component-name"
            value={name}
            maxLength={COMPONENT_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: Compute"
            data-testid="component-name-input"
          />
        </FormField>
        <FormField label="설명" htmlFor="component-description">
          <Textarea
            id="component-description"
            value={description}
            maxLength={COMPONENT_DESCRIPTION_MAX}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="component-description-input"
          />
        </FormField>
        <FormField label="담당자" htmlFor="component-assignee">
          <Select
            value={assigneeId == null ? NO_ASSIGNEE : String(assigneeId)}
            onValueChange={(v) => setAssigneeId(v === NO_ASSIGNEE ? null : Number(v))}
          >
            <SelectTrigger id="component-assignee" className="w-full" data-testid="component-assignee-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ASSIGNEE}>없음</SelectItem>
              {stale && <SelectItem value={String(stale.id)}>{stale.name} (구성원 아님)</SelectItem>}
              {candidates.map((m) => (
                <SelectItem key={m.userId} value={String(m.userId)}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">담당자 없이 만든 이슈에 이 구성요소를 고르면 담당자로 붙어요.</p>
        </FormField>
        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="component-edit-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={!name.trim() || saving} data-testid="component-save">
            저장
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
