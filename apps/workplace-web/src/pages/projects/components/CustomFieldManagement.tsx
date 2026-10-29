// 프로젝트 설정 — 커스텀 필드 정의 관리 (Phase 4c).
// OWNER 만 추가/삭제 UI 노출. type 은 immutable 이라 수정 시에도 name/options 만 PATCH.

import { useState } from 'react';

import { settingsFieldClass, SettingsSection } from '@/components/layout/SettingsSection';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select';
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
import { parseFieldOptions } from '@/lib/customFieldOptions';
import { cn } from '@/lib/utils';

import {
  useCreateCustomField,
  useCustomFields,
  useDeleteCustomField,
} from '../../../hooks/queries/useCustomFields';
import { FIELD_TYPE_LABEL, FIELD_TYPES, type FieldType, type IssueFieldDef } from '../../../types/customField';
import { CustomFieldEditDialog } from './CustomFieldEditDialog';

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
  // 이름·옵션 편집 대화상자 대상(WP-611).
  const [editing, setEditing] = useState<IssueFieldDef | null>(null);

  const needsOptions = type === 'SELECT' || type === 'MULTI_SELECT';

  // 콤마 구분 옵션을 trim + 빈 제거. 비-SELECT 타입은 null.
  async function onCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const opts = needsOptions ? parseFieldOptions(optionsText) : null;
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
            // 줄 배치(WP-1124) — 옵션 칩이 많거나 길어도 이름·타입이 한 줄로 읽히게 한다. 예전엔 옵션 묶음이 칩 전부를
            // 한 줄에 놓을 폭을 가져가 이름이 한두 글자씩, 타입(「선택」)이 한 글자씩 세로로 꺾였다.
            // - 이름: 남는 폭에서 한 줄 말줄임(전체 이름은 title). 데스크톱은 줄 폭의 40% 까지만 써 옵션 자리를 남긴다.
            // - 타입·버튼: 줄지 않는다(shrink-0·nowrap).
            // - 옵션: 데스크톱은 남은 폭(basis-0 flex-1) 안에서 줄바꿈, 모바일은 이름 아래 줄 전체(order-last basis-full).
            <li
              key={f.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 row-divider py-2"
              data-testid={`custom-field-row-${f.id}`}
            >
              <span className="min-w-0 flex-1 truncate font-medium sm:max-w-[40%] sm:flex-none" title={f.name}>
                {f.name}
              </span>
              {/* 한국어 레이블로 표시 (#317) */}
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{FIELD_TYPE_LABEL[f.type]}</span>
              {/* 옵션 목록 — raw 배열 텍스트 대신 Badge 칩으로 표시 (#784) */}
              {f.options && f.options.length > 0 && (
                <div
                  className="order-last flex min-w-0 basis-full flex-wrap gap-1 sm:order-none sm:flex-1 sm:basis-0"
                  data-testid={`custom-field-options-${f.id}`}
                >
                  {f.options.map((opt) => (
                    // 띄어쓰기 없는 긴 옵션(최대 40자)도 칩 안에서 줄바꿈 — Badge 기본 nowrap 이면 칩 하나가 줄을 넘친다.
                    <Badge key={opt} variant="outline" className="max-w-full whitespace-normal text-xs wrap-anywhere">
                      {opt}
                    </Badge>
                  ))}
                </div>
              )}
              {isOwner && (
                <div className="ml-auto flex shrink-0 gap-2">
                  {/* 편집 — 이름·옵션 고치기(WP-611). 예전엔 없어서 옵션 하나를 더하려면 필드를 지워야 했다. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(f)}
                    data-testid={`custom-field-edit-${f.id}`}
                    aria-label={`${f.name} 편집`}
                  >
                    편집
                  </Button>
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

      <CustomFieldEditDialog projectKey={projectKey} field={editing} onClose={() => setEditing(null)} />

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
