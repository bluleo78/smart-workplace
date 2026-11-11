// WP-1489: 메시징(DM·채널) 실행이 답장 도구를 하나도 성공시키지 못한 채 끝났는지 가리고, 그때 대신 올릴 글을 정하는 모듈.
// 모델이 add_channel_message 를 부르지 않고 텍스트만 쓰고 끝내면 그 텍스트가 버려져 사용자는 사라지는 「입력 중」 표시만 보게 된다 — 이를 막는다.
// 판정 입력은 두 러너(Claude SDK·opencode)가 모두 내는 도구 줄(ToolUseLine — RunnerMcpConfig.onTool)이다. 러너 이벤트의 tool_done 은
// 도구 이름·오류 여부가 없어 쓰지 않는다. 시작 줄(tool_use_start)에는 두 러너 모두 인자가 실리고, 결과 줄은 같은 seq 로 짝지어진다.
import { stripMcpPrefix } from '@smart-workplace/mcp-tools-shared';

import {
  PROPOSE_CREATE_EVENT_ALREADY,
  PROPOSE_CREATE_EVENT_OK,
  PROPOSE_CREATE_ISSUE_ALREADY,
  PROPOSE_CREATE_ISSUE_OK,
} from '../mcp/tools.js';
import { segmentText, type RunnerEvent } from './runner-events.js';
import type { ToolUseLine } from './sdk-mcp-server.js';

/** 답장이 남지 않았거나 오류로 끝난 실행에 대신 올리는 안내 문구. */
export const MESSAGING_FALLBACK_NOTICE = '요청을 처리하지 못했습니다. 다시 말씀해 주세요.';

/**
 * 대신 올리는 글의 길이 상한(코드 포인트) — 서버의 채널 메시지 본문 상한(4000자)보다 넉넉히 짧게 자른다.
 * 멘션 변환(@username → 토큰)이 본문을 늘릴 수 있어 여유를 둔다. 넘으면 올리기 자체가 거절돼 다시 아무 답도 남지 않기 때문이다.
 */
export const FALLBACK_MAX_CODE_POINTS = 3500;

/**
 * 도구 결과 문구를 비교할 수 있게 고른다. Claude 어댑터는 핸들러가 돌려준 문자열(summarizeToolResult)을 그대로 싣고,
 * opencode 는 MCP 결과의 text 블록을 이어 붙인 output 을 싣는다. 어느 쪽이든 앞뒤 공백이 붙거나, JSON 문자열('"ok"')·
 * content 블록 배열·{content:[…]} 모양으로 감싸여 와도 안의 텍스트로 풀어 비교한다.
 */
export function normalizeToolResult(raw: string | undefined): string {
  const s = (raw ?? '').trim();
  if (!/^["[{]/.test(s)) return s;
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return s;
  }
  if (typeof parsed === 'string') return parsed.trim();
  const blocks = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { content?: unknown }).content)
      ? ((parsed as { content: unknown[] }).content)
      : null;
  if (!blocks) return s;
  const texts = blocks
    .filter((b): b is { type: 'text'; text: string } => !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string')
    .map((b) => b.text);
  return texts.length ? texts.join('\n').trim() : s;
}

/**
 * 답장 도구별 성공 판정(정규화한 결과 문구 기준). 결과 문구까지 보는 이유:
 * - add_channel_message 는 성공하면 'ok' 를 돌려주고 실패하면 throw(isError)한다. opencode 는 MCP 오류 결과(isError)를 completed 로 싣고
 *   오류 문구를 output 에 넣을 수 있어, isError 만 보면 실패를 성공으로 셀 수 있다 — 'ok' 일 때만 성공이다.
 * - propose_* 는 API 실패·참석자 확인 실패를 throw 하지 않고 안내 문구로 돌려준다(isError 아님) — 성공 문구일 때만 카드가 올라간 것이다.
 */
const REPLY_TOOL_SUCCESS: Record<string, (result: string) => boolean> = {
  add_channel_message: (r) => r === 'ok',
  propose_create_issue: (r) => r.startsWith(PROPOSE_CREATE_ISSUE_OK) || r.startsWith(PROPOSE_CREATE_ISSUE_ALREADY),
  propose_create_event: (r) => r.startsWith(PROPOSE_CREATE_EVENT_OK) || r.startsWith(PROPOSE_CREATE_EVENT_ALREADY),
};

/** 답장 도구 이름(접두 뗀 것)이면 그 이름, 아니면 null. Claude 는 맨 이름, opencode 는 `workplace_` 접두 이름이다. */
function replyToolName(toolName: string): string | null {
  const name = stripMcpPrefix(toolName);
  return name in REPLY_TOOL_SUCCESS ? name : null;
}

