// 뷰 저장 다이얼로그 — 현재 URL 쿼리스트링을 이름+가시성과 함께 저장.
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

import { useCreateSavedView } from '../../../hooks/queries/useSavedViews'
import type { Visibility } from '../../../types/savedView'

export function SaveViewDialog({
  projectKey,
  query,
  open,
  onOpenChange,
}: {
  projectKey: string
  /** 저장할 현재 필터 쿼리스트링(? 제외). */
  query: string
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const create = useCreateSavedView(projectKey)
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('PRIVATE')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>뷰 저장</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            // 저장 — 이름 trim 후 빈 값이면 무시. 성공 시 입력 초기화 + 닫기.
            e.preventDefault()
            const trimmed = name.trim()
            if (!trimmed) return
            try {
              await create.mutateAsync({ name: trimmed, query, visibility })
              setName('')
              setVisibility('PRIVATE')
              onOpenChange(false)
            } catch {
              // 토스트는 훅 onError 에서 처리
            }
          }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="save-view-name">
              뷰 이름
            </label>
            <Input
              id="save-view-name"
              data-testid="save-view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 내 HIGH 이슈"
            />
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
            <Button type="submit" data-testid="save-view-submit" disabled={create.isPending}>
              저장
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
