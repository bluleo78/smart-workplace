// 상태 이름 입력기(WP-808) — 보드 범주 띠 ＋·헤더 ⋯ 「이 뒤에 상태 추가」(팝오버)와 헤더 인라인 이름 변경이 같이 쓴다.
// 오류는 토스트가 아니라 입력 바로 아래에 보인다 — 클라이언트 검증(빈 이름·30자·중복) 뒤 서버 오류(409 동시 중복 등)도 같은 자리.
import { type FormEvent, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { extractApiError } from '@/lib/api-error';
import { validateStatusName } from '@/lib/projectStatuses';
import { cn } from '@/lib/utils';
import type { ProjectStatus } from '@/types/projectStatus';

export function StatusNameEditor({
  initial = '',
  statuses,
  excludeId,
  onSubmit,
  onCancel,
  submitLabel,
  className,
}: {
  initial?: string;
  // 중복 검사 대상 — 이 프로젝트의 상태 목록.
  statuses: ProjectStatus[];
  // 이름을 바꾸는 상태 자신(중복 비교에서 뺀다).
  excludeId?: number;
  // 앞뒤 공백을 뺀 이름으로 저장한다. 실패(reject)하면 서버 문구를 입력 아래에 보이고 입력을 유지한다.
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
  // 주면 저장 버튼을 둔다(팝오버). 헤더 인라인 편집은 Enter·Esc 만 쓴다.
  submitLabel?: string;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 저장 — 바뀌지 않은 이름(이름 변경)은 요청 없이 닫는다.
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const name = value.trim();
    if (initial && name === initial.trim()) return onCancel();
    const invalid = validateStatusName(value, statuses, excludeId);
    if (invalid) return setError(invalid);
    setSaving(true);
    try {
      await onSubmit(name);
    } catch (err) {
      setError(extractApiError(err, '상태를 저장하지 못했습니다'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div className="flex min-w-0 items-center gap-2">
        {/* maxLength 를 두지 않는다 — 30자에서 입력이 조용히 잘리면 왜 막혔는지 모른다. 길이 오류는 아래 문구로 알린다. */}
        <Input
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            // 보드 키보드 DnD(Space 시작)·메뉴 타입어헤드로 새지 않게 입력 안의 키는 여기서 끝낸다.
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          aria-label="상태 이름"
          aria-invalid={error != null}
          aria-describedby={error ? 'status-name-error' : undefined}
          disabled={saving}
          className="h-8 min-w-0 text-sm font-normal"
          data-testid="status-name-input"
        />
        {submitLabel && (
          <Button type="submit" size="sm" className="h-8 shrink-0" disabled={saving}>
            {submitLabel}
          </Button>
        )}
      </div>
      {error && (
        <p id="status-name-error" role="alert" className="break-keep text-xs font-normal text-destructive" data-testid="status-name-error">
          {error}
        </p>
      )}
    </form>
  );
}
