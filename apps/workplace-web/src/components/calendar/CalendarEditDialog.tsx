// 캘린더 추가/수정 다이얼로그 — 이름 입력 + 팔레트 스와치 색 선택.
import { useEffect, useState } from 'react'

import { PALETTE_KEYS, resolvePalette } from '@/lib/calendarPalette'
import type { Calendar, CalendarRequest } from '@/types/calendar'

import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

interface CalendarEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = 추가 모드, 값 = 편집 모드 */
  calendar?: Calendar | null
  onSubmit: (body: CalendarRequest) => void
  onDelete?: () => void
  isPending?: boolean
}

/** 캘린더 컨테이너 추가/수정 다이얼로그. */
export function CalendarEditDialog({
  open,
  onOpenChange,
  calendar,
  onSubmit,
  onDelete,
  isPending,
}: CalendarEditDialogProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('blue')

  // 편집 모드 진입 시 기존 값으로 초기화.
  useEffect(() => {
    if (open) {
      setName(calendar?.name ?? '')
      setColor(calendar?.color ?? 'blue')
    }
  }, [open, calendar])

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSubmit({ name: trimmed, color })
  }

  const isEditing = calendar != null
  // 외부 동기화 컨테이너(accountEmail 보유) — Graph canEdit=true 라 isReadOnly=false 여도
  // 로컬 이름변경/삭제는 별도로 제한한다 (이슈 #608).
  const isExternal = isEditing && !!calendar.accountEmail

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="calendar-edit-dialog">
        <DialogHeader>
          <DialogTitle>{isEditing ? '캘린더 편집' : '새 캘린더'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 이름 */}
          <div className="space-y-1.5">
            <Label htmlFor="calendar-edit-name">이름</Label>
            <Input
              id="calendar-edit-name"
              data-testid="calendar-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="캘린더 이름"
              autoFocus={!isExternal}
            />
            {isExternal && (
              <p className="text-xs text-muted-foreground" data-testid="calendar-edit-external-warning">
                로컬 표시명만 변경되며 실제 계정 캘린더명과 동기화되지 않습니다.
              </p>
            )}
          </div>

          {/* 팔레트 색 선택 */}
          <div className="space-y-1.5">
            <Label>색상</Label>
            <div className="flex flex-wrap gap-2">
              {PALETTE_KEYS.map((k) => {
                const entry = resolvePalette(k)
                const selected = color === k
                return (
                  <button
                    key={k}
                    type="button"
                    data-testid={`calendar-color-${k}`}
                    aria-label={entry.label}
                    onClick={() => setColor(k)}
                    className={`size-7 rounded-full ${entry.dotClass} ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${selected ? 'ring-2 ring-ring ring-offset-2' : ''}`}
                  />
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {/* 편집 모드에서 기본 캘린더가 아니고 외부 동기화 컨테이너도 아닌 경우만 삭제 허용 (이슈 #608) */}
          {isEditing && !calendar.isDefault && !isExternal && onDelete && (
            <Button
              variant="destructive"
              onClick={onDelete}
              disabled={isPending}
              className="mr-auto"
            >
              삭제
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            data-testid="calendar-edit-submit"
            onClick={handleSubmit}
            disabled={isPending || !name.trim()}
          >
            {isEditing ? '저장' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
