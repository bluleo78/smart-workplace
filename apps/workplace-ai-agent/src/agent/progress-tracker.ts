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

export class ProgressTracker {
  private steps: ProgressStep[] = [];

  // 신호를 반영. 표시 상태가 변해 전송할 가치가 있으면 true.
  apply(sig: ProgressSignal): boolean {
    if (sig == null || sig.kind === 'result') return false;
    if (sig.kind === 'tool_use') {
      this.steps.push({ label: TOOL_LABELS[sig.toolName] ?? sig.toolName, status: 'running' });
      return true;
    }
    // tool_result — CLI는 어떤 도구의 결과인지 노출하지 않으므로 직전 running 단계를 done 처리(순서 근사).
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].status === 'running') {
        this.steps[i] = { ...this.steps[i], status: 'done' };
        return true;
      }
    }
    return false;
  }

  snapshot(phase: ProgressState['phase']): ProgressState {
    return { phase, steps: this.steps.map((s) => ({ ...s })) };
  }
}
