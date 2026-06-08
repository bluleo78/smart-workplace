// 뷰 저장/수정 다이얼로그 — 생성 시 현재 URL 쿼리스트링을, 수정 시 기존 뷰의 쿼리를 이름+가시성과 함께 저장.
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import { useCreateSavedView, useUpdateSavedView } from '../../../hooks/queries/useSavedViews'
import type { SavedViewResponse, Visibility } from '../../../types/savedView'

export function SaveViewDialog({
  projectKey,
  query,
  editing,
  open,
  onOpenChange,
}: {
  projectKey: string
  /** 생성 시 저장할 현재 필터 쿼리스트링(? 제외). 수정 시에는 editing.query 가 사용된다. */
  query: string
  /** 지정되면 수정 모드 — 이름/가시성만 변경하고 쿼리는 기존값 유지. */
  editing?: SavedViewResponse
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const create = useCreateSavedView(projectKey)
  const update = useUpdateSavedView(projectKey)
  const isEdit = !!editing
  // 수정 모드면 기존값으로 초기화 — 호출처에서 key 로 리마운트해 editing 별 초기값을 보장한다.
  const [name, setName] = useState(editing?.name ?? '')
  const [nameError, setNameError] = useState('')
  const [visibility, setVisibility] = useState<Visibility>(editing?.visibility ?? 'PRIVATE')
  const pending = isEdit ? update.isPending : create.isPending
  // 생성 모드에서 필터 미적용(빈 query) 이면 백엔드 NotBlank 위반 → 클라이언트 가드.
  const noFilter = !isEdit && !query.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? '뷰 수정' : '뷰 저장'}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            // 저장 — 이름 trim 후 빈 값이면 에러 메시지 표시. 성공 시 입력 초기화 + 닫기.
            e.preventDefault()
            const trimmed = name.trim()
            if (!trimmed) {
              setNameError('뷰 이름을 입력하세요')
              return
            }
            if (noFilter) return
            try {
              if (isEdit) {
                // 수정: 쿼리는 기존값 유지, 이름/가시성만 변경.
                await update.mutateAsync({
                  id: editing.id,
                  body: { name: trimmed, query: editing.query, visibility },
                })
              } else {
                await create.mutateAsync({ name: trimmed, query, visibility })
              }
              setName('')
              setNameError('')
              setVisibility('PRIVATE')
              onOpenChange(false)
            } catch {
              // 토스트는 훅 onError 에서 처리
            }
          }}
          className="space-y-4"
        >
          {/* 필터 미적용 안내 — 빈 query 로 저장 시도 방지 */}
          {noFilter && (
            <p data-testid="save-view-no-filter-msg" className="text-sm text-destructive">
              저장하려면 먼저 필터를 하나 이상 적용하세요.
            </p>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="save-view-name">
              뷰 이름
            </label>
            <Input
              id="save-view-name"
              data-testid="save-view-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (nameError) setNameError('')
              }}
              placeholder="예: 내 HIGH 이슈"
            />
            {/* 빈 이름 제출 시 표시되는 인라인 에러 메시지 */}
            {nameError && (
              <p data-testid="save-view-name-error" className="text-sm text-destructive">
                {nameError}
              </p>
            )}
          </div>
          <fieldset className="flex items-center gap-4 border-none p-0 text-sm">
            <legend className="mb-1 text-sm font-medium">가시성</legend>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'PRIVATE'}
                onChange={() => setVisibility('PRIVATE')}
              />
              개인
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="visibility"
                data-testid="save-view-shared"
                checked={visibility === 'SHARED'}
                onChange={() => setVisibility('SHARED')}
              />
              공유
            </label>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" data-testid="save-view-submit" disabled={pending || noFilter}>
              {pending ? (isEdit ? '수정 중…' : '저장 중…') : (isEdit ? '수정' : '저장')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
