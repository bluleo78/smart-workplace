import { AlertCircle } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { AiContent } from '@/components/ai/AiContent'
import { AiSummarySkeleton } from '@/components/ai/AiSummarySkeleton'
import { bulletLines } from '@/components/ai/bulletLines'
import { formatMonthDayClock } from '@/lib/formatters'

import { useGenerateWikiSummary, useWikiSummary } from '../../hooks/queries/useWikiSummary'

/**
 * WP-301 노트 상단 AI 요약 카드 — 메일·드라이브와 같은 AiContent 톤.
 *
 * - 요약이 없고(MISSING) 노트가 충분히 길면 노트당 한 번 자동 생성한다. 실패해도 자동 재시도하지 않는다(비용·무한 반복 방지).
 * - 낡음은 캐시의 status(STALE)만 본다 — 다른 사람의 저장은 서버가, 내 저장 직후는 편집기가 syncWikiSummaryVersion 으로 캐시에
 *   반영하므로 카드가 따로 버전을 비교하지 않는다(짧은 노트가 길어졌을 때의 재조회도 그쪽에서 한다).
 * - TOO_SHORT·조회 실패·AI 불가(쿼리 비활성)면 아무것도 그리지 않는다.
 * - accessLost(노트 삭제·접근 불가 종료 상태)면 다시 만들 수 없으므로 다시 시도·다시 요약 버튼을 거둔다(WP-296).
 *   실패·낡음 문구는 남긴다 — 카드를 접으면 그 높이만큼 본문이 튀어 읽던 자리를 잃는다.
 */
export function WikiSummaryCard({ pageId, accessLost = false }: { pageId: number; accessLost?: boolean }) {
  const { data } = useWikiSummary(pageId)
  const generate = useGenerateWikiSummary()
  // 노트별 자동 생성 1회 가드 — 같은 노트로 다시 렌더돼도 재요청하지 않는다.
  const autoTried = useRef<number | null>(null)

  useEffect(() => {
    if (data?.status === 'MISSING' && autoTried.current !== pageId) {
      autoTried.current = pageId
      generate.mutate(pageId)
    }
    // generate 는 매 렌더 새 객체라 의존성에서 뺀다(mutate 는 안정적).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status, pageId])

  // 다른 노트의 생성 상태가 이 카드에 새지 않도록 변수로 확인한다.
  const pendingHere = generate.isPending && generate.variables === pageId
  const failedHere = generate.isError && generate.variables === pageId

  if (!data) return null
  if (!data.summary && !pendingHere && !failedHere) return null // TOO_SHORT 또는 생성 전

  const stale = data.summary != null && data.status === 'STALE'
  const regenerate = () => generate.mutate(pageId)

  return (
    <AiContent label="AI 요약" collapsible defaultOpen className="mb-4" data-testid="wiki-ai-summary">
      {pendingHere ? (
        <AiSummarySkeleton testId="wiki-ai-summary-loading" />
      ) : (
        <>
          {data.summary && <SummaryText text={data.summary} stale={stale} />}
          {/* 터치 기기에선 재생성 버튼의 히트 영역이 넓어지므로 구분점과 겹치지 않게 간격도 조금 넓힌다. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground pointer-coarse:gap-x-3">
            {failedHere ? (
              <>
                {/* 실패는 낡음보다 강한 신호 — destructive 아이콘(비텍스트 3:1 충족)으로 오류임을 알리고,
                    문구는 작은 글자 AA(4.5:1)를 지키도록 본문색으로 둔다(text-destructive 는 카드 배경 위 3.3:1). */}
                <span data-testid="wiki-ai-summary-failed" className="inline-flex items-center gap-1 font-medium text-foreground">
                  <AlertCircle className="h-3 w-3 shrink-0 text-destructive" aria-hidden="true" />
                  요약하지 못했어요
                </span>
                {!accessLost && <RegenerateButton testId="wiki-ai-summary-retry" label="다시 시도" onClick={regenerate} />}
              </>
            ) : stale ? (
              <>
                <span data-testid="wiki-ai-summary-stale" className="text-warning-text">
                  ⚠ 요약 이후 노트가 바뀌었어요
                </span>
                {!accessLost && (
                  <>
                    <span aria-hidden="true">·</span>
                    <RegenerateButton testId="wiki-ai-summary-refresh" label="다시 요약" onClick={regenerate} />
                  </>
                )}
              </>
            ) : (
              data.summarizedAt && <span>{`${formatMonthDayClock(data.summarizedAt)} 요약`}</span>
            )}
          </div>
        </>
      )}
    </AiContent>
  )
}

/**
 * 카드 하단의 요약 재생성 링크 버튼("다시 시도"·"다시 요약") — 같은 모양이라 하나로 둔다.
 * 터치(coarse 포인터)에선 높이를 44px 로 키우되 같은 크기의 음수 세로 마진으로 상쇄해
 * 줄 높이·카드 크기(시각 밀도)는 데스크톱과 똑같이 유지하고 탭 영역만 넓힌다.
 */
/**
 * 요약 본문 — `• ` 목록이면 <ul> 로 그려 줄바꿈된 긴 항목이 기호 뒤로 들여써지게 하고(모바일에서 둘째 줄이 왼쪽 끝으로
 * 붙지 않게), 목록이 아니면 원문 그대로 둔다. 낡은 요약은 흐리게 — 내용은 남겨 두되 최신이 아님을 시각적으로 알린다.
 */
function SummaryText({ text, stale }: { text: string; stale: boolean }) {
  const items = bulletLines(text)
  const className = stale ? 'opacity-60' : undefined
  if (!items) {
    return (
      <div data-testid="wiki-ai-summary-text" className={className}>
        {text}
      </div>
    )
  }
  return (
    <ul data-testid="wiki-ai-summary-text" className={`list-disc pl-4 ${className ?? ''}`}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

function RegenerateButton({ testId, label, onClick }: { testId: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid={testId}
      className="text-ai-accent underline pointer-coarse:-my-3.5 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
      onClick={onClick}
    >
      {label}
    </button>
  )
}
