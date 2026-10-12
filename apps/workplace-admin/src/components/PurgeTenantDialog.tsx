import { useRef, useState } from 'react'

import { eulReul } from '../lib/utils'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'

/**
 * 영구 삭제 확인 다이얼로그 — 테넌트 이름을 정확히(앞뒤 공백 제외, 대소문자 구분) 입력해야 실행 버튼이 켜진다.
 * 되돌릴 수 없는 작업이라 삭제 범위와 "사용자 계정은 유지"를 함께 안내한다.
 * 서버도 같은 규칙(입력·저장명 모두 trim 후 대소문자 구분 비교 — 저장명에 앞뒤 공백이 있을 수 있다)으로 다시 확인하므로 여기 판정은 오조작 방지용이다.
 */
export function PurgeTenantDialog({
  open,
  onOpenChange,
  tenantName,
  pending,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantName: string
  pending: boolean
  onConfirm: (confirmName: string) => void
  // 닫힐 때 포커스 복원(트리거 버튼으로) — 부모가 트리거를 알고 있다.
  onCloseAutoFocus?: (e: Event) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  // 닫힐 때 입력을 비워 다음에 열 때 이전 입력이 남지 않게 한다.
  // effect 대신 렌더 중 prop 변화 감지(React 권장 패턴)로 처리해 불필요한 연쇄 렌더를 피한다.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) setValue('')
  }
  const matches = value.trim() === tenantName.trim()
  // 폼 제출(입력란 Enter·확인 버튼) — 이름이 일치하고 요청 중이 아닐 때만 실행한다(버튼 disabled 와 같은 규칙).
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (matches && !pending) onConfirm(value.trim())
  }
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        data-testid="purge-dialog"
        // 이 다이얼로그의 유일한 다음 행동은 이름 입력이라 초기 포커스를 입력란으로 보낸다(기본은 '취소').
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{tenantName}{eulReul(tenantName)} 영구 삭제할까요?</AlertDialogTitle>
          <AlertDialogDescription>
            이슈·메일·드라이브·위키 등 이 테넌트의 모든 데이터와 파일, 이 테넌트 전용 AI 에이전트가 삭제됩니다. 사용자
            계정은 유지되고 이 테넌트 소속만 해제됩니다. <strong>되돌릴 수 없습니다.</strong>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm" htmlFor="purge-confirm-input">
              확인을 위해 <strong>{tenantName}</strong>{eulReul(tenantName)} 입력하세요
            </label>
            <Input
              ref={inputRef}
              id="purge-confirm-input"
              data-testid="purge-confirm-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
            <Button
              variant="destructive"
              data-testid="purge-confirm"
              disabled={!matches || pending}
              type="submit"
            >
              영구 삭제
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
