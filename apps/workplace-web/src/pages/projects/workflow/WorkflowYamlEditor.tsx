import { type Ref, useRef } from 'react'

import { cn } from '@/lib/utils'
import type { WorkflowProblem } from '@/lib/workflows'

const codeClass = 'm-0 px-3 py-2 font-mono text-sm leading-6 whitespace-pre [tab-size:2]'

/** 줄 번호와 밑줄은 입력과 같은 줄 높이를 쓰고 textarea 스크롤에 맞춰 움직인다. */
export function WorkflowYamlEditor({
  yaml, problems, textareaRef, onChange, readOnly,
}: {
  yaml: string
  problems: WorkflowProblem[]
  textareaRef: Ref<HTMLTextAreaElement>
  onChange: (yaml: string) => void
  readOnly: boolean
}) {
  const gutter = useRef<HTMLDivElement>(null)
  const underlineLayer = useRef<HTMLDivElement>(null)
  const lines = yaml.split('\n')
  const severityByLine = new Map<number, WorkflowProblem['severity']>()
  for (const problem of problems) {
    if (severityByLine.get(problem.line) !== 'ERROR') severityByLine.set(problem.line, problem.severity)
  }

  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring/50">
      <div
        ref={gutter}
        aria-hidden="true"
        data-testid="workflow-yaml-gutter"
        className="relative overflow-hidden border-e bg-muted/50 text-end font-mono text-sm text-muted-foreground"
        style={{ width: 'calc(' + String(lines.length).length + 'ch + 1.5rem)' }}
      >
        <div className={cn(codeClass, 'absolute inset-x-0 top-0 pb-8 tabular-nums')}>
          {lines.map((_, index) => <div key={index}>{index + 1}</div>)}
        </div>
      </div>
      <div className="relative min-w-0">
        <div ref={underlineLayer} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <pre className={cn(codeClass, 'min-w-max pb-8 text-transparent')}>
            {lines.map((line, index) => {
              const severity = severityByLine.get(index + 1)
              return (
                <span
                  key={index}
                  data-testid={severity ? 'workflow-yaml-line-' + (index + 1) : undefined}
                  className={cn(
                    'block min-h-6',
                    severity && 'underline decoration-wavy underline-offset-2',
                    severity === 'ERROR' && 'decoration-destructive',
                    severity === 'WARNING' && 'decoration-warning-text',
                  )}
                >
                  {line || '\u00a0'}
                </span>
              )
            })}
          </pre>
        </div>
        <textarea
          ref={textareaRef}
          aria-label="워크플로우 YAML"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          wrap="off"
          rows={16}
          readOnly={readOnly}
          value={yaml}
          onChange={(event) => onChange(event.target.value)}
          onScroll={({ currentTarget }) => {
            if (gutter.current) gutter.current.scrollTop = currentTarget.scrollTop
            if (underlineLayer.current) {
              underlineLayer.current.scrollTop = currentTarget.scrollTop
              underlineLayer.current.scrollLeft = currentTarget.scrollLeft
            }
          }}
          className={cn(codeClass, 'relative block w-full resize-none overflow-auto bg-transparent outline-none')}
        />
      </div>
    </div>
  )
}
