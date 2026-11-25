import { useState } from 'react'

import { BusySwitch } from '@/components/BusySwitch'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/** 헤더 알약(게시 버전·초안 있음)과 같은 모양 — 읽기 전용 배지용. */
const BADGE = 'rounded border px-1.5 text-xs text-muted-foreground'

/**
 * 워크플로우 머리줄의 사용 스위치(WP-2119).
 *
 * - 관리자: 스위치 + 옆 글자(사용 중 / 사용 안 함). 게시 버전이 없으면 켤 수 없어 꺼 두고 이유 글자를 보인다.
 * - 그 밖: 스위치 없이 읽기 전용 배지.
 * - 끌 때 진행 중 실행이 있으면 확인 대화상자를 거친다(진행 중 실행은 계속되고 새로 시작만 막힌다는 안내).
 *   실행 수를 아직 모르면(null) 대화상자를 열어 불러오는 중이라고 알리고 확인을 잠근다.
 * 켜기·끄기 요청과 서버 오류 표시는 부모가 한다 — 여기는 눌림을 `onChange` 로 올릴 뿐 값은 늘 `enabled` 로 제어한다.
 */
export function WorkflowEnableSwitch({ enabled, canManage, hasPublishedVersion, activeRuns, runsLoadError, onRetryRuns, busy, onChange }: {
  enabled: boolean
  canManage: boolean
  hasPublishedVersion: boolean
  /** 진행 중 실행 수 — 아직 못 읽었으면 null */
  activeRuns: number | null
  /** 실행 수 조회가 실패했는지 — 실패해도 끄기는 막지 않는다(수를 몰라도 끌 수 있다). */
  runsLoadError: boolean
  onRetryRuns: () => void
  busy: boolean
  onChange: (next: boolean) => void
}) {
  const [confirmingOff, setConfirmingOff] = useState(false)
  const label = enabled ? '사용 중' : '사용 안 함'

  if (!canManage) return <span className={BADGE}>{label}</span>

  function handleChange(next: boolean) {
    if (next) { onChange(true); return }
    // 진행 중 실행이 없다고 확인된 때만 바로 끈다 — 모르거나 있으면 먼저 묻는다.
    if (activeRuns === 0) onChange(false)
    else setConfirmingOff(true)
  }

  return (
    <>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BusySwitch
          aria-label="워크플로우 사용"
          checked={enabled}
          // 버전이 사라진 채 켜진 워크플로우도 끌 수는 있어야 한다(서버는 끄기를 늘 받는다) — 막는 것은 켜기뿐.
          disabled={!hasPublishedVersion && !enabled}
          busy={busy}
          onCheckedChange={handleChange}
        />
        {label}
        {!hasPublishedVersion && <span>게시하면 켤 수 있어요</span>}
      </label>
      <Dialog open={confirmingOff} onOpenChange={setConfirmingOff}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>워크플로우 사용 끄기</DialogTitle>
            <DialogDescription>
              {activeRuns === null
                ? (runsLoadError ? '진행 중 실행 수를 불러오지 못했습니다.' : '진행 중 실행 수를 불러오는 중…')
                : `진행 중 실행 ${activeRuns} 건은 계속됩니다. 새로 시작만 막습니다`}
            </DialogDescription>
          </DialogHeader>
          {activeRuns === null && runsLoadError && (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
              <Button variant="outline" size="sm" onClick={onRetryRuns}>실행 수 다시 불러오기</Button>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingOff(false)}>취소</Button>
            <Button disabled={busy || (activeRuns === null && !runsLoadError)} onClick={() => { setConfirmingOff(false); onChange(false) }}>끄기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
