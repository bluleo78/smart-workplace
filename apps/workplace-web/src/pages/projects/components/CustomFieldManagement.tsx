// 프로젝트 설정 — 커스텀 필드 정의 관리 (Phase 4c).
// OWNER 만 추가/삭제 UI 노출. type 은 immutable 이라 수정 시에도 name/options 만 PATCH.

import { useState } from 'react';

import { settingsFieldClass, SettingsSection } from '@/components/layout/SettingsSection';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import {
  useCreateCustomField,
  useCustomFields,
  useDeleteCustomField,
} from '../../../hooks/queries/useCustomFields';
import { FIELD_TYPES, type FieldType } from '../../../types/customField';

// 영문 enum → 한국어 레이블 매핑 (UI 표시용).
const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  TEXT: '텍스트',
  NUMBER: '숫자',
  DATE: '날짜',
  SELECT: '선택',
  MULTI_SELECT: '복수 선택',
};

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
    <SettingsSection title="프로젝트 필드" description="이슈에 붙일 이 프로젝트만의 입력 항목이에요.">
      {isOwner && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate();
          }}
          className="flex flex-wrap gap-2 items-end"
          data-testid="custom-field-create-form"
        >
          <div className={cn('flex min-w-[160px] flex-1 flex-col gap-1', settingsFieldClass)}>
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
          {/* 열을 flex-col 로 — SelectTrigger(inline-flex)가 줄 상자 기준선에 앉아 생기는 아래 여백(≈4px) 때문에 '타입' 라벨이 '이름'보다 떠 있었다(WP-397). */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="cf-type">
              타입
            </label>
            {/* shadcn Select — native select 대신 디자인 시스템 통일 (#317) */}
            <Select
              value={type}
              onValueChange={(v) => setType(v as FieldType)}
            >
              <SelectTrigger
                id="cf-type"
                className="w-36"
                data-testid="cf-type-select"
                aria-label="타입"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t} data-testid={`cf-type-option-${t}`}>
                    {FIELD_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {needsOptions && (
            <div className="flex min-w-[160px] flex-1 flex-col gap-1">
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
              {/* 한국어 레이블로 표시 (#317) */}
              <span className="text-xs text-muted-foreground">{FIELD_TYPE_LABEL[f.type]}</span>
              {/* 옵션 목록 — raw 배열 텍스트 대신 Badge 칩으로 표시 (#784) */}
              {f.options && f.options.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {f.options.map((opt) => (
                    <Badge key={opt} variant="outline" className="text-xs">
                      {opt}
                    </Badge>
                  ))}
                </div>
              )}
              {isOwner && (
                <div className="ml-auto flex gap-2">
                  {/* 삭제 — window.confirm 대신 shadcn AlertDialog (#148). cascade 경고 포함. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingDeleteId(f.id)}
                    data-testid={`custom-field-delete-${f.id}`}
                    aria-label={`${f.name} 삭제`}
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
    </SettingsSection>
  );
}
