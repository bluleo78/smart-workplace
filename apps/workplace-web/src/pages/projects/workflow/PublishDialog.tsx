import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/** 게시가 새 실행에 미치는 범위를 확인하고 진행한다. */
export function PublishDialog({
  open, onOpenChange, canPublish, publishing, running, runningLoadError, onRetryRunning, onPublish,
  firstPublish, enableOnPublish, onEnableOnPublishChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  canPublish: boolean
  publishing: boolean
  running: number | null
  runningLoadError: boolean
  onRetryRunning: () => void
  onPublish: () => void
  /** 게시 버전이 아직 없는 첫 게시인지 — 그때만 「게시하고 바로 사용」을 묻는다. 이후 게시는 켜짐 상태를 그대로 둔다. */
  firstPublish: boolean
  enableOnPublish: boolean
  onEnableOnPublishChange: (value: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>워크플로우 게시</DialogTitle>
          <DialogDescription>
            초안을 새 버전으로 게시합니다.
            {running !== null && <span className="mt-1 block">{`진행 중 실행 ${running}은 시작한 버전으로 계속`}</span>}
          </DialogDescription>
        </DialogHeader>
        {firstPublish && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={enableOnPublish} disabled={publishing} onCheckedChange={(value) => onEnableOnPublishChange(value === true)} />
            게시하고 바로 사용
          </label>
        )}
        {running === null && runningLoadError && (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
            실행 수를 불러오지 못했습니다.
            <Button variant="outline" size="sm" onClick={onRetryRunning}>실행 수 다시 불러오기</Button>
          </div>
        )}
        {running === null && !runningLoadError && (
          <p role="status" className="text-sm text-muted-foreground">실행 수를 불러오는 중…</p>
        )}
        <DialogFooter>
          <Button disabled={publishing} variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button disabled={!canPublish || running === null} onClick={onPublish}>{publishing ? '게시 중…' : '게시'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
