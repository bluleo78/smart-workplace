// 노트 HTML 블록 스크립트 차단·실행(WP-1290) — 블록마다 따로 묻거나 세지 않고 노트 하나를 한 번에 본다.
// 페이지를 감싸는 Provider 가 스크립트가 든 블록들의 소스를 모아 「노트 지문」 하나를 만들고, 서버가 저장된 노트로 낸 점검(위험도 하나)이
// 같은 지문일 때만 그 결과를 쓴다. 본문 위 줄(WikiHtmlScriptBar)의 스위치 하나로 노트의 블록을 모두 켜고 끈다 — 드라이브·첨부 미리보기
// (HtmlPreview)와 같은 묶음을 쓴다. 블록에는 id 가 없어(htmlEmbedNode — 마크다운 펜스로 저장) 블록 소스로 지문을 만든다. 블록 하나라도
// 바뀌면 지문이 달라져 다시 멈춘다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Code } from 'lucide-react'
import { type ComponentProps, createContext, type ReactNode, type RefObject, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react'

import { client } from '@/api/client'
import { shareHeaders } from '@/api/wiki'
import { useAiAvailable } from '@/hooks/useAiAvailable'
import { isSummaryPollingExhausted } from '@/lib/driveSummary'
import { htmlHasScripts } from '@/lib/sandboxedHtml'
import { securityChip } from '@/lib/securityCheck'
import { cn } from '@/lib/utils'
import type { SecurityCheckView } from '@/types/securityCheck'

import { SandboxedHtmlFrame } from '../SandboxedHtmlFrame'
import { HighRiskScriptConfirm, ScriptControls, SecurityChipView } from '../viewer/ScriptControls'

/** 블록이 놓인 곳. */
export interface WikiHtmlBlockScope {
  pageId: number
  /** 공개 공유(로그인 없음) 토큰 — 저장된 결과만 읽고, 같은 내용으로 끝난 점검이 없으면 켤 수 없다. */
  publicToken?: string
  /** 앱 안 공유 링크로 연 화면의 토큰 — 점검 조회·요청에 헤더로 싣는다. */
  shareToken?: string
  /** 점검 없이 스위치만(판 미리보기 — 서버는 지금 판만 점검한다). */
  noCheck?: boolean
}

/** 서버의 노트 점검 응답 — 서버가 저장된 노트로 계산한 지문·블록 수와 그 지문의 점검 결과. 스크립트 블록이 없으면 hash null. */
export interface WikiHtmlScriptsCheck {
  hash: string | null
  blockCount: number
  view: SecurityCheckView | null
}

interface PageScripts {
  /** 지금 노트 지문이 실행 허용됐나 — 블록은 이 값 하나로 스크립트를 켠다. */
  running: boolean
  /** 실행을 허용한 소스 묶음(이어 붙인 것) — 없으면 null. 소스 하나가 허용됐는지 알릴 때를 기다리지 않고 바로 볼 때 쓴다(useNoteAllowsSource). */
  allowed: string | null
  report: (id: string, source: string | null, anchor?: RefObject<Element | null>) => void
}

/** 노트에 알린 소스 하나 — anchor 는 그 블록이 그려진 요소(문서에서 떨어지면 지운다). */
interface Reported {
  source: string
  anchor?: RefObject<Element | null>
}

const PageScriptsContext = createContext<PageScripts | null>(null)

/** 노트 점검 경로 — 앱 안은 페이지 아래(조회·요청), 공개 공유는 토큰 아래(조회만 — 서버가 결과가 없으면 알아서 점검에 넣는다). */
// eslint-disable-next-line react-refresh/only-export-components
export function htmlScriptsCheckPath(scope: Pick<WikiHtmlBlockScope, 'pageId' | 'publicToken'>): string {
  return scope.publicToken
    ? `/public/wiki/shares/${encodeURIComponent(scope.publicToken)}/pages/${scope.pageId}/html-scripts/security-check`
    : `/wiki/pages/${scope.pageId}/html-scripts/security-check`
}

/** 노트 지문에 넣는 블록 구분자 — 블록 경계가 바뀌면(두 블록을 합침 등) 지문도 바뀌게. 서버(WikiHtmlScripts)와 같아야 한다. */
const BLOCK_SEPARATOR = '\n<!-- wp-html-block -->\n'

/** 노트 지문의 입력 — 소스를 정렬해 이어 붙인다(블록 순서만 바뀐 것은 같은 노트로 본다). 서버와 같은 순서(UTF-16 코드 단위)다. */
// eslint-disable-next-line react-refresh/only-export-components
export function joinHtmlScriptSources(sources: string[]): string {
  return [...sources].sort().join(BLOCK_SEPARATOR)
}

const POLL_INTERVAL_MS = 3000

/**
 * 노트 점검 구독 — 서버가 저장된 노트로 계산한 결과를 읽는다. 점검 중이면 3초 간격, 내 지문과 서버 지문이 다르면(방금 고쳐 아직 저장 전)
 * 저장을 따라잡을 때까지 같은 간격으로 다시 읽는다(둘 다 상한 횟수 안에서). request 는 앱 안 ↻ — 서버가 지금 노트로 다시 점검한다.
 * 상한은 「↻ 를 누른 뒤·노트 지문이 바뀐 뒤 받은 횟수」로 센다(useSecurityCheck 와 같은 까닭 — 상한에 닿은 뒤 다시 점검해도 폴링이 돌게).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useHtmlScriptsCheck(scope: WikiHtmlBlockScope, localHash: string | undefined) {
  const qc = useQueryClient()
  const aiAvailable = useAiAvailable()
  const publicView = !!scope.publicToken
  const path = htmlScriptsCheckPath(scope)
  const queryKey = ['wiki-html-scripts-check', path, scope.shareToken ?? null] as const
  const enabled = !!localHash && !scope.noCheck && (aiAvailable || publicView)
  const countNow = () => qc.getQueryState(queryKey)?.dataUpdateCount ?? 0
  // 폴링 상한의 기준 횟수 — 지문이 바뀌면 그때 횟수로 다시 잡는다(렌더 중 갱신 — 이전 값 비교 패턴).
  const [base, setBase] = useState({ hash: localHash, count: 0 })
  if (base.hash !== localHash) setBase({ hash: localHash, count: countNow() })
  const query = useQuery({
    queryKey,
    queryFn: async () => (await client.get<WikiHtmlScriptsCheck>(path, { headers: shareHeaders(scope.shareToken) })).data,
    enabled,
    retry: false,
    refetchInterval: (q) => {
      const data = q.state.data
      const pending = data?.view?.status === 'PENDING' || data?.view?.status === 'CHECKING'
      const behind = !!data && data.hash !== localHash
      if (!pending && !behind) return false
      return isSummaryPollingExhausted(q.state.dataUpdateCount - base.count) ? false : POLL_INTERVAL_MS
    },
  })
  const mutation = useMutation({
    mutationFn: async () => (await client.post<WikiHtmlScriptsCheck>(path, undefined, { headers: shareHeaders(scope.shareToken) })).data,
    onSuccess: (data) => {
      // setQueryData 가 횟수를 1 올리므로 올린 뒤 값을 기준으로 — 그 응답은 세지 않는다.
      setBase({ hash: localHash, count: countNow() + 1 })
      qc.setQueryData(queryKey, data)
    },
    onError: () => void query.refetch(),
  })
  const data = query.data
  // 같은 지문일 때만 결과를 쓴다 — 서버가 본 노트와 화면의 노트가 다르면(저장 전·추출이 어긋남) 그 결과로 판정하지 않는다.
  const matched = !!data && !!localHash && data.hash === localHash
  return {
    view: matched ? (data.view ?? undefined) : undefined,
    matched,
    // 같은 응답은 data 참조가 그대로라 재렌더가 없다 — dataUpdatedAt 을 읽어 받을 때마다 상한 판정이 갱신되게 한다.
    pollingExhausted: query.dataUpdatedAt >= 0 && isSummaryPollingExhausted(countNow() - base.count),
    request: () => mutation.mutate(),
    requesting: mutation.isPending,
    errored: query.isError || mutation.isError,
  }
}

/**
 * 페이지를 감싸 블록 NodeView 에 실행 여부를 내려 준다. 스크립트 줄은 {@link WikiHtmlScriptBar} 를 이 안 원하는 자리에 둔다.
 * - 지문은 블록 소스를 정렬해 이어 붙인 것의 SHA-256 — 서버와 같은 규칙.
 * - 스위치를 켜면 지금 소스 묶음을 허용한다. 하나라도 바뀌면(블록을 고침·새 블록) 다시 멈춘다.
 */
export function WikiHtmlBlockScopeProvider({ scope, children }: { scope: WikiHtmlBlockScope; children: ReactNode }) {
  const [sources, setSources] = useState<Record<string, Reported>>({})
  // 허용은 지문이 아니라 이어 붙인 소스로 기억한다 — 비보안 출처(http)라 지문을 못 내도 앱 안 스위치는 돈다.
  const [allowedSources, setAllowedSources] = useState<string | null>(null)
  const report = useCallback((id: string, source: string | null, anchor?: RefObject<Element | null>) => {
    setSources((prev) => {
      if (source == null) {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      }
      return prev[id]?.source === source && prev[id]?.anchor === anchor ? prev : { ...prev, [id]: { source, anchor } }
    })
  }, [])
  // 문서에서 떨어진 블록을 지운다 — 개발 모드(StrictMode)에서 setContent 가 두 번 돌면 tiptap 이 첫 NodeView 의 React 컴포넌트를 언마운트하지 않고
  // 남겨(정리 report 가 오지 않음) 블록 하나가 두 번 세지고 지문이 서버와 어긋난다. 알린 뒤 한 프레임 뒤에 연결 여부로 거른다.
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      setSources((prev) => {
        const stale = Object.keys(prev).filter((id) => prev[id].anchor?.current?.isConnected === false)
        if (stale.length === 0) return prev
        const next = { ...prev }
        for (const id of stale) delete next[id]
        return next
      }),
    )
    return () => cancelAnimationFrame(frame)
  }, [sources])
  const joined = useMemo(() => joinHtmlScriptSources(Object.values(sources).map((r) => r.source)), [sources])
  const hash = useSourceHash(joined)
  const count = Object.keys(sources).length
  const running = count > 0 && allowedSources === joined
  const value = useMemo(() => ({ running, allowed: allowedSources, report }), [running, allowedSources, report])
  const bar = useMemo(
    () => ({ scope, count, hash, running, onAllow: (on: boolean) => setAllowedSources(on ? joined : null) }),
    [scope, count, hash, running, joined],
  )
  return (
    <PageScriptsContext.Provider value={value}>
      <ScriptBarContext.Provider value={bar}>{children}</ScriptBarContext.Provider>
    </PageScriptsContext.Provider>
  )
}

