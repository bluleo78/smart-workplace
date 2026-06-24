import { Info } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { AiLabel } from './AiLabel'
import { AI_CONTENT_CONTAINER_CLASS } from './aiMarker'

// ② AI 생성물 아우라 컨테이너 — AI가 만든 텍스트(요약/초안/코칭/캐치업 등)를 일반 콘텐츠와 시각 구분.
// collapsible 이면 <details> 로 접힘 지원(메일 요약 기존 동작 보존). reason 있으면 라벨 옆 근거 툴팁.
export function AiContent({
  label,
  reason,
  collapsible = false,
  defaultOpen = true,
  className,
  'data-testid': dataTestId,
  children,
}: {
  label: string
  reason?: string
  collapsible?: boolean
  defaultOpen?: boolean
  className?: string
  'data-testid'?: string
  children: React.ReactNode
}) {
  const box = className
    ? `${AI_CONTENT_CONTAINER_CLASS} ${className}`
    : AI_CONTENT_CONTAINER_CLASS

  const header = (
    <span className="inline-flex items-center gap-1">
      <AiLabel>{label}</AiLabel>
      {reason && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="inline-flex items-center" aria-label="AI 판단 근거"><Info className="h-3 w-3 text-ai-accent" aria-hidden="true" /></button>
          </TooltipTrigger>
          <TooltipContent>{reason}</TooltipContent>
        </Tooltip>
      )}
    </span>
  )

  if (collapsible) {
    return (
      <details open={defaultOpen} className={box} data-testid={dataTestId}>
        <summary className="cursor-pointer list-none">{header}</summary>
        <div className="mt-1 text-sm whitespace-pre-wrap">{children}</div>
      </details>
    )
  }
  return (
    <div className={box} data-testid={dataTestId}>
      <div className="mb-1">{header}</div>
      <div className="text-sm whitespace-pre-wrap">{children}</div>
    </div>
  )
}
