import { ChevronRight, Code } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { useSecurityCheck } from '../../hooks/queries/useSecurityCheck'
import { useAiAvailable } from '../../hooks/useAiAvailable'
import { htmlHasScripts } from '../../lib/sandboxedHtml'
import { chipText, OUTDATED_NOTE, type SecurityChip,securityChip } from '../../lib/securityCheck'
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
import { Switch } from '../ui/switch'

/**
 * HTML 파일 미리보기(드라이브·첨부 공용, WP-1260·WP-1262).
 *
 * - 기본은 스크립트 차단 격리 iframe 이다(#486·#732) — 받은 HTML 은 신뢰할 수 없다.
 * - 스크립트가 든 문서(발표 자료처럼 스크립트가 배치·이동을 맡는 문서)는 차단하면 모양이 무너지므로,
 *   「스크립트 실행」 스위치를 둔다 — 문서 영역에 안내 줄을 두지 않고, 데스크톱은 뷰어 머리줄에, 모바일은 문서 위에 떠 있는 묶음으로(WP-1282). 켜면 이 미리보기만 노트 HTML 블록(WP-1242)과 같은 격리
 *   (allowScripts — 불투명 출처라 앱 쿠키·저장소·화면에 닿지 못함, 대화상자 차단)로 다시 그린다.
 * - 허용은 그 문서에만 걸린다 — 허용한 문서 문자열을 기억해 두고 같을 때만 허용하므로, 같은 자리에서 내용이 바뀌어도(다시 받기)
 *   새 문서는 다시 차단된다. 뷰어가 항목마다 key 로 새로 붙여 다른 파일로 넘기거나 다시 열어도 차단으로 돌아간다.
 * - securityCheckPath 가 있으면 그 묶음에 AI 보안 점검 칩을 둔다(WP-1262). 점검이 안 끝났거나 실패해도 스위치는 늘 쓸 수 있다.
 *   AI 가 「높음」으로 본 문서는 켤 때 확인 창을 한 번 거친다.
 */
