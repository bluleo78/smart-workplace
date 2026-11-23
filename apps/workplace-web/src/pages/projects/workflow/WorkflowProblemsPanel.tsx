import { AiLabel } from '@/components/ai/AiLabel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WorkflowProblem } from '@/lib/workflows'

/** YAML과 그래프에서 같은 검증 실패 안내를 제공하고 검증을 다시 요청한다. */
export function WorkflowValidationFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      검증 결과를 불러오지 못했습니다.{' '}
      <button type="button" className="underline" onClick={onRetry}>다시 확인</button>
    </>
  )
}

/** 진단과 위치를 함께 보여 주고, 해당 위치로 편집 포커스를 옮긴다. */
export function WorkflowProblemsPanel({
  problems, checking, failed, onSelect, onRetry, onAskFix,
}: {
  problems: WorkflowProblem[]
  checking: boolean
  failed: boolean
  onSelect: (problem: WorkflowProblem) => void
  onRetry: () => void
  onAskFix: () => void
}) {
  return (
    <section aria-label="검증 결과" className="min-w-0 rounded-md border p-3">
      <h3 className="text-sm font-medium">검증 결과</h3>
      <div role="status" className="mt-1 text-sm text-muted-foreground">
        {checking && '검증 중…'}
        {failed && <WorkflowValidationFailure onRetry={onRetry} />}
        {!checking && !failed && problems.length === 0 && '발견된 문제가 없습니다.'}
      </div>
      {problems.length > 0 && (
        <ul className="mt-1 space-y-1">
          {problems.map((problem, index) => (
            <li key={`${problem.code}:${problem.line}:${problem.column}:${index}`}>
              <button
                type="button"
                onClick={() => onSelect(problem)}
                className="flex w-full flex-wrap items-baseline gap-x-2 rounded-sm px-2 py-1 text-start text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={cn('shrink-0 font-medium', problem.severity === 'ERROR' ? 'text-destructive' : 'text-warning-text')}>
                  {problem.severity === 'ERROR' ? '오류' : '경고'}
                </span>
                <span className="shrink-0 text-muted-foreground">{problem.line}행 {problem.column}열</span>
                <span className="[overflow-wrap:anywhere]">{problem.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onAskFix}>
          <AiLabel>AI 에게 고치기 부탁</AiLabel>
        </Button>
      )}
    </section>
  )
}
