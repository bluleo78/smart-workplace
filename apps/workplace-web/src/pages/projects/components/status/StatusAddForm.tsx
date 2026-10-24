// 범주 끝에 상태를 더하는 인라인 입력 줄(WP-809) — 이름 + 색 견본, Enter 저장 · Esc 취소.
// 창을 띄우지 않고 그 범주 목록 바로 아래에서 만든다(어느 범주에 들어가는지 위치로 보인다). 새 상태는 범주 맨 끝(afterStatusId 없음).
// 이름 오류(빈 값·30자 초과·범주 코드·중복)는 요청 없이 입력 아래에, 서버 거절(상한 409·동시 중복)도 같은 자리에 보인다.
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCreateProjectStatus } from '@/hooks/queries/useProjectStatuses'
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter'
import { extractApiError } from '@/lib/api-error'
import { CATEGORY_DEFAULT_COLOR, validateStatusName } from '@/lib/projectStatuses'
import type { IssueStatus } from '@/types/issue'
import type { ColorToken } from '@/types/label'
import type { ProjectStatus } from '@/types/projectStatus'

import { ColorTokenPicker } from '../ProjectMetaEditDialog'

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
  const [name, setName] = useState('')
  // 기본 색 = 범주 기본 색(서버가 색 없이 만들 때와 같다).
  const [color, setColor] = useState<ColorToken>(CATEGORY_DEFAULT_COLOR[category])
  const [error, setError] = useState<string | null>(null)
  // 한글 조합 Enter·확정 직후 꼬리 Enter 는 저장으로 보지 않는다(WP-331).
  const enterKey = useSingleLineEnter()
  const errorId = useId()

  async function save() {
    if (create.isPending) return
    const invalid = validateStatusName(name, statuses)
    if (invalid) {
      setError(invalid)
      return
    }
    try {
      // 목록 재조회가 끝난 뒤 닫혀 새 행이 입력 줄 자리에 바로 이어 보인다.
      await create.mutateAsync({ name: name.trim(), category, color })
      onDone()
    } catch (e) {
      setError(extractApiError(e, '상태를 만들지 못했어요'))
    }
  }

  return (
    <form
      data-testid={`status-add-form-${category}`}
      className="mt-1 space-y-2 rounded-md border border-dashed p-2"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <Input
        autoFocus
        value={name}
        aria-label="새 상태 이름"
        placeholder="새 상태 이름"
        aria-invalid={!!error || undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => {
          setName(e.target.value)
          setError(null)
        }}
        onCompositionEnd={enterKey.onCompositionEnd}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // 섹션 밖(다이얼로그 등)으로 Esc 가 번지지 않게 여기서 끝낸다.
            e.preventDefault()
            e.stopPropagation()
            onDone()
            return
          }
          enterKey.handleEnter(e, () => void save())
        }}
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
          <Button type="submit" size="sm" disabled={!name.trim() || create.isPending}>
            추가
          </Button>
        </div>
      </div>
    </form>
  )
}