export function HtmlPreview({
  html,
  title,
  securityCheckPath,
  onOpenPanel,
  toolbarSlot,
}: {
  html: string
  title: string
  /** 보안 점검 조회·요청 경로 — 없으면(공개 공유 링크) 칩 없이 스위치만. */
  securityCheckPath?: string
  /** 결과 칩을 누르면 AI 패널을 연다. */
  onOpenPanel?: () => void
  /** 뷰어 머리줄의 컨트롤 자리(데스크톱) — 있으면 스크립트 컨트롤을 그리로 포털하고, 없으면 문서 위에 띄운다(WP-1282). */
  toolbarSlot?: HTMLElement | null
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

  // 스크립트 컨트롤 묶음(점검 칩 + 실행 스위치) — 문서 영역에 한 줄을 차지하던 안내 줄을 없애고(WP-1282) 이 묶음만 둔다.
  // 데스크톱은 뷰어 머리줄 슬롯으로 포털해 파일 조작 아이콘 앞에 서고, 슬롯이 없으면(모바일) 문서 오른쪽 위에 떠 있다.
  const controls = hasScripts && (
    <ScriptControls
      floating={!toolbarSlot}
      high={isHigh}
      noticeText={noticeText}
      scriptsAllowed={scriptsAllowed}
      onToggle={toggle}
      security={<SecurityChipView chip={chip} view={view} onRequest={request} onOpenPanel={onOpenPanel} />}
    />
  )

  return (
    // 본문 영역 높이에 딱 맞춘다(WP-1282) — 예전 min-h-[60vh] 는 창이 낮을 때 본문 영역(overflow-auto)을 넘쳐
    // 바깥 스크롤바가 생겼다. 스크롤은 문서 iframe 안에서만 일어난다. relative = 떠 있는 컨트롤의 기준.
    <div className="relative flex h-full min-h-0 flex-col">
      {controls &&
        (toolbarSlot
          ? createPortal(
              <>
                {controls}
                {/* 머리줄의 파일 조작 아이콘과 가르는 세로 선 — 닫기 앞 구분선과 같은 모양. */}
                <div className="mx-1 h-5 w-px bg-border" aria-hidden />
              </>,
              toolbarSlot,
            )
          : controls)}
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

/**
 * 스크립트 컨트롤 묶음(WP-1282) — 테두리 하나로 감싼 높이 32px 의 한 덩어리: [점검 칩 | </> 스크립트 ◯].
 * 머리줄 아이콘 단추와 높이를 맞추고, 조각마다 색·모양이 흩어지지 않게 위험도는 점 색 하나로만 보인다.
 * 안내 문장(「이 문서에는 스크립트가 있어요」·「스크립트 실행 중」·높음 headline)은 줄을 차지하지 않고 툴팁과 화면낭독기 글로 남는다.
 */
function ScriptControls({
  floating,
  high,
  noticeText,
  scriptsAllowed,
  onToggle,
  security,
}: {
  /** 문서 오른쪽 위에 떠 있다(모바일) — 문서 위에 겹치므로 불투명 배경·그림자를 단다. */
  floating: boolean
  high: boolean
  noticeText: string
  scriptsAllowed: boolean
  onToggle: (on: boolean) => void
  security: ReactNode
}) {
  return (
    <div
      role="group"
      aria-label="문서 스크립트"
      title={noticeText}
      data-testid="html-script-notice"
      className={cn(
        'flex h-8 shrink-0 items-center rounded-md border text-xs',
        high ? 'border-destructive/50' : 'border-border',
        // 떠 있을 때 위 여백에 노치(안전영역)를 더한다 — 모바일 바를 숨기면 본문 위 여백이 사라져 상태바 밑으로 들어가지 않게.
        floating && 'absolute top-[calc(0.5rem+env(safe-area-inset-top))] right-3 z-10 bg-popover text-popover-foreground shadow-md',
      )}
    >
      {/* 줄을 없앤 대신 안내 문장은 화면낭독기에 남긴다(지금 상태 — 실행 중·높음 이유 포함). */}
      <span className="sr-only">{noticeText}</span>
      {security}
      <label className={cn('flex h-full items-center gap-1.5 pr-2 pl-2.5', scriptsAllowed ? 'text-foreground' : 'text-muted-foreground')}>
        <Code className="size-3.5 shrink-0" aria-hidden />
        <span aria-hidden>스크립트</span>
        <Switch size="sm" checked={scriptsAllowed} onCheckedChange={onToggle} aria-label="스크립트 실행" className="ml-0.5" />
      </label>
    </div>
  )
}

/** 위험도 점 색 — 칩 배경 대신 점 하나로 위험도를 보인다(묶음이 한 덩어리로 보이게, WP-1282). */
const RISK_DOT_CLASS = { LOW: 'bg-success', CAUTION: 'bg-warning', HIGH: 'bg-destructive' } as const

/** 묶음 왼쪽 조각(점검 상태) — 종류별로 단추·글자·결과를 그리고, 뒤에 스위치와 가르는 세로 선을 둔다. 숨김이면 아무것도 없다. */
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
  // 조각 공통 모양 — 묶음 높이를 꽉 채우고 왼쪽 모서리만 둥글게(묶음 테두리 안쪽).
  const seg = 'flex h-full shrink-0 items-center gap-1.5 rounded-l-[5px] px-2.5'
  const action = cn(seg, 'font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50')
  const divider = <div className="h-4 w-px shrink-0 bg-border" aria-hidden />
  let body: ReactNode
  switch (chip.kind) {
    case 'idle':
      body = (
        <button type="button" className={action} onClick={onRequest}>
          {text}
        </button>
      )
      break
    case 'checking':
      body = <span className={cn(seg, 'text-muted-foreground')}>{text}</span>
      break
    case 'failed':
      // 보이는 글은 「점검 못 함」으로 줄이고(묶음이 길어지지 않게) 온전한 문장은 화면낭독기 글로 둔다. 다시 점검은 옆 단추.
      body = (
        <>
          <span className="sr-only">{text}</span>
          <span aria-hidden title={text} className={cn(seg, 'text-muted-foreground', chip.canRetry && 'pr-1')}>
            점검 못 함
          </span>
          {chip.canRetry && (
            <button type="button" className={cn(action, 'rounded-none px-1.5 text-primary')} onClick={onRequest}>
              다시 점검
            </button>
          )}
        </>
      )
      break
    case 'result': {
      const content = (
        <>
          <span className={cn('size-2 shrink-0 rounded-full', RISK_DOT_CLASS[chip.risk])} aria-hidden />
          {text}
        </>
      )
      // 누르면 AI 패널의 보안 점검 근거가 열린다는 게 보이게 › 를 붙인다.
      body = onOpenPanel ? (
        <button type="button" className={action} onClick={onOpenPanel} title={view?.headline ?? undefined}>
          {content}
          <ChevronRight className="-mr-1 size-3.5 text-muted-foreground" aria-hidden />
        </button>
      ) : (
        <span className={cn(seg, 'font-medium')}>{content}</span>
      )
      // 지난 기준의 결과는 그대로 보이되 새 기준으로 다시 점검할 조각을 결과 옆에 둔다(WP-1283) — 묶음 안 같은 모양의 조각으로.
      if (chip.outdated) {
        body = (
          <>
            {body}
            <button type="button" className={cn(action, 'rounded-none px-1.5 text-primary')} onClick={onRequest} title={OUTDATED_NOTE}>
              다시 점검
            </button>
          </>
        )
      }
      break
    }
    default:
      return null
  }
  return (
    <>
      {body}
      {divider}
    </>
  )
}
