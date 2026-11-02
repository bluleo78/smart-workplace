// WP-1262: AI 패널의 「보안 점검」 카드 — HTML 파일의 AI 점검 결과(위험도·headline·근거)를 보여 준다.
import { useSecurityCheck } from '../../hooks/queries/useSecurityCheck'
import { formatDateTimeMinute } from '../../lib/formatters'
import { EVIDENCE_KIND_LABEL, OUTDATED_NOTE, RISK_CHIP_CLASS, RISK_LABEL } from '../../lib/securityCheck'
import { cn } from '../../lib/utils'
import { AiContent } from '../ai/AiContent'
import { Button } from '../ui/button'

/**
 * 점검 카드. 진행 중이면 안내, 실패면 실패 문구, 완료면 칩 + headline + 근거 목록 + 「AI 판단이라 틀릴 수 있어요」 꼬리.
 * 근거는 주의·높음이면 「위협 근거」, 낮음이면 흐린 「참고 정보」로 나눠 보인다 — 위협이 아닌 것을 경고처럼 읽지 않게(WP-1283).
 * 지난 판정 기준의 결과면 안내와 「다시 점검」을 함께 둔다.
 * 조회는 패널 가용성 판정(usePanelAvailability)·안내 줄과 같은 쿼리 캐시를 쓴다.
 */
export function SecurityCheckCard({ path }: { path: string }) {
  const { view, pollingExhausted, errored, request, requesting } = useSecurityCheck(path, true)
  const inProgress = (view?.status === 'PENDING' || view?.status === 'CHECKING') && !pollingExhausted
  const failed = errored || view?.status === 'FAILED' || ((view?.status === 'PENDING' || view?.status === 'CHECKING') && pollingExhausted)
  return (
    <AiContent label="보안 점검" data-testid="security-check-card">
      {inProgress ? (
        <p className="text-sm text-muted-foreground">AI 가 점검하는 중…</p>
      ) : failed || !view || view.status !== 'DONE' || !view.risk ? (
        <p className="text-sm text-muted-foreground">보안 점검을 하지 못했어요</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', RISK_CHIP_CLASS[view.risk])}>
              {RISK_LABEL[view.risk]}
            </span>
            {view.headline && <p className="text-sm">{view.headline}</p>}
          </div>
          {view.evidence.length > 0 && (
            <div className={cn('space-y-1', view.risk === 'LOW' && 'text-muted-foreground')}>
              <p className="text-xs font-medium">{view.risk === 'LOW' ? '참고 정보' : '위협 근거'}</p>
              {/* 근거의 주소는 공백 없이 길어 패널 폭을 넘기므로 아무 데서나 줄을 바꾼다. */}
              <ul className="list-disc space-y-1 pl-5 text-sm [overflow-wrap:anywhere]">
                {view.evidence.map((e, i) => (
                  <li key={i}>{`${EVIDENCE_KIND_LABEL[e.kind] ?? EVIDENCE_KIND_LABEL.OTHER}: ${e.detail}`}</li>
                ))}
              </ul>
            </div>
          )}
          {view.outdated && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-muted-foreground">{OUTDATED_NOTE}</p>
              <Button size="sm" variant="outline" onClick={request} disabled={requesting}>
                다시 점검
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">AI 판단이라 틀릴 수 있어요 · {formatDateTimeMinute(view.checkedAt)}</p>
        </div>
      )}
    </AiContent>
  )
}
