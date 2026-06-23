// 진행 신호를 누적해 단계(steps) 목록으로 만든다. 도구명을 한국어 라벨로 매핑.
// add_chat_message/add_channel_message 호출은 "답변 작성"으로 보여 사용자가 마무리 단계를 인지.
import type { ProgressSignal } from './chat-progress-parser.js';

export interface ProgressStep {
  label: string;
  status: 'running' | 'done';
}
export interface ProgressState {
  phase: 'started' | 'tool' | 'done' | 'error';
  steps: ProgressStep[];
}

const TOOL_LABELS: Record<string, string> = {
  get_issue_detail: '이슈 조회',
  search_wiki: '위키 검색',
  get_wiki_page: '위키 문서 읽기',
  get_chat_thread: '대화 내역 확인',
  get_channel_messages: '대화 내역 확인',
  add_chat_message: '답변 작성',
  add_channel_message: '답변 작성',
};

// 답변 게시 도구 — 이 도구 호출이 곧 응답 종료점이므로(system prompt 가 마지막 1회 호출 강제),
// 그 tool_result 는 별도 'tool' progress 를 발행하지 않는다. 답변 메시지(message.created)가
// 프론트의 백스톱으로 유령 버블을 지운 뒤 뒤늦게 도착하는 이 result 이벤트가 버블을 되살리는 것을 차단.
// done 처리는 내부에서 그대로 하므로 직후 emit('done') 의 snapshot 에는 '답변 작성 ✓' 가 담긴다.
const TERMINAL_TOOLS = new Set(['add_chat_message', 'add_channel_message']);

// 내부 스텝 — terminal 플래그는 발행 억제 판단용이라 snapshot 으로는 내보내지 않는다.
interface InternalStep extends ProgressStep {
  terminal?: boolean;
}

export class ProgressTracker {
  private steps: InternalStep[] = [];

  // 신호를 반영. 표시 상태가 변해 전송할 가치가 있으면 true.
  apply(sig: ProgressSignal): boolean {
    if (sig == null || sig.kind === 'result') return false;
    if (sig.kind === 'tool_use') {
      this.steps.push({
        label: TOOL_LABELS[sig.toolName] ?? sig.toolName,
        status: 'running',
        terminal: TERMINAL_TOOLS.has(sig.toolName),
      });
      return true;
    }
    // tool_result — CLI는 어떤 도구의 결과인지 노출하지 않으므로 직전 running 단계를 done 처리(순서 근사).
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].status === 'running') {
        this.steps[i] = { ...this.steps[i], status: 'done' };
        // 종료 도구(답변 게시)의 result 는 발행 생략 — 백스톱 이후 늦게 와 유령 버블을 되살리지 않도록.
        return !this.steps[i].terminal;
      }
    }
    return false;
  }

  snapshot(phase: ProgressState['phase']): ProgressState {
    return { phase, steps: this.steps.map((s) => ({ label: s.label, status: s.status })) };
  }
}
