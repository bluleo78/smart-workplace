import { TriangleAlert } from 'lucide-react'
import { useRef, useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WorkflowProblem } from '@/lib/workflows'

import { WorkflowValidationFailure } from './WorkflowProblemsPanel'

/** 심각도별 글자 색·라벨 — 목록 줄의 삼항 중복을 한 곳으로 모은다(오류만 ERROR, 나머지는 경고로 본다). */
const SEVERITY_TONE = {
  ERROR: { label: '오류', text: 'text-destructive-text' },
  WARNING: { label: '경고', text: 'text-warning-text' },
} as const

/** 오류·경고 개수를 한 번 순회로 센다(오류만 ERROR, 나머지는 경고로 본다) — 렌더마다 filter 를 되풀이하지 않게 한 곳에서 센다. */
function countProblems(problems: WorkflowProblem[]) {
  let errors = 0
  for (const p of problems) if (p.severity === 'ERROR') errors++
  return { errors, warnings: problems.length - errors }
}

/** 「오류 n · 경고 m」 — 0 인 쪽은 뺀다(단추 글자와 숨긴 알림이 같은 문구). */
function liveLabel({ errors, warnings }: { errors: number; warnings: number }) {
  return [errors > 0 && `오류 ${errors}`, warnings > 0 && `경고 ${warnings}`].filter(Boolean).join(' · ')
}

/** 문제 한 줄의 심각도 라벨·글자 색 */
function tone(p: WorkflowProblem) {
  return p.severity === 'ERROR' ? SEVERITY_TONE.ERROR : SEVERITY_TONE.WARNING
}

/**
 * 워크플로우 탭 머리의 검사 배지 — 오류·경고 개수를 한 단추로 보이고, 누르면 팝오버에 문제 목록과 빠른 조치를 보인다.
 * 문제가 없으면 아무것도 그리지 않는다. 검증 중에도 직전 문제 배지는 그대로 두고 옆에 작은 「검증 중…」을 더한다(팝오버가 사라지지 않게).
 * 검증 요청이 실패했으면 다시 확인 안내를 보인다. readOnly 면(저장 중·로그아웃·충돌) 편집하는 빠른 조치는 꺼진다.
 * 색만으로 구분하지 않도록 단추 글자에 「오류」·「경고」를 적는다.
 */
export function WorkflowProblemsBadge({ problems, checking, failed, stale = false, announce = true, readOnly = false, onRetry, onAddAskPath, onOpenYaml }: {
  problems: WorkflowProblem[]
  checking: boolean
  failed: boolean
  /** 목록이 지난 검사 결과일 때 — 고치기 동작(질문 경로 추가·YAML 오류 확인)을 끈다 */
  stale?: boolean
  /** 스크린리더 알림(role=status)을 이 배지가 맡는지 — YAML 보기는 검증 결과 패널이 알리므로 끈다 */
  announce?: boolean
  /** 초안을 고칠 수 없는 때 — 「질문 경로 추가」를 끈다 */
  readOnly?: boolean
  onRetry: () => void
  onAddAskPath: (nodeKey: string) => void
  onOpenYaml: () => void
}) {
  // 빠른 조치를 누르면 팝오버를 닫는다 — 닫힐 때 포커스가 단추로 돌아가 조치 결과(YAML 편집기 초점)를 덮지 않게 한다
  const [open, setOpen] = useState(false)
  const acted = useRef(false)
  const checkingText = <span role={announce ? 'status' : undefined} className="text-xs text-muted-foreground">검증 중…</span>
  const counts = countProblems(problems)
  const { errors } = counts
  // 단추 글자와 숨긴 알림이 같은 문구 — 계산을 한 곳(liveLabel)에서만 한다
  const label = liveLabel(counts)
  // 숨긴 상태 영역은 어느 분기에서도 같은 자리(첫 자식)에 한 번만 그린다 — 문제가 없을 때도, 실패 동안에도 마운트를 유지해야
  // 첫 오류·실패 뒤 첫 결과 알림이 읽힌다(나중에 생긴 영역은 알리지 않는 스크린리더가 있다)
  const liveRegion = announce ? <span role="status" className="sr-only">{failed || stale ? '' : label}</span> : null
  // 알림을 맡지 않는 보기(YAML)는 검증 결과 패널이 같은 실패 문구를 보이므로 실패 안내를 중복해 그리지 않는다
  if (failed) return <>{liveRegion}{announce && <span className="text-sm text-muted-foreground"><WorkflowValidationFailure onRetry={onRetry} announce /></span>}</>
  if (problems.length === 0) return <>{liveRegion}{checking ? checkingText : null}</>
  // ASK_PATH_MISSING 은 해당 노드에 질문 경로를 더하는 빠른 조치를 준다
  const askProblem = problems.find((p) => p.code === 'ASK_PATH_MISSING' && p.nodeKey)
  return (
    <>
    {liveRegion}
    <Popover open={open} onOpenChange={(next) => { if (next) acted.current = false; setOpen(next) }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`검사 결과 ${label}${stale ? ' (지난 결과)' : ''}`}
          className={cn(errors > 0 ? 'border-destructive/40 bg-destructive-subtle text-destructive-text' : 'border-warning/40 bg-warning-subtle text-warning-text')}
        ><TriangleAlert aria-hidden="true" />{label}</Button>
      </PopoverTrigger>
      <PopoverContent align="start" onCloseAutoFocus={(event) => { if (acted.current) event.preventDefault() }} className="w-96 max-w-[calc(100vw-2rem)] space-y-2 text-sm">
        <ul className="space-y-1">
          {problems.map((problem, index) => (
            <li key={`${problem.code}:${problem.line}:${problem.column}:${index}`} className="flex flex-wrap items-baseline gap-x-2">
              <span className={cn('shrink-0 font-medium', tone(problem).text)}>{tone(problem).label}</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{problem.message}</span>
              {problem.nodeKey && <span className="shrink-0 text-xs text-muted-foreground">({problem.nodeKey})</span>}
            </li>
          ))}
        </ul>
        {(askProblem || errors > 0) && (
          <div className="flex flex-wrap gap-2">
            {askProblem?.nodeKey && (
              <Button type="button" variant="outline" size="sm" disabled={readOnly || stale} onClick={() => { acted.current = true; setOpen(false); onAddAskPath(askProblem.nodeKey!) }}>질문 경로 추가</Button>
            )}
            {errors > 0 && <Button type="button" variant="outline" size="sm" disabled={stale} onClick={() => { acted.current = true; setOpen(false); onOpenYaml() }}>YAML 오류 확인</Button>}
          </div>
        )}
      </PopoverContent>
    </Popover>
    {checking && checkingText}
    </>
  )
}
