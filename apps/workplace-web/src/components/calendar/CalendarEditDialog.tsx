// 캘린더 추가/수정 다이얼로그 — 이름 입력 + 팔레트 스와치 색 선택.
import { useEffect, useRef, useState } from 'react'

import { PaletteSwatches } from '@/components/calendar/PaletteSwatches'
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter'
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
  /** 추가·저장 — 끝나면 resolve, 실패하면 reject(창이 다시 제출할 수 있게 된다). */
  onSubmit: (body: CalendarRequest) => Promise<unknown>
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
  // 제출한 뒤 같은 제출을 다시 보내지 않게 막는다 — isPending 은 다시 그린 뒤에야 켜져 같은 틱 Enter 두 번을 못 막고,
  // 성공 직후 닫히는 애니메이션 동안에도 입력칸에 포커스가 남아 Enter 가 들어온다. 실패했을 때와 창을 다시 열 때만 푼다.
  const submittedRef = useRef(false)

  // 열 때마다 기존 값(편집)·빈 값(추가)으로 초기화하고 제출 막음을 푼다.
  useEffect(() => {
    if (open) {
      submittedRef.current = false
      setName(calendar?.name ?? '')
      setColor(calendar?.color ?? 'blue')
    }
  }, [open, calendar])

  // 이름 칸 Enter 로 추가·저장(WP-1623) — 한글 조합 Enter·macOS Chrome 확정 직후 꼬리 Enter 는 제출로 보지 않는다(WP-331 공용 훅).
  const enterKey = useSingleLineEnter()
  // 「추가/저장」 단추 활성과 Enter 제출이 같은 조건을 쓰도록 한 곳에서 정한다.
  const canSubmit = name.trim() !== '' && !isPending

  const handleSubmit = async () => {
    if (!canSubmit || submittedRef.current) return
    submittedRef.current = true
    try {
      await onSubmit({ name: name.trim(), color })
    } catch {
      // 실패 안내는 제출한 쪽(훅의 토스트)이 한다 — 여기서는 다시 제출할 수 있게만 푼다.
      submittedRef.current = false
    }
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
              onCompositionEnd={enterKey.onCompositionEnd}
              onKeyDown={(e) => enterKey.handleEnter(e, () => void handleSubmit())}
              maxLength={100} // 서버 상한(CalendarRequest.name) — 넘긴 채 저장하면 400 이었다(WP-687)
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
            <PaletteSwatches
              value={color}
              onChange={(k) => {
                if (k) setColor(k)
              }}
              testIdPrefix="calendar-color-"
            />
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
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {isEditing ? '저장' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
