// 프로젝트 설정 — 커스텀 필드 정의 관리 (Phase 4c).
// OWNER 만 추가/삭제 UI 노출. type 은 immutable 이라 수정 시에도 name/options 만 PATCH.

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import {
  useCreateCustomField,
  useCustomFields,
  useDeleteCustomField,
} from '../../../hooks/queries/useCustomFields';
import { FIELD_TYPES, type FieldType } from '../../../types/customField';

export function CustomFieldManagement({
  projectKey,
  isOwner,
}: {
  projectKey: string;
  isOwner: boolean;
}) {
  const fields = useCustomFields(projectKey);
  const create = useCreateCustomField(projectKey);
  const del = useDeleteCustomField(projectKey);

  const [name, setName] = useState('');
  const [type, setType] = useState<FieldType>('TEXT');
  const [optionsText, setOptionsText] = useState('');
  // 삭제 확인 다이얼로그 — window.confirm 대체 (#148).
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const needsOptions = type === 'SELECT' || type === 'MULTI_SELECT';

  // 콤마 구분 옵션을 trim + 빈 제거. 비-SELECT 타입은 null.
  async function onCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const opts = needsOptions
      ? optionsText
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : null;
    try {
      await create.mutateAsync({ name: trimmed, type, options: opts });
      setName('');
      setType('TEXT');
      setOptionsText('');
    } catch {
      /* toast 는 hook 이 처리 */
    }
  }

  return (
    <section className="space-y-3" aria-label="프로젝트 필드">
      <h2 className="text-lg font-semibold">프로젝트 필드</h2>
      {isOwner && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate();
          }}
          className="flex flex-wrap gap-2 items-end"
          data-testid="custom-field-create-form"
        >
          <div className="flex-1 min-w-[160px] space-y-1">
            <label className="text-sm font-medium" htmlFor="cf-name">
              이름
            </label>
            <Input
              id="cf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="cf-type">
              타입
            </label>
            <select
              id="cf-type"
              value={type}
              onChange={(e) => setType(e.target.value as FieldType)}
              className="border rounded p-2 bg-background"
              data-testid="cf-type-select"
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {needsOptions && (
            <div className="flex-1 min-w-[160px] space-y-1">
              <label className="text-sm font-medium" htmlFor="cf-options">
                옵션 (콤마 구분)
              </label>
              <Input
                id="cf-options"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder="a, b, c"
              />
            </div>
          )}
          <Button type="submit" disabled={create.isPending}>
            추가
          </Button>
        </form>
      )}

      {fields.isLoading ? (
        <p className="text-muted-foreground">로딩 중…</p>
      ) : (
        <ul className="space-y-1">
          {(fields.data ?? []).map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2 border-b py-2"
              data-testid={`custom-field-row-${f.id}`}
            >
              <span className="font-medium">{f.name}</span>
              <span className="text-xs text-muted-foreground">{f.type}</span>
              {f.options && (
                <span className="text-xs text-muted-foreground">[{f.options.join(', ')}]</span>
              )}
              {isOwner && (
                <div className="ml-auto flex gap-2">
                  {/* 삭제 — window.confirm 대신 shadcn AlertDialog (#148). cascade 경고 포함. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingDeleteId(f.id)}
                    data-testid={`custom-field-delete-${f.id}`}
                  >
                    삭제
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* 커스텀 필드 삭제 확인 — 이슈 값 cascade 경고 포함 (#148) */}
      <AlertDialog
        open={pendingDeleteId != null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
      >
        <AlertDialogContent data-testid="custom-field-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>프로젝트 필드 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              이 필드는 이슈 값들과 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다. 정말 진행하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (pendingDeleteId != null) del.mutate(pendingDeleteId); }}
              data-testid="custom-field-delete-confirm"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
