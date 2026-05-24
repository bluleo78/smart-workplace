// 프로젝트 설정 — 커스텀 필드 정의 관리 (Phase 4c).
// OWNER 만 추가/삭제 UI 노출. type 은 immutable 이라 수정 시에도 name/options 만 PATCH.

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      // 삭제 시 이슈에 부착된 값들도 cascade 로 사라진다 — confirm 으로 경고.
                      if (
                        confirm('이 필드는 이슈 값들과 함께 삭제됩니다. 진행하시겠습니까?')
                      ) {
                        del.mutate(f.id);
                      }
                    }}
                  >
                    삭제
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