interface ScriptBarState {
  scope: WikiHtmlBlockScope
  count: number
  hash: string | undefined
  running: boolean
  onAllow: (on: boolean) => void
}

const ScriptBarContext = createContext<ScriptBarState | null>(null)

/**
 * 공개 공유에서 켤 수 없는 까닭 — 같은 내용으로 끝난 점검이 없거나(점검 중·저장 전), 「높음」이거나, 점검이 실패했으면(너무 큼 포함 — 보지 못한
 * 스크립트를 로그인 없는 손님에게 돌리지 않는다). AI 가 없는 워크스페이스(NO_AI)는 점검을 할 수 없어 막지 않는다(보는 사람이 켜서 동의).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function publicRunBlock(view: SecurityCheckView | undefined, matched: boolean): string | undefined {
  if (view?.status === 'DONE' && view.risk === 'HIGH') return '위험할 수 있는 스크립트라 공유 페이지에서는 실행할 수 없어요'
  if (matched && (view?.status === 'DONE' || view?.reason === 'NO_AI')) return undefined
  if (matched && view?.status === 'FAILED') return '보안 점검을 마치지 못해 공유 페이지에서는 실행할 수 없어요'
  return '보안 점검이 끝나면 실행할 수 있어요'
}

/**
 * 노트 스크립트 줄 — 제목 아래 한 줄: [</> 스크립트가 있는 HTML 블록 N개 · 상태 ……… [● 높음 · 위협 2 | ↻ | </> 스크립트 ◯]].
 * 묶음은 미리보기(HtmlPreview)와 같은 ScriptControls·SecurityChipView 다. 노트가 「높음」이면 줄이 붉고 AI 의 한 줄 이유를 보인다.
 * 스크립트 블록이 없으면 그리지 않는다.
 */
