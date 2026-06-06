// 반복 일정 수정/삭제 시 적용 범위(scope)를 고르는 다이얼로그. (이슈 #111)
// 가상 회차를 편집/삭제할 때 EventDialog/삭제 트리거가 이 다이얼로그로 분기한다.
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { EditScope } from '@/types/calendar'

interface RecurrenceScopeDialogProps {
  open: boolean
  mode: 'edit' | 'delete'
  onPick: (scope: EditScope) => void
  onCancel: () => void
}

/** 반복 일정에 변경을 적용할 범위(이 회차/이후/전체)를 선택하는 확인 다이얼로그. */
export function RecurrenceScopeDialog({ open, mode, onPick, onCancel }: RecurrenceScopeDialogProps) {
  const title = mode === 'edit' ? '반복 일정 수정' : '반복 일정 삭제'
  const desc =
    mode === 'edit'
      ? '이 반복 일정을 어떻게 수정할까요?'
      : '이 반복 일정을 어떻게 삭제할까요?'

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent data-testid="calendar-recurrence-scope-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{desc}</AlertDialogDescription>
        </AlertDialogHeader>
        {/* 세 가지 범위 — THIS / THIS_AND_FOLLOWING / ALL */}
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            data-testid="calendar-recurrence-scope-this"
            onClick={() => onPick('THIS')}
          >
            이 일정만
          </Button>
          <Button
            variant="outline"
            data-testid="calendar-recurrence-scope-following"
            onClick={() => onPick('THIS_AND_FOLLOWING')}
          >
            이후 모든 일정
          </Button>
          <Button
            variant="outline"
            data-testid="calendar-recurrence-scope-all"
            onClick={() => onPick('ALL')}
          >
            전체 일정
          </Button>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>취소</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
