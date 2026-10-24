// 범주 끝에 상태를 더하는 인라인 입력 줄(WP-809) — 이름 + 색 견본, Enter 저장 · Esc 취소.
// 창을 띄우지 않고 그 범주 목록 바로 아래에서 만든다(어느 범주에 들어가는지 위치로 보인다). 새 상태는 범주 맨 끝(afterStatusId 없음).
// 이름 오류(빈 값·30자 초과·범주 코드·중복)는 요청 없이 입력 아래에, 서버 거절(상한 409·동시 중복)도 같은 자리에 보인다.
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCreateProjectStatus } from '@/hooks/queries/useProjectStatuses'
import { CATEGORY_DEFAULT_COLOR } from '@/lib/projectStatuses'
import type { IssueStatus } from '@/types/issue'
import type { ColorToken } from '@/types/label'
import type { ProjectStatus } from '@/types/projectStatus'

import { ColorTokenPicker } from '../ProjectMetaEditDialog'
import { useStatusNameForm } from './useStatusNameForm'

export function StatusAddForm({
  projectKey,
  category,
  statuses,
  onDone,
}: {
  projectKey: string
  category: IssueStatus
  statuses: readonly ProjectStatus[]
  /** 저장 성공·취소 — 입력 줄을 닫는다. */
  onDone: () => void
}) {
  const create = useCreateProjectStatus(projectKey)
  // 기본 색 = 범주 기본 색(서버가 색 없이 만들 때와 같다).
  const [color, setColor] = useState<ColorToken>(CATEGORY_DEFAULT_COLOR[category])
  // 검증·Enter(한글 조합 가드)·Esc·서버 오류 문구는 보드 이름 입력기와 같은 흐름(WP-937).
  const form = useStatusNameForm({
    statuses,
    failMessage: '상태를 만들지 못했어요',
    // 목록 재조회가 끝난 뒤 닫혀 새 행이 입력 줄 자리에 바로 이어 보인다.
    onSubmit: async (name) => {
      await create.mutateAsync({ name, category, color })
      onDone()
    },
    onCancel: onDone,
  })
  const { error } = form
  const errorId = useId()

  return (
    <form
      data-testid={`status-add-form-${category}`}
      className="mt-1 space-y-2 rounded-md border border-dashed p-2"
      onSubmit={(e) => {
        e.preventDefault()
        void form.submit()
      }}
    >
      <Input
        {...form.inputProps}
        autoFocus
        aria-label="새 상태 이름"
        placeholder="새 상태 이름"
        // 저장 중엔 disabled 대신 readOnly — disabled 는 포커스를 잃어 실패 뒤 바로 고칠 수 없다.
        readOnly={form.saving}
        aria-busy={form.saving}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} role="alert" data-testid="status-add-error" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ColorTokenPicker value={color} onChange={setColor} ariaLabel="상태 색" testIdPrefix="status-add-color-" />
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            취소
          </Button>
          <Button type="submit" size="sm" disabled={!form.value.trim() || form.saving}>
            추가
          </Button>
        </div>
      </div>
    </form>
  )
}