export function WikiHtmlScriptBar({ className }: { className?: string }) {
  const state = useContext(ScriptBarContext)
  if (!state || state.count === 0) return null
  return <ScriptBar {...state} className={className} />
}

function ScriptBar({ scope, count, hash, running, onAllow, className }: ScriptBarState & { className?: string }) {
  const publicView = !!scope.publicToken
  const aiAvailable = useAiAvailable()
  const { view, matched, pollingExhausted, request, requesting, errored } = useHtmlScriptsCheck(scope, hash)
  // 공개 공유는 서버가 결과를 내주므로 AI 가용성으로 칩을 막지 않는다. 지문이 다르면(저장 전) 「점검 전」으로 보인다.
  const chipView = view ?? (hash ? EMPTY_VIEW : undefined)
  const chip = securityChip(chipView, { pollingExhausted, requesting, aiAvailable: aiAvailable || publicView, errored })
  const high = view?.status === 'DONE' && view.risk === 'HIGH'
  const [confirmOpen, setConfirmOpen] = useState(false)
  const blockedReason = publicView ? publicRunBlock(view, matched) : undefined
  const noticeText = running ? '스크립트 실행 중' : high && view?.headline ? view.headline : '스크립트가 멈춰 있어요'
  const toggle = (on: boolean) => {
    if (!on) onAllow(false)
    else if (high) setConfirmOpen(true)
    else onAllow(true)
  }
  return (
    <div
      className={cn(
        'mb-3 flex items-center gap-2 rounded-md border py-1 pr-1 pl-2.5 text-xs',
        high ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/50',
        className,
      )}
      data-testid="wiki-html-script-bar"
      data-on={running ? 'true' : 'false'}
      data-risk={view?.status === 'DONE' ? (view.risk ?? undefined) : undefined}
    >
      <Code className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className={cn('min-w-0 flex-1 truncate', high ? 'text-foreground' : 'text-muted-foreground')}>
        스크립트가 있는 HTML 블록 {count}개 · {noticeText}
      </span>
      <ScriptControls
        high={high}
        noticeText={noticeText}
        scriptsAllowed={running}
        onToggle={toggle}
        label="노트 스크립트"
        disabledReason={running ? undefined : blockedReason}
        // 노트는 블록을 고친 뒤 다시 맡기는 일이 잦아 결과가 있어도 ↻ 를 둔다(공개 공유는 점검을 부르지 않는다). 판 미리보기는 칩이 없다.
        security={
          scope.noCheck ? null : (
            <SecurityChipView chip={chip} view={view} onRequest={publicView ? undefined : request} recheckAlways={!publicView} />
          )
        }
      />
      <HighRiskScriptConfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        headline={view?.headline}
        fallbackHeadline="AI 가 이 노트의 스크립트를 위험하게 봤어요."
        scopeNote="이 노트의 HTML 블록이 모두 실행돼요. 블록 안에서만 돌고, 앱의 로그인 정보와 데이터에는 닿지 못해요."
        onConfirm={() => onAllow(true)}
      />
    </div>
  )
}

