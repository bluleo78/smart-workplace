import { ChevronRight, Code, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'

import { chipText, OUTDATED_NOTE, type SecurityChip } from '../../lib/securityCheck'
import { cn } from '../../lib/utils'
import type { SecurityCheckView } from '../../types/securityCheck'
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

// HTML 스크립트 컨트롤 공용 조각(WP-1290) — 드라이브·첨부 미리보기(HtmlPreview)와 노트 HTML 블록이 같은 모양·문구·동작을 쓰게 한곳에 둔다.

/**
 * 스크립트 컨트롤 묶음(WP-1282) — 테두리 하나로 감싼 높이 32px 의 한 덩어리: [점검 칩 | </> 스크립트 ◯].
 * 머리줄 아이콘 단추와 높이를 맞추고, 조각마다 색·모양이 흩어지지 않게 위험도는 점 색 하나로만 보인다.
 * 안내 문장(「이 문서에는 스크립트가 있어요」·「스크립트 실행 중」·높음 headline)은 줄을 차지하지 않고 툴팁과 화면낭독기 글로 남는다.
 */
export function ScriptControls({
  floating = false,
  high,
  noticeText,
  scriptsAllowed,
  onToggle,
  security,
  label = '문서 스크립트',
  disabledReason,
}: {
  /** 문서 오른쪽 위에 떠 있다(모바일) — 문서 위에 겹치므로 불투명 배경·그림자를 단다. */
  floating?: boolean
  high: boolean
  noticeText: string
  scriptsAllowed: boolean
  onToggle: (on: boolean) => void
  security: ReactNode
  /** 묶음 이름(화면낭독기) — 노트 블록은 「블록 스크립트」. */
  label?: string
  /** 있으면 스위치를 끈 채 막고 이 이유를 툴팁·화면낭독기 글로 보인다(공개 공유의 「높음」 블록, WP-1290). */
  disabledReason?: string
}) {
  const disabled = disabledReason != null
  return (
    <div
      role="group"
      aria-label={label}
      title={disabledReason ?? noticeText}
      data-testid="html-script-notice"
      className={cn(
        'flex h-8 shrink-0 items-center rounded-md border text-xs',
        high ? 'border-destructive/50' : 'border-border',
        // 떠 있을 때 위 여백에 노치(안전영역)를 더한다 — 모바일 바를 숨기면 본문 위 여백이 사라져 상태바 밑으로 들어가지 않게.
        floating && 'absolute top-[calc(0.5rem+env(safe-area-inset-top))] right-3 z-10 bg-popover text-popover-foreground shadow-md',
      )}
    >
      {/* 줄을 없앤 대신 안내 문장은 화면낭독기에 남긴다(지금 상태 — 실행 중·높음 이유 포함). */}
      <span className="sr-only">{disabledReason ?? noticeText}</span>
      {security}
      <label
        className={cn(
          'flex h-full items-center gap-1.5 pr-2 pl-2.5',
          scriptsAllowed ? 'text-foreground' : 'text-muted-foreground',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <Code className="size-3.5 shrink-0" aria-hidden />
        <span aria-hidden>스크립트</span>
        <Switch
          size="sm"
          checked={scriptsAllowed}
          onCheckedChange={onToggle}
          disabled={disabled}
          aria-label="스크립트 실행"
          className="ml-0.5"
        />
      </label>
    </div>
  )
}

/** 위험도 점 색 — 칩 배경 대신 점 하나로 위험도를 보인다(묶음이 한 덩어리로 보이게, WP-1282). */
const RISK_DOT_CLASS = { LOW: 'bg-success', CAUTION: 'bg-warning', HIGH: 'bg-destructive' } as const

/** 묶음 왼쪽 조각(점검 상태) — 종류별로 단추·글자·결과를 그리고, 뒤에 스위치와 가르는 세로 선을 둔다. 숨김이면 아무것도 없다. */
export function SecurityChipView({
  chip,
  view,
  onRequest,
  onOpenPanel,
  recheckAlways = false,
}: {
  chip: SecurityChip
  view: SecurityCheckView | undefined
  /** 없으면(공개 공유 — 보는 사람은 점검을 부르지 않는다) 요청·다시 점검 단추를 두지 않는다. */
  onRequest?: () => void
  onOpenPanel?: () => void
  /** 결과가 있어도 ↻(다시 점검)를 늘 둔다(노트 — 블록을 고친 뒤 작성자가 다시 맡긴다, WP-1290). 없으면 지난 기준 결과일 때만. */
  recheckAlways?: boolean
}) {
  const text = chipText(chip)
  // 조각 공통 모양 — 묶음 높이를 꽉 채우고 왼쪽 모서리만 둥글게(묶음 테두리 안쪽).
  const seg = 'flex h-full shrink-0 items-center gap-1.5 rounded-l-[5px] px-2.5'
  const action = cn(seg, 'font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50')
  const divider = <div className="h-4 w-px shrink-0 bg-border" aria-hidden />
  let body: ReactNode
  switch (chip.kind) {
    case 'idle':
      if (!onRequest) return null
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
          {chip.canRetry && onRequest && (
            <button type="button" className={cn(action, 'rounded-none px-1.5 text-muted-foreground')} onClick={onRequest} title="다시 점검" aria-label="다시 점검">
              <RotateCw className="size-3.5" aria-hidden />
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
      // 지난 기준의 결과는 그대로 보이되 새 기준으로 다시 점검할 조각을 결과 옆에 둔다(WP-1283) — 글자 대신 ↻ 아이콘(WP-1290).
      if (onRequest && (chip.outdated || recheckAlways)) {
        body = (
          <>
            {body}
            <button
              type="button"
              className={cn(action, 'rounded-none px-1.5 text-muted-foreground')}
              onClick={onRequest}
              title={chip.outdated ? OUTDATED_NOTE : '다시 점검'}
              aria-label="다시 점검"
            >
              <RotateCw className="size-3.5" aria-hidden />
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


/**
 * 「높음」 스크립트를 켤 때 거치는 확인 창 — 미리보기·노트 블록 공용. 뷰어(다크 라이트박스·AI 시트 위 z-[80]) 위에 떠야 해 z-[100] + 딤은 index.css 표식 규칙.
 * scopeNote 는 어디서만 도는지 알리는 문장(미리보기 「이 미리보기에서만…」, 노트 「이 블록에서만…」).
 */
export function HighRiskScriptConfirm({
  open,
  onOpenChange,
  headline,
  fallbackHeadline,
  scopeNote,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  headline: string | null | undefined
  fallbackHeadline: string
  scopeNote: string
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-security-confirm className="z-[100]">
        <AlertDialogHeader>
          <AlertDialogTitle>위험할 수 있는 스크립트예요</AlertDialogTitle>
          {/* AI 의 한 줄 이유는 마침표가 없을 수 있어 안내 문장과 줄을 나눈다. */}
          <AlertDialogDescription className="space-y-1">
            <span className="block font-medium text-foreground">{headline ?? fallbackHeadline}</span>
            <span className="block">{scopeNote}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            그래도 실행
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
