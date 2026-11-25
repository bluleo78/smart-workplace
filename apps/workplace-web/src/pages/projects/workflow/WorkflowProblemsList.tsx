import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WorkflowProblem } from '@/lib/workflows'

import { WorkflowValidationFailure } from './WorkflowProblemsPanel'

/** 심각도별 글자 색·라벨 — 오류만 ERROR, 나머지는 경고로 본다. */
const SEVERITY_TONE = {
  ERROR: { label: '오류', text: 'text-destructive-text' },
  WARNING: { label: '경고', text: 'text-warning-text' },
} as const

/**
 * 검사 결과 목록 + 빠른 고침(「질문 경로 추가」「YAML 오류 확인」) — 배지 팝오버와 개요 서랍이 같이 쓴다(WP-2091).
 * onSelect 가 있으면 각 행이 단추(접근 이름 = 행 글자)로 그려져 해당 노드로 이동할 수 있고, 없으면 글자만 보인다.
 * 실패면 다시 확인 안내를, 문제가 없으면 검증 중/문제 없음 문구를 보인다(문제가 있을 땐 검증 중 문구를 배지가 따로 그린다).
 * readOnly 면 편집하는 빠른 조치를, stale 이면 두 조치를 끈다.
 */
export function WorkflowProblemsList({ problems, checking, failed, stale, readOnly, announce = true, onRetry, onAddAskPath, onOpenYaml, onSelect }: {
  problems: WorkflowProblem[]
  checking: boolean
  failed: boolean
  stale: boolean
  readOnly: boolean
  /** 실패 안내를 role=status 로 알릴지 — 헤더 배지가 이미 알리는 개요 서랍은 끈다(스크린리더가 두 번 읽지 않게) */
  announce?: boolean
  onRetry: () => void
  onAddAskPath: (nodeKey: string) => void
  onOpenYaml: () => void
  onSelect?: (problem: WorkflowProblem) => void
}) {
  if (failed) return <div className="text-sm text-muted-foreground"><WorkflowValidationFailure onRetry={onRetry} announce={announce} /></div>
  if (problems.length === 0) return <p className="text-sm text-muted-foreground">{checking ? '검증 중…' : '문제가 없습니다.'}</p>
  const errors = problems.filter((p) => p.severity === 'ERROR').length
  // ASK_PATH_MISSING 은 해당 노드에 질문 경로를 더하는 빠른 조치를 준다
  const askProblem = problems.find((p) => p.code === 'ASK_PATH_MISSING' && p.nodeKey)
  return (
    <div className="space-y-2 text-sm">
      <ul className="space-y-1">
        {problems.map((problem, index) => {
          const tone = SEVERITY_TONE[problem.severity]
          const row = (
            <>
              <span className={cn('shrink-0 font-medium', tone.text)}>{tone.label}</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{problem.message}</span>
              {problem.nodeKey && <span className="shrink-0 text-xs text-muted-foreground">({problem.nodeKey})</span>}
            </>
          )
          return (
            <li key={`${problem.code}:${problem.line}:${problem.column}:${index}`}>
              {onSelect
                ? <button type="button" onClick={() => onSelect(problem)} className="flex w-full flex-wrap items-baseline gap-x-2 rounded-sm text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">{row}</button>
                : <div className="flex flex-wrap items-baseline gap-x-2">{row}</div>}
            </li>
          )
        })}
      </ul>
      {(askProblem || errors > 0) && (
        <div className="flex flex-wrap gap-2">
          {askProblem?.nodeKey && (
            <Button type="button" variant="outline" size="sm" disabled={readOnly || stale} onClick={() => onAddAskPath(askProblem.nodeKey!)}>질문 경로 추가</Button>
          )}
          {errors > 0 && <Button type="button" variant="outline" size="sm" disabled={stale} onClick={onOpenYaml}>YAML 오류 확인</Button>}
        </div>
      )}
    </div>
  )
}
