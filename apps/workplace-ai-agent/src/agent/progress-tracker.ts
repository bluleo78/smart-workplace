// 진행 신호를 누적해 단계(steps) 목록으로 만든다. 도구명을 한국어 라벨로 매핑.
// add_chat_message/add_channel_message 호출은 "답변 작성"으로 보여 사용자가 마무리 단계를 인지.
import { TOOL_LABELS } from '@smart-workplace/mcp-tools-shared';

import type { ProgressSignal } from './chat-progress-parser.js';

export interface ProgressStep {
  label: string;
  status: 'running' | 'done';
}
export interface ProgressState {
  phase: 'started' | 'tool' | 'done' | 'error';
  steps: ProgressStep[];
}

// 답변 게시 도구 — 이 도구 호출이 곧 응답 종료점이므로(system prompt 가 마지막 1회 호출 강제),
// 그 tool_result 는 별도 'tool' progress 를 발행하지 않는다. 답변 메시지(message.created)가
// 프론트의 백스톱으로 유령 버블을 지운 뒤 뒤늦게 도착하는 이 result 이벤트가 버블을 되살리는 것을 차단.
// done 처리는 내부에서 그대로 하므로 직후 emit('done') 의 snapshot 에는 '답변 작성 ✓' 가 담긴다.
const TERMINAL_TOOLS = new Set(['add_chat_message', 'add_channel_message']);

// 라벨은 AI 채팅과 같은 공유 맵(#879) — 별도 맵을 두면 새 도구가 영어 이름으로 새어 나온다.
// 답변 게시 도구만 이 화면 전용 문구로 덮는다(채팅방에선 "메시지 작성"보다 "답변 작성"이 마무리 단계로 읽힌다).
const labelOf = (toolName: string): string =>
  TERMINAL_TOOLS.has(toolName) ? '답변 작성' : (TOOL_LABELS[toolName]?.label ?? toolName);

// 내부 스텝 — terminal 플래그는 발행 억제 판단용이라 snapshot 으로는 내보내지 않는다.
interface InternalStep extends ProgressStep {
  terminal?: boolean;
}

/** 한 진행 알림에 싣는 최근 단계 수 — api 상한(100, AiProgressStep.MAX_STEPS)보다 넉넉히 작게. */
export const MAX_SNAPSHOT_STEPS = 50;

export class ProgressTracker {
  private steps: InternalStep[] = [];

  // 신호를 반영. 표시 상태가 변해 전송할 가치가 있으면 true.
  apply(sig: ProgressSignal): boolean {
    if (sig == null || sig.kind === 'result') return false;
    if (sig.kind === 'tool_use') {
      this.steps.push({
        label: labelOf(sig.toolName),
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

  // 보내는 단계는 최근 MAX_SNAPSHOT_STEPS 개까지 — api 가 한 알림의 단계 수를 100개로 묶는다(WP-1191). 넘겨 400 이 나면
  // 그 뒤 진행 알림(마지막 done·error 포함)이 모두 거절돼 「AI 작업 중」 말풍선이 멈춘 채 남는다.
  snapshot(phase: ProgressState['phase']): ProgressState {
    return {
      phase,
      steps: this.steps.slice(-MAX_SNAPSHOT_STEPS).map((s) => ({ label: s.label, status: s.status })),
    };
  }
}
