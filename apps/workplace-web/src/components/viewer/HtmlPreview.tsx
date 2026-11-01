import { Code } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useSecurityCheck } from '../../hooks/queries/useSecurityCheck'
import { useAiAvailable } from '../../hooks/useAiAvailable'
import { htmlHasScripts } from '../../lib/sandboxedHtml'
import { chipText, RISK_CHIP_CLASS, type SecurityChip,securityChip } from '../../lib/securityCheck'
import { cn } from '../../lib/utils'
import { SandboxedHtmlFrame } from '../SandboxedHtmlFrame'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'

/**
 * HTML 파일 미리보기(드라이브·첨부 공용, WP-1260·WP-1262).
 *
 * - 기본은 스크립트 차단 격리 iframe 이다(#486·#732) — 받은 HTML 은 신뢰할 수 없다.
 * - 스크립트가 든 문서(발표 자료처럼 스크립트가 배치·이동을 맡는 문서)는 차단하면 모양이 무너지므로,
 *   위에 안내 줄과 「스크립트 실행」 스위치를 둔다. 켜면 이 미리보기만 노트 HTML 블록(WP-1242)과 같은 격리
 *   (allowScripts — 불투명 출처라 앱 쿠키·저장소·화면에 닿지 못함, 대화상자 차단)로 다시 그린다.
 * - 허용은 그 문서에만 걸린다 — 허용한 문서 문자열을 기억해 두고 같을 때만 허용하므로, 같은 자리에서 내용이 바뀌어도(다시 받기)
 *   새 문서는 다시 차단된다. 뷰어가 항목마다 key 로 새로 붙여 다른 파일로 넘기거나 다시 열어도 차단으로 돌아간다.
 * - securityCheckPath 가 있으면 안내 줄에 AI 보안 점검 칩을 둔다(WP-1262). 점검이 안 끝났거나 실패해도 스위치는 늘 쓸 수 있다.
 *   AI 가 「높음」으로 본 문서는 켤 때 확인 창을 한 번 거친다.
 */
export function HtmlPreview({
  html,
  title,
  securityCheckPath,
  onOpenPanel,
}: {
  html: string
  title: string
  /** 보안 점검 조회·요청 경로 — 없으면(공개 공유 링크) 칩 없이 스위치만. */
  securityCheckPath?: string
  /** 결과 칩을 누르면 AI 패널을 연다. */
  onOpenPanel?: () => void
}) {
  // 수 MB 문서를 렌더마다 훑지 않게 문서가 바뀔 때만 판정한다.
  const hasScripts = useMemo(() => htmlHasScripts(html), [html])
  const [allowedHtml, setAllowedHtml] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const scriptsAllowed = allowedHtml === html
  const aiAvailable = useAiAvailable()
  const { view, pollingExhausted, request, requesting, errored } = useSecurityCheck(securityCheckPath, hasScripts)
  const chip = securityCheckPath
    ? securityChip(view, { pollingExhausted, requesting, aiAvailable, errored })
    : ({ kind: 'hidden' } as SecurityChip)
  const isHigh = view?.status === 'DONE' && view.risk === 'HIGH'
  // 실행 중이면 높음이어도 「스크립트 실행 중」(붉은 줄은 유지) — 아니면 높음일 때 AI 의 headline.
  const noticeText = scriptsAllowed ? '스크립트 실행 중' : isHigh && view?.headline ? view.headline : '이 문서에는 스크립트가 있어요'

  /** 스위치 — 끄기는 바로, 켜기는 AI 가 높음으로 본 문서만 확인 창을 거친다. */
  const toggle = (on: boolean) => {
    if (!on) setAllowedHtml(null)
    else if (isHigh) setConfirmOpen(true)
    else setAllowedHtml(html)
  }

  return (
    <div className="flex h-full min-h-[60vh] flex-col">
      {hasScripts && (
        // 스위치를 품은 안내라 role=status(라이브 영역)를 쓰지 않는다 — 열 때마다 낭독되는 알림이 아니라 고를 수 있는 컨트롤이다.
        <div
          className={cn(
            'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-sm',
            isHigh ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
          )}
          data-testid="html-script-notice"
        >
          <Code className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 break-keep">{noticeText}</span>
          <SecurityChipView chip={chip} view={view} onRequest={request} onOpenPanel={onOpenPanel} />
          <label className="flex shrink-0 items-center gap-2">
            <span>스크립트 실행</span>
            <Switch size="sm" checked={scriptsAllowed} onCheckedChange={toggle} aria-label="스크립트 실행" />
          </label>
        </div>
      )}
      <SandboxedHtmlFrame
        data-testid="html-document"
        title={title}
        html={html}
        allowScripts={scriptsAllowed}
        className="block min-h-0 w-full flex-1 border-0"
      />
      {/* 위험 문서 확인 — 뷰어(다크 라이트박스·AI 시트 위 z-[80]) 위에 떠야 해 z-[100] + 딤은 index.css 표식 규칙. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-security-confirm className="z-[100]">
          <AlertDialogHeader>
            <AlertDialogTitle>위험할 수 있는 스크립트예요</AlertDialogTitle>
            {/* AI 의 한 줄 이유는 마침표가 없을 수 있어 안내 문장과 줄을 나눈다. */}
            <AlertDialogDescription className="space-y-1">
              <span className="block font-medium text-foreground">{view?.headline ?? 'AI 가 이 문서의 스크립트를 위험하게 봤어요.'}</span>
              <span className="block">이 미리보기에서만 실행되고, 앱의 로그인 정보와 데이터에는 닿지 못해요.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setAllowedHtml(html)
                setConfirmOpen(false)
              }}
            >
              그래도 실행
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** 안내 줄 오른쪽의 점검 칩 — 종류별로 단추·글자·결과 칩을 그린다. */
function SecurityChipView({
  chip,
  view,
  onRequest,
  onOpenPanel,
}: {
  chip: SecurityChip
  view: ReturnType<typeof useSecurityCheck>['view']
  onRequest: () => void
  onOpenPanel?: () => void
}) {
  const text = chipText(chip)
  switch (chip.kind) {
    case 'idle':
      return (
        <Button size="sm" variant="outline" onClick={onRequest}>
          {text}
        </Button>
      )
    case 'checking':
      return <span className="shrink-0">{text}</span>
    case 'failed':
      return (
        <>
          <span className="shrink-0">{text}</span>
          {chip.canRetry && (
            <Button size="sm" variant="outline" onClick={onRequest}>
              다시 점검
            </Button>
          )}
        </>
      )
    case 'result': {
      const cls = cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', RISK_CHIP_CLASS[chip.risk])
      return onOpenPanel ? (
        <button type="button" className={cls} onClick={onOpenPanel} title={view?.headline ?? undefined}>
          {text}
        </button>
      ) : (
        <span className={cls}>{text}</span>
      )
    }
    default:
      return null
  }
}
