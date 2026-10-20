// 프로젝트 설정 — 프로젝트 필드 이름·옵션 편집 대화상자(WP-611).
// 예전엔 고칠 방법이 없어 옵션 하나를 더하려면 필드를 지워 모든 이슈 값을 잃어야 했다. 유형은 바꿀 수 없다(서버 불변).
// 쓰는 중인 옵션을 빼면 서버가 거절하므로(FieldOptionInUseException) 그 문구를 대화상자 안에 보이고 닫지 않는다.

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
import { Input } from '@/components/ui/input';
import { extractApiError } from '@/lib/api-error';
import { formatFieldOptions, parseFieldOptions } from '@/lib/customFieldOptions';

import { useUpdateCustomField } from '../../../hooks/queries/useCustomFields';
import { FIELD_TYPE_LABEL, type IssueFieldDef } from '../../../types/customField';

/** 편집할 필드가 있으면 열린다. 저장에 성공하면 onClose 로 닫는다. */
export function CustomFieldEditDialog({
  projectKey,
  field,
  onClose,
}: {
  projectKey: string;
  field: IssueFieldDef | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={field != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* 필드가 바뀔 때마다 입력을 새로 채우려고 key 로 다시 그린다. */}
      {field && <EditForm key={field.id} projectKey={projectKey} field={field} onClose={onClose} />}
    </Dialog>
  );
}

function EditForm({ projectKey, field, onClose }: { projectKey: string; field: IssueFieldDef; onClose: () => void }) {
  const update = useUpdateCustomField(projectKey);
  const [name, setName] = useState(field.name);
  const [optionsText, setOptionsText] = useState(formatFieldOptions(field.options));
  const [error, setError] = useState<string | null>(null);
  const hasOptions = field.type === 'SELECT' || field.type === 'MULTI_SELECT';

  async function onSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('이름을 입력해 주세요');
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({
        id: field.id,
        body: { name: trimmed, type: field.type, options: hasOptions ? parseFieldOptions(optionsText) : null },
      });
      onClose();
    } catch (e) {
      setError(extractApiError(e, '필드를 고치지 못했습니다'));
    }
  }

  return (
    <DialogContent data-testid="custom-field-edit-dialog">
      <DialogHeader>
        <DialogTitle>프로젝트 필드 편집</DialogTitle>
        <DialogDescription>
          {FIELD_TYPE_LABEL[field.type]} 필드 — 유형은 바꿀 수 없어요.{hasOptions && ' 이슈가 쓰는 중인 옵션은 뺄 수 없어요.'}
        </DialogDescription>
      </DialogHeader>
      <form
        id="custom-field-edit-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave();
        }}
      >
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="cf-edit-name">
            이름
          </label>
          <Input id="cf-edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </div>
        {hasOptions && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="cf-edit-options">
              옵션 (콤마 구분)
            </label>
            <Input id="cf-edit-options" value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder="a, b, c" />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          취소
        </Button>
        <Button type="submit" form="custom-field-edit-form" disabled={update.isPending}>
          저장
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
