import type { TenantStatus } from '../types/platform'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { PendingLabel } from './ui/pending-label'

/**
 * 테넌트 상세 맨 아래 "위험 구역" 카드(WP-341).
 * - 운영 중(ACTIVE/SUSPENDED): 삭제(복원 가능) 버튼 — 확인 다이얼로그는 상세 페이지가 띄운다.
 * - 삭제됨(DELETED): 영구 삭제 버튼 — 지난 시도가 실패했으면 "영구 삭제 다시 시도".
 * - 삭제 불가 테넌트(기본 테넌트, deletable=false): 이유 안내와 비활성 삭제 버튼 — 기능이 없는 것처럼 보이지 않게(N5).
 * 영구 삭제 진행 중(PURGING)에는 할 수 있는 일이 없어 아무것도 렌더하지 않는다.
 */
export function TenantDangerZone({
  status,
  deletable,
  hasPurgeError,
  purgePending,
  busy,
  onDelete,
  onPurge,
}: {
  status: TenantStatus
  // 서버가 알린 삭제 가능 여부 — false(기본 테넌트)면 비활성 버튼과 이유를 보여준다.
  deletable: boolean
  hasPurgeError: boolean
  // 영구 삭제 요청 중 — 버튼 라벨을 "영구 삭제 중…" + 스피너로 바꾼다(N6).
  purgePending: boolean
  // 상태 변경·영구 삭제 중 어느 하나라도 진행 중이면 true — 상충하는 동작을 동시에 못 누르게 버튼을 잠근다(F1).
  busy: boolean
  // 클릭한 버튼을 넘겨, 다이얼로그가 닫힐 때 포커스를 그 버튼으로 되돌릴 수 있게 한다(WP-341 S5).
  onDelete: (trigger: HTMLElement) => void
  onPurge: (trigger: HTMLElement) => void
}) {
  if (status === 'PURGING') return null
  const live = status !== 'DELETED'
  return (
    <Card className="gap-2 border-destructive/40" data-testid="danger-zone">
      {/* 제목–본문 간격 축소(N1): Card 기본 gap-6 을 줄이고 헤더 아래 패딩을 없앤다. */}
      <CardHeader className="pb-0">
        <CardTitle className="text-base text-destructive">위험 구역</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {live ? (
          <>
            <p className="text-sm text-muted-foreground">
              {deletable
                ? '테넌트를 삭제하면 구성원의 로그인이 즉시 차단됩니다. 영구 삭제 전까지 복원할 수 있습니다.'
                : '기본 테넌트는 신규 가입자가 들어가는 곳이라 삭제할 수 없습니다.'}
            </p>
            {/* outline 위에 destructive 글자색 — 복원 가능한 삭제라 채움 버튼보다 한 단계 약하게. */}
            {/* key 로 두 분기의 버튼을 서로 다른 DOM 노드로 만든다 — 같은 노드를 재사용하면 삭제 직후 포커스가 [영구 삭제]에 놓인다(S1). */}
            <Button
              key="delete"
              variant="outline"
              size="sm"
              className="shrink-0 self-start border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:self-auto"
              data-testid="delete-button"
              disabled={!deletable || busy}
              onClick={(e) => onDelete(e.currentTarget)}
            >
              삭제
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">모든 데이터와 파일을 영구 삭제합니다. 되돌릴 수 없습니다.</p>
            <Button
              key="purge"
              variant="destructive"
              size="sm"
              className="shrink-0 self-start sm:self-auto"
              data-testid="purge-button"
              disabled={busy}
              onClick={(e) => onPurge(e.currentTarget)}
            >
              <PendingLabel
                pending={purgePending}
                label={hasPurgeError ? '영구 삭제 다시 시도' : '영구 삭제'}
                pendingLabel="영구 삭제 중…"
              />
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