/** 결과가 없는 점검(점검 전) — 칩이 「AI 보안 점검」 단추로 보이게. */
const EMPTY_VIEW: SecurityCheckView = { status: null, risk: null, headline: null, evidence: [], checkedAt: null, reason: null }

/**
 * 블록이 노트에 소스를 알리고 실행 여부를 읽는다. 스크립트가 없는 블록은 알리지 않는다(source=null).
 * 범위가 없으면 null. id 는 블록 NodeView 인스턴스마다 하나(useId).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useHtmlBlockPageScripts(
  id: string,
  source: string | null,
  anchor?: RefObject<Element | null>,
): { running: boolean } | null {
  const ctx = useContext(PageScriptsContext)
  const reportFn = ctx?.report
  useEffect(() => {
    reportFn?.(id, source, anchor)
  }, [reportFn, id, source, anchor])
  useEffect(() => () => reportFn?.(id, null), [reportFn, id])
  return ctx ? { running: ctx.running } : null
}

/**
 * HTML 소스 하나(블록·HTML 문서)의 스크립트 실행 여부 — 스크립트가 들면 소스를 노트에 알리고, 노트가 실행 허용일 때만 running.
 * 스크립트가 없으면 늘 running(막을 것이 없다). 범위(Provider)가 없는 화면은 지금처럼 돈다.
 * anchor 는 소스가 그려진 요소 — 문서에서 떨어지면 노트가 그 소스를 지운다(언마운트되지 않고 남은 NodeView 대비).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useHtmlSourceScripts(source: string, anchor?: RefObject<Element | null>): { running: boolean } {
  const id = useId()
  const hasScripts = useMemo(() => htmlHasScripts(source), [source])
  const page = useHtmlBlockPageScripts(id, hasScripts ? source : null, anchor)
  return { running: !hasScripts || !page || page.running }
}

/**
 * 노트 스위치를 따르는 격리 iframe — HTML 문서 페이지·크게 보기·AI 비교처럼 블록 NodeView 밖에서 노트 HTML 을 그릴 때 쓴다.
 * 스크립트가 든 소스는 노트에 알려 지문에 넣고, 노트가 실행 허용일 때만 스크립트를 돌린다. register=false 면 알리지 않고 실행 여부만 따른다
 * (같은 블록의 다른 미리보기 — 크게 보기·AI 비교 — 가 지문을 바꾸지 않게).
 */
