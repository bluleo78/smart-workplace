// Claude CLI child spawn + stdout JSONL 파싱 + 종료/timeout 처리.
// firehub/apps/firehub-ai-agent/src/agent/agent-cli.ts 패턴 차용.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { log } from '../logger.js';

export interface CliArgsInput {
  userMessage: string;
  systemPrompt: string;
  model: string;
  maxTurns: number;
  mcpConfigPath: string;
  // 6c: 첨부 읽기용 native Read 허용 (chat). true 면 allowed-tools 에 Read 추가 + disallowed 에서 제외.
  allowFileRead?: boolean;
  // 7b: 컴포즈(요청/응답)는 partial 이벤트가 tool_use input 을 조각내므로 false 로 끈다. 기본 true(기존 동작).
  includePartialMessages?: boolean;
  // #333: 라우터 경로에서만 true — 호스트 빌트인 Agent 위임 도구를 허용한다(allowFileRead 와 동형).
  allowSubagents?: boolean;
  // #333: 설정 시 --system-prompt-file <path> 로 전달(ARG_MAX 회피). 미설정이면 인라인 --system-prompt.
  systemPromptPath?: string;
}

// 기본 차단 도구 — Read 는 allowFileRead, Agent 는 allowSubagents 시 제외된다.
const BASE_DISALLOWED = [
  'Bash', 'BashOutput', 'KillShell',
  'Read', 'Write', 'Edit', 'NotebookEdit',
  'Glob', 'Grep',
  'WebFetch', 'WebSearch',
  'Agent',
  'Task', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop', 'TaskUpdate',
  'TodoWrite',
  'Skill', 'ToolSearch',
  // SlashCommand 는 제외: 아래 --disable-slash-commands 로 이미 비활성화되어
  // CLI 의 '알려진 도구'가 아니다. deny 목록에 두면 매칭 실패 경고만 남는다(#457).
  'AskUserQuestion', 'SendUserFile', 'ScheduleWakeup', 'ShareOnboardingGuide',
  'Monitor', 'LSP',
];

export function buildCliArgs(i: CliArgsInput): string[] {
  // allowed-tools: MCP 도구는 항상. Read/Agent 는 각 플래그가 켜질 때만 추가(allow-list 모델).
  const extraAllowed: string[] = [];
  if (i.allowFileRead) extraAllowed.push('Read');
  if (i.allowSubagents) extraAllowed.push('Agent');
  const allowedTools = ['mcp__workplace__*', ...extraAllowed].join(',');
  // disallowed: allowed 로 푼 도구는 제외(둘 다 있으면 disallow 가 이김 → 위임/Read 가 깨짐).
  const disallowed = BASE_DISALLOWED.filter(
    (t) => !(t === 'Read' && i.allowFileRead) && !(t === 'Agent' && i.allowSubagents),
  );
  const includePartial = i.includePartialMessages ?? true;
  const args = ['--print', i.userMessage];
  // 시스템 프롬프트: 경로가 주어지면 파일 플래그(ARG_MAX 회피), 아니면 인라인.
  if (i.systemPromptPath) {
    args.push('--system-prompt-file', i.systemPromptPath);
  } else {
    args.push('--system-prompt', i.systemPrompt);
  }
  args.push(
    '--model', i.model,
    '--max-turns', String(i.maxTurns),
    '--allowed-tools', allowedTools,
    '--disallowed-tools', disallowed.join(','),
    '--mcp-config', i.mcpConfigPath,
    '--output-format', 'stream-json',
    '--verbose',
  );
  if (includePartial) args.push('--include-partial-messages');
  args.push('--strict-mcp-config', '--disable-slash-commands', '--dangerously-skip-permissions');
  return args;
}

