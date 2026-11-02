// 공개 공유 확인 창의 HTML 블록 점검 결과(WP-1290) — 외부에 공개하기 전에 노트 스크립트 전체의 AI 보안 점검 결과(위험도 하나)를 보여 주고,
// 「높음」이 있으면 위험을 알고 공개한다는 동의를 받아야 공개 단추가 켜진다. 칩·확인 창과 같은 색·문구 체계(붉은 강조, AI headline).

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Code } from 'lucide-react'
import { useEffect, useState } from 'react'

import { client } from '../../api/client'
import { isSummaryPollingExhausted } from '../../lib/driveSummary'
import { chipText, securityChip } from '../../lib/securityCheck'
import { cn } from '../../lib/utils'
import { Checkbox } from '../ui/checkbox'
import { htmlScriptsCheckPath, type WikiHtmlScriptsCheck } from './wikiHtmlBlockSecurity'


const POLL_MS = 3000

/**
 * 이 페이지의 스크립트 점검 결과 — 연 순간 한 번 POST 해 서버가 저장된 노트로 결과가 없으면 점검에 넣고(실패·지난 기준 결과는 다시 점검),
 * 그 뒤로는 끝날 때까지 GET 으로만 읽는다(진행 중인 점검을 폴링마다 다시 넣지 않게). 폴링은 미리보기 요약과 같은 상한 횟수까지만 한다.
 * requesting = 연 순간의 POST 가 아직 돌아오지 않음, exhausted = 상한까지 읽었는데 아직 점검 중.
 */
function useShareScriptsCheck(pageId: number) {
  const qc = useQueryClient()
  const path = htmlScriptsCheckPath({ pageId })
  const queryKey = ['wiki-share-html-scripts-check', pageId] as const
  const [requested, setRequested] = useState(false)
  useEffect(() => {
    let alive = true
    void client
      .post<WikiHtmlScriptsCheck>(path)
      .then((res) => alive && qc.setQueryData(queryKey, res.data))
      .catch(() => undefined)
      .finally(() => alive && setRequested(true))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 창을 열 때 한 번만 요청한다(queryKey 는 pageId 로 정해진다).
  }, [path, qc])
  const query = useQuery({
    queryKey,
    queryFn: async () => (await client.get<WikiHtmlScriptsCheck>(path)).data,
    enabled: requested,
    // 창을 열 때 받은 POST 응답을 그대로 쓴다 — 끝난 결과는 다시 읽지 않고, 점검 중일 때만 아래 간격으로 읽는다.
    staleTime: Infinity,
    refetchInterval: (q) =>
      isChecking(q.state.data) && !isSummaryPollingExhausted(q.state.dataUpdateCount) ? POLL_MS : false,
  })
  // 같은 응답은 data 참조가 그대로라 재렌더가 없다 — dataUpdatedAt 을 읽어 받을 때마다 상한 판정이 갱신되게 한다.
  const exhausted = query.dataUpdatedAt >= 0 && isSummaryPollingExhausted(qc.getQueryState(queryKey)?.dataUpdateCount ?? 0)
  return { data: query.data, requesting: !requested, exhausted }
}

function isChecking(check: WikiHtmlScriptsCheck | undefined) {
  return check?.view?.status === 'PENDING' || check?.view?.status === 'CHECKING'
}

/** 점검 결과의 판정 — 높음인지, 아직 점검 중인지(실패·AI 없음은 막지 않는다). */
// eslint-disable-next-line react-refresh/only-export-components
export function scriptsCheckVerdict(check: WikiHtmlScriptsCheck | undefined) {
  const view = check?.view
  return {
    high: view?.status === 'DONE' && view.risk === 'HIGH',
    checking: isChecking(check),
  }
}

/** 공개 단추를 막을지 — 연 순간의 요청이 아직 안 돌아왔거나, 점검 중(상한 전)이거나, 높음인데 동의 전. */
// eslint-disable-next-line react-refresh/only-export-components
export function shareScriptsBlocking(s: { requesting: boolean; checking: boolean; exhausted: boolean; high: boolean; agreed: boolean }) {
  return s.requesting || (s.checking && !s.exhausted) || (s.high && !s.agreed)
}

const RISK_DOT_CLASS = { LOW: 'bg-success', CAUTION: 'bg-warning', HIGH: 'bg-destructive' } as const

/**
 * 확인 창 본문 아래에 놓는 점검 결과 — 스크립트 블록이 없으면 아무것도 그리지 않는다.
 * onBlockingChange 로 「공개 단추를 막을지」(높음인데 동의 전, 연 순간의 요청이 아직 안 돌아옴, 점검 중)를 위로 알린다 — 칸이 사라지면(확인 창 닫힘) false.
 * 점검이 상한 시간을 넘겨도 끝나지 않으면 더 막지 않는다(공개 보기는 끝난 점검이 없으면 스크립트를 켤 수 없어 그대로 안전하다).
 * 동의는 이 칸의 상태라 확인 창을 다시 열면 지워진다.
 */
export function WikiShareHtmlBlockChecks({
  pageId,
  onBlockingChange,
}: {
  pageId: number
  onBlockingChange: (blocking: boolean) => void
}) {
  const [agreed, setAgreed] = useState(false)
  const { data: check, requesting, exhausted } = useShareScriptsCheck(pageId)
  const { high, checking } = scriptsCheckVerdict(check)
  const blocking = shareScriptsBlocking({ requesting, checking, exhausted, high, agreed })
  useEffect(() => {
    onBlockingChange(blocking)
  }, [blocking, onBlockingChange])
  useEffect(() => () => onBlockingChange(false), [onBlockingChange])
  if (!check?.blockCount) return null
  const chip = securityChip(check.view ?? undefined, { pollingExhausted: false, requesting: false, aiAvailable: true })

  return (
    <div className="space-y-2 text-sm" data-testid="wiki-share-html-checks">
      <div
        className={cn('flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs', high && 'border-destructive/50 bg-destructive/10')}
        data-risk={chip.kind === 'result' ? chip.risk : undefined}
      >
        <Code className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-foreground">스크립트가 있는 HTML 블록 {check.blockCount}개 — AI 보안 점검</span>
          {high && check.view?.headline && <span className="block text-foreground">{check.view.headline}</span>}
        </span>
        <span className={cn('flex shrink-0 items-center gap-1.5', chip.kind === 'result' ? 'font-medium' : 'text-muted-foreground')}>
          {chip.kind === 'result' && <span className={cn('size-2 rounded-full', RISK_DOT_CLASS[chip.risk])} aria-hidden />}
          {chip.kind === 'failed' ? '점검 못 함' : chipText(chip)}
        </span>
      </div>
      {checking && (
        <p className="text-xs text-muted-foreground">
          {exhausted
            ? '점검이 오래 걸리고 있어요. 지금 공개하면 점검이 끝날 때까지 공유 페이지에서 스크립트가 멈춰 있어요.'
            : '점검이 끝나면 공개할 수 있어요.'}
        </p>
      )}
      {high && (
        <label className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-xs text-foreground">
          <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} aria-label="위험을 알고 공개" className="mt-0.5" />
          <span>
            <span className="block font-medium">위험할 수 있는 스크립트가 있는 노트예요</span>
            <span className="block text-muted-foreground">공유 페이지에서는 이 노트의 스크립트를 켤 수 없고 멈춘 채로 보여요. 위험을 알고 공개합니다.</span>
          </span>
        </label>
      )}
    </div>
  )
}
