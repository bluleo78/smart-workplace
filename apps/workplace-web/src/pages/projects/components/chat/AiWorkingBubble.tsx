// AI 작업 중 유령 버블 — AI 에이전트가 응답을 생성하는 동안 진행 단계(도구 호출)를
// 좌측 말풍선에 표시한다. 완성 메시지가 SSE 로 도착하면 부모가 이 컴포넌트를 제거한다.

interface Step {
  label: string;
  status: 'running' | 'done';
}

interface AiWorkingBubbleProps {
  /** AI 에이전트 이름 — 말풍선 헤더에 표시 */
  agentName: string;
  /** 진행 중인 도구 호출 단계 목록 */
  steps: Step[];
}

export function AiWorkingBubble({ agentName, steps }: AiWorkingBubbleProps) {
  return (
    <li className="flex justify-start" data-testid="ai-working-bubble">
      <div className="max-w-[80%] rounded-2xl bg-muted px-3 py-2.5 text-sm">
        {/* 바운싱 점 3개 + "입력 중…" 텍스트 — 타이핑 시그널 */}
        <div
          className="mb-1 flex items-center gap-1 text-muted-foreground"
          role="status"
          aria-label={`${agentName} 작업 중`}
        >
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
          <span className="ml-1 text-xs">{agentName} 입력 중…</span>
        </div>
        {/* 도구 호출 단계 목록 — steps 가 있을 때만 렌더 */}
        {steps.length > 0 && (
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <span>{s.status === 'done' ? '✓' : '●'}</span>
                <span>{s.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