// 구독 모드 강제 + 토큰·agentId 명시 주입. INTERNAL_SERVICE_TOKEN 은 parent 그대로
// 전달돼 MCP server child 가 사용한다.
// #376: userId 가 주어지면 ACTING_USER_ID 도 주입 — MCP 서버가 X-On-Behalf-Of 를
// assistantAgentId 아닌 실제 요청자(userId)로 설정해 드라이브 등 사용자 귀속 리소스를 올바르게 접근.
export function buildChildEnv(
  parent: NodeJS.ProcessEnv,
  token: string,
  agentId: number,
  userId?: number,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent };
  delete env.ANTHROPIC_API_KEY;
  env.CLAUDE_CODE_OAUTH_TOKEN = token;
  env.ACTING_AGENT_ID = String(agentId);
  if (userId !== undefined) {
    env.ACTING_USER_ID = String(userId);
  }
  return env;
}

export interface RunCliInput {
  args: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  logTag: string;
  // 6c: chat 은 첨부가 담긴 per-run 임시폴더를 cwd 로 줘서 Read 를 그 폴더로 한정.
  cwd?: string;
  // 요청 단위 추적 ID — 로그 엔트리를 한 요청으로 묶는다. 미지정이면 로그에서 생략.
  requestId?: string;
}

export async function runClaudeCli(i: RunCliInput): Promise<void> {
  return new Promise<void>((resolve) => {
    // cwd: claude CLI 가 cwd 의 CLAUDE.md 를 자동 로드하면 ai-agent 자체 문서가
    // LLM 컨텍스트에 섞여 self-doubt 유발. 중립 디렉터리(tmpdir) 기본.
    const child = spawn('claude', i.args, {
      env: i.env,
      cwd: i.cwd ?? os.tmpdir(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buf = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      console.error(`[${i.logTag}] timeout ${i.timeoutMs}ms, SIGTERM`);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
    }, i.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        handleLine(i.logTag, line);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      console.error(`[${i.logTag}] stderr: ${chunk.toString('utf8').trim()}`);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        console.error(`[${i.logTag}] killed (timeout)`);
      } else if (code !== 0) {
        console.error(`[${i.logTag}] exit ${code}`);
      } else {
        console.log(`[${i.logTag}] done`);
      }
      resolve();
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      console.error(`[${i.logTag}] spawn error:`, e);
      resolve();
    });
  });
}

// 7b: stdout 의 NDJSON 라인을 모아 반환(컴포즈 동기 응답용). 기존 runClaudeCli 와 spawn/timeout 동일.
// 단, 동기·영속 경로라 실패가 빈 결과로 묻히면 안 된다 — spawn-error / non-zero exit / timeout 시
// reject 하여 호출자(run-ai-compose → home.ts)가 실패를 인지하고 502 로 전파하게 한다.
export async function runClaudeCliCollect(i: RunCliInput): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const child = spawn('claude', i.args, {
      env: i.env,
      cwd: i.cwd ?? os.tmpdir(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines: string[] = [];
    let buf = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      console.error(`[${i.logTag}] timeout ${i.timeoutMs}ms, SIGTERM`);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
    }, i.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) lines.push(line);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      console.error(`[${i.logTag}] stderr: ${chunk.toString('utf8').trim()}`);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim()) lines.push(buf.trim()); // 마지막 개행 없는 잔여
      if (killed) {
        // timeout-kill: 부분 결과를 성공으로 오인하지 않도록 reject
        console.error(`[${i.logTag}] killed (timeout)`);
        reject(new Error(`${i.logTag} timeout after ${i.timeoutMs}ms`));
      } else if (code !== 0) {
        // CLI 비정상 종료: 502 로 전파
        console.error(`[${i.logTag}] exit ${code}`);
        reject(new Error(`${i.logTag} exited ${code}`));
      } else {
        console.log(`[${i.logTag}] done (${lines.length} lines)`);
        resolve(lines);
      }
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      // spawn 실패도 502 로 전파
      console.error(`[${i.logTag}] spawn error:`, e);
      reject(e);
    });
  });
}

// Wiki S3(A1): 스트리밍 러너 핸들 — done(종료 Promise) + kill(상위 연결 종료 시 child 종료).
export interface StreamHandle {
  done: Promise<void>;
  kill: () => void;
}