export function NoteScriptFrame({
  html,
  scriptSource = html,
  register = true,
  ...props
}: {
  html: string
  /** 스크립트 판정·지문에 쓸 소스 — html 이 높이 보고 스크립트를 덧붙인 문서일 때 원래 소스를 넘긴다. */
  scriptSource?: string
  register?: boolean
} & Omit<ComponentProps<typeof SandboxedHtmlFrame>, 'html' | 'allowScripts'>) {
  const id = useId()
  const hasScripts = useMemo(() => htmlHasScripts(scriptSource), [scriptSource])
  const page = useHtmlBlockPageScripts(id, register && hasScripts ? scriptSource : null)
  const running = !hasScripts || (page?.running ?? true)
  return <SandboxedHtmlFrame {...props} html={html} allowScripts={running} />
}

/**
 * 소스 하나(HTML 문서 한 장)를 노트가 실행 허용했나 — 알리기(report)가 노트에 닿기를 기다리지 않고 허용한 묶음과 바로 견준다.
 * 보이는 화면 편집(WP-1309)이 띄울 때 첫 렌더부터 맞는 값을 써야 해서 둔다(알리기 전 첫 렌더의 running 은 지난 소스 기준이라, 허용 안 된
 * 소스의 스크립트가 한 번 돌 수 있다). 노트에 이 소스 하나만 있을 때 맞다(HTML 문서 페이지). 스크립트가 없거나 범위가 없으면 true.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useNoteAllowsSource(source: string): boolean {
  const ctx = useContext(PageScriptsContext)
  const hasScripts = useMemo(() => htmlHasScripts(source), [source])
  return !hasScripts || !ctx || ctx.allowed === joinHtmlScriptSources([source])
}

/** 노트 실행 여부만 읽는다(블록 밖 미리보기 — 크게 보기·AI 비교). 범위가 없으면 null. */
// eslint-disable-next-line react-refresh/only-export-components
export function useHtmlBlockPageRunning(): boolean | null {
  return useContext(PageScriptsContext)?.running ?? null
}

/** 소스 지문(SHA-256 16진) — 소스가 바뀌면 새로 계산한다. 계산 전·실패(비보안 출처 등)면 undefined. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSourceHash(source: string): string | undefined {
  const [hash, setHash] = useState<{ source: string; value: string }>()
  useEffect(() => {
    let alive = true
    void sha256Hex(source)?.then((value) => {
      if (alive) setHash({ source, value })
    })
    return () => {
      alive = false
    }
  }, [source])
  // 지난 소스의 지문은 쓰지 않는다 — 바뀐 노트에 예전 결과가 붙지 않게.
  return hash?.source === source ? hash.value : undefined
}

/** SHA-256 16진(UTF-8) — 비보안 출처 등으로 subtle 이 없으면 undefined. */
// eslint-disable-next-line react-refresh/only-export-components
export function sha256Hex(text: string): Promise<string> | undefined {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return undefined
  return subtle
    .digest('SHA-256', new TextEncoder().encode(text))
    .then((buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(''))
}