/**
 * 한 메시징 실행의 답장 추적기. 러너 이벤트(onEvent)와 도구 줄(onTool)을 받는 대로 반영한다 — 이벤트를 모두 쌓아 두지 않고
 * 결과 성공 여부와 마지막 텍스트 조각만 들고 있다.
 * - replied: 답장 도구가 하나라도 성공했는지. add_channel_message 는 이 실행의 채널(트리거 채널)에 쓴 것만 센다 — 다른 채널에 쓴 글은
 *   요청자에게 답한 것이 아니다. propose_* 는 채널을 코드가 스탬프하므로 늘 이 채널이다.
 * - inFlight: 시작했지만 아직 결과가 오지 않은 답장 도구 호출 수. 러너가 끝난 뒤에도 도구 결과가 늦게 올 수 있어(시간 초과·중단 직후,
 *   opencode 의 completed part 가 세션 종료 뒤 도착) 호출자가 잠깐 기다릴 수 있게 한다.
 */
export class MessagingReplyTracker {
  private repliedFlag = false;
  // seq → 시작 줄의 답장 도구 이름·인자. 결과 줄이 오면 지운다.
  private readonly pending = new Map<number, { name: string; args: Record<string, unknown> | undefined }>();
  private resultOkFlag = false;
  // 마지막 도구 경계(tool_use·tool_done) 뒤의 텍스트 이벤트만 — 조각 텍스트 규칙은 runner-events 의 segmentText 한 곳에 둔다.
  // 경계마다 비우므로 메모리는 현재 조각만큼이다. 앞 조각으로 돌아가지 않는다(진행 서술을 답으로 쓰지 않게).
  private segment: RunnerEvent[] = [];
  private waiters: (() => void)[] = [];

  constructor(private readonly channelId: number) {}

  get replied(): boolean {
    return this.repliedFlag;
  }

  get inFlight(): number {
    return this.pending.size;
  }

  /** result 이벤트가 ok 로 왔는지(없으면 false — 중단·시간 초과). */
  get resultOk(): boolean {
    return this.resultOkFlag;
  }

  /** 도구 줄 하나를 반영한다(두 러너 공통). */
  onTool(line: ToolUseLine): void {
    if (line.event === 'tool_use_start') {
      const name = replyToolName(line.toolName);
      if (name) this.pending.set(line.seq, { name, args: line.args });
      return;
    }
    const started = this.pending.get(line.seq);
    this.pending.delete(line.seq);
    const name = started?.name ?? replyToolName(line.toolName);
    if (name && !line.isError && REPLY_TOOL_SUCCESS[name](normalizeToolResult(line.result)) && this.targetsRunChannel(name, started?.args)) {
      this.repliedFlag = true;
    }
    if (this.pending.size === 0) this.flushWaiters();
  }

  /** 러너 이벤트 하나를 반영한다 — 결과 성공 여부와 마지막 텍스트 조각만 갱신. */
  onEvent(e: RunnerEvent): void {
    switch (e.type) {
      case 'tool_use':
      case 'tool_done':
        // 도구 경계 — 그 앞의 텍스트는 진행 서술(「먼저 조회해 볼게요」)이라 답이 아니다.
        this.segment = [];
        return;
      case 'text_delta':
      case 'assistant_text':
        this.segment.push(e);
        return;
      case 'result':
        this.resultOkFlag = e.ok;
        return;
      default:
        return;
    }
  }

  /** 마지막 도구 호출 뒤의 모델 텍스트(없으면 빈 문자열). */
  finalText(): string {
    return segmentText(this.segment);
  }

  /** 진행 중인 답장 도구 호출이 모두 끝날 때까지 최대 ms 기다린다. 끝나면 true, 시간이 다 되면 false. */
  waitForInFlight(ms: number): Promise<boolean> {
    if (this.pending.size === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done);
        resolve(false);
      }, ms);
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.waiters.push(done);
    });
  }

  private flushWaiters(): void {
    const ws = this.waiters;
    this.waiters = [];
    ws.forEach((w) => w());
  }

  // add_channel_message 는 이 실행의 채널에 쓴 것만 답장으로 센다. 인자를 모르면(시작 줄 없음) 세지 않는다 — 다른 채널일 수 있다.
  private targetsRunChannel(name: string, args: Record<string, unknown> | undefined): boolean {
    if (name !== 'add_channel_message') return true;
    return args != null && Number(args.channelId) === this.channelId;
  }
}

/**
 * 답장 없이 끝난 실행에 대신 올릴 글. 정상 종료면 마지막 도구 호출 뒤의 모델 텍스트(없으면 안내 — 그 앞의 진행 서술은 쓰지 않는다),
 * 오류 종료면 늘 안내다 — 오류 실행의 텍스트는 제공자 오류 문구일 수 있어(WP-1347) 사용자 답으로 쓰지 않는다.
 */
export function fallbackReplyText(outcome: 'ok' | 'error', finalText: string): string {
  if (outcome === 'error') return MESSAGING_FALLBACK_NOTICE;
  const text = finalText.trim();
  if (!text) return MESSAGING_FALLBACK_NOTICE;
  // 코드 포인트 단위로 자른다 — UTF-16 단위로 자르면 서로게이트 쌍(이모지 등)이 반으로 갈린다.
  const cps = Array.from(text);
  return cps.length > FALLBACK_MAX_CODE_POINTS ? `${cps.slice(0, FALLBACK_MAX_CODE_POINTS).join('')}…` : text;
}