// Wiki S3(A1): runClaudeCliCollect 미러 — 단, 라인을 모으지 않고 즉시 onLine(line) 으로 흘린다.
// 상위(라우트)가 연결 종료 시 kill() 로 child 를 종료할 수 있게 핸들을 반환한다.
// spawn/env/cwd/timeout/실패전파(spawn-error·non-zero·timeout → reject)는 Collect 와 동일하게 유지한다.
export function runClaudeCliStream(
  i: RunCliInput,
  onLine: (line: string) => void,
): StreamHandle {
  let child: ReturnType<typeof spawn> | null = null;
  let manuallyKilled = false;

  const done = new Promise<void>((resolve, reject) => {
    child = spawn('claude', i.args, {
      env: i.env,
      cwd: i.cwd ?? os.tmpdir(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buf = '';
    let killed = false;
    const startedAt = Date.now();

    const timer = setTimeout(() => {
      killed = true;
      console.error(`[${i.logTag}] timeout ${i.timeoutMs}ms, SIGTERM`);
      child?.kill('SIGTERM');
      setTimeout(() => {
        if (child && !child.killed) child.kill('SIGKILL');
      }, 5000);
    }, i.timeoutMs);

    child.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) onLine(line);
      }
    });

    let stderrTail = '';
    child.stderr!.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      stderrTail = (stderrTail + s).slice(-500); // 마지막 500자만 보관(로그 폭주 방지)
      console.error(`[${i.logTag}] stderr: ${s.trim()}`);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim()) onLine(buf.trim()); // 마지막 개행 없는 잔여 라인
      const durationMs = Date.now() - startedAt;
      if (manuallyKilled) {
        // 상위 연결 종료로 인한 의도적 kill — 정상 종료로 간주(에러 발행 안 함).
        console.error(`[${i.logTag}] killed (client closed)`);
        log.info('cli-runner', 'cli_killed', { requestId: i.requestId, durationMs });
        resolve();
      } else if (killed) {
        // timeout-kill: 부분 결과를 성공으로 오인하지 않도록 reject
        console.error(`[${i.logTag}] killed (timeout)`);
        log.error('cli-runner', 'cli_timeout', {
          requestId: i.requestId,
          timeoutMs: i.timeoutMs,
          durationMs,
        });
        reject(new Error(`${i.logTag} timeout after ${i.timeoutMs}ms`));
      } else if (code !== 0) {
        console.error(`[${i.logTag}] exit ${code}`);
        log.error('cli-runner', 'cli_exit', {
          requestId: i.requestId,
          exitCode: code,
          durationMs,
          stderr: stderrTail,
        });
        reject(new Error(`${i.logTag} exited ${code}`));
      } else {
        console.log(`[${i.logTag}] done (stream)`);
        log.info('cli-runner', 'cli_done', { requestId: i.requestId, durationMs });
        resolve();
      }
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      console.error(`[${i.logTag}] spawn error:`, e);
      log.error('cli-runner', 'cli_spawn_error', {
        requestId: i.requestId,
        error: e instanceof Error ? e.message : String(e),
      });
      reject(e);
    });
  });

  // 상위 연결 종료 시 호출 — child 를 종료한다. close 핸들러가 resolve 로 마무리한다.
  const kill = () => {
    manuallyKilled = true;
    child?.kill('SIGTERM');
    setTimeout(() => {
      if (child && !child.killed) child.kill('SIGKILL');
    }, 5000);
  };

  return { done, kill };
}

function handleLine(tag: string, line: string): void {
  try {
    const obj = JSON.parse(line) as { type?: string; subtype?: string };
    if (obj.type === 'system') return;
    if (obj.type === 'assistant') {
      console.log(`[${tag}] assistant message`);
    } else if (obj.type === 'user') {
      console.log(`[${tag}] tool_result`);
    } else if (obj.type === 'result') {
      console.log(`[${tag}] result (${obj.subtype ?? 'ok'})`);
    } else {
      console.log(`[${tag}] line: ${line.slice(0, 200)}`);
    }
  } catch {
    console.log(`[${tag}] non-json: ${line.slice(0, 200)}`);
  }
}
