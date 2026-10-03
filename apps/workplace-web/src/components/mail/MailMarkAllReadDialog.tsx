// 메일 모두 읽음 확인(WP-187) — 범위·건수·원본 서버 반영을 알리고 확인을 받는다.
// 원본 서버까지 바뀌어 되돌리기 번거로운 작업이라 실행 취소 토스트 대신 확인을 둔다.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

interface Props {
  /** 열림 = 건수 조회 결과가 있을 때. asOf 는 실행 요청에 그대로 되돌려 보낸다. */
  pending: { count: number; asOf: string } | null
  /** 보기 표시 이름(예: "받은편지함 › 업무"). */
  scopeLabel: string
  /** 모바일이면 버튼 폭을 채우고 터치 높이(44px)를 확보한다. 세로 배치(확인이 위)는 Footer 기본 규칙. */
  mobile: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function MailMarkAllReadDialog({ pending, scopeLabel, mobile, onConfirm, onCancel }: Props) {
  return (
    <AlertDialog open={pending !== null} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent data-testid="mail-mark-all-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>모두 읽음으로 표시할까요?</AlertDialogTitle>
          <AlertDialogDescription>
            <b className="text-foreground">{scopeLabel}</b>의 안 읽은 메일 <b className="text-foreground">{pending?.count ?? 0}통</b>을
            읽음으로 표시합니다. 연결된 메일 서버에도 반영됩니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* Footer 는 sm 미만에서 이미 flex-col-reverse — DOM(취소→확인)이 화면에선 확인이 위로 온다. */}
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="mail-mark-all-cancel" className={cn(mobile && 'h-11 w-full')}>
            취소
          </AlertDialogCancel>
          {/* 확인 문구는 성공 토스트("N통 읽음 처리")와 겹치지 않게 둔다(F23). */}
          <AlertDialogAction
            data-testid="mail-mark-all-confirm"
            onClick={onConfirm}
            className={cn(mobile && 'h-11 w-full')}
          >
            읽음으로 표시
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
