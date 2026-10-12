import type { TenantStatus } from '../types/platform'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

/**
 * 테넌트 상세 맨 아래 "위험 구역" 카드(WP-341).
 * - 운영 중(ACTIVE/SUSPENDED): 삭제(복원 가능) 버튼 — 확인 다이얼로그는 상세 페이지가 띄운다.
 * - 삭제됨(DELETED): 영구 삭제 버튼 — 지난 시도가 실패했으면 "영구 삭제 다시 시도".
 * 영구 삭제 진행 중(PURGING)에는 할 수 있는 일이 없어 아무것도 렌더하지 않는다.
 */
export function TenantDangerZone({
  status,
  hasPurgeError,
  onDelete,
  onPurge,
}: {
  status: TenantStatus
  hasPurgeError: boolean
  // 클릭한 버튼을 넘겨, 다이얼로그가 닫힐 때 포커스를 그 버튼으로 되돌릴 수 있게 한다(WP-341 S5).
  onDelete: (trigger: HTMLElement) => void
  onPurge: (trigger: HTMLElement) => void
}) {
  if (status === 'PURGING') return null
  const live = status !== 'DELETED'
  return (
    <Card className="border-destructive/40" data-testid="danger-zone">
      <CardHeader>
        <CardTitle className="text-base text-destructive">위험 구역</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {live ? (
          <>
            <p className="text-sm text-muted-foreground">
              테넌트를 삭제하면 로그인이 즉시 차단됩니다. 영구 삭제 전까지 복원할 수 있습니다.
            </p>
            {/* outline 위에 destructive 글자색 — 복원 가능한 삭제라 채움 버튼보다 한 단계 약하게. */}
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 self-start border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:self-auto"
              data-testid="delete-button"
              onClick={(e) => onDelete(e.currentTarget)}
            >
              삭제
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">모든 데이터와 파일을 영구 삭제합니다. 되돌릴 수 없습니다.</p>
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0 self-start sm:self-auto"
              data-testid="purge-button"
              onClick={(e) => onPurge(e.currentTarget)}
            >
              {hasPurgeError ? '영구 삭제 다시 시도' : '영구 삭제'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
