// Claude CLI child spawn + stdout JSONL 파싱 + 종료/timeout 처리.
// firehub/apps/firehub-ai-agent/src/agent/agent-cli.ts 패턴 차용.
import { spawn } from 'node:child_process';

export interface CliArgsInput {
  userMessage: string;
  systemPrompt: string;
  model: string;
  maxTurns: number;
  mcpConfigPath: string;
}

export function buildCliArgs(i: CliArgsInput): string[] {
  return [
    '--print',
    i.userMessage,
    '--system-prompt',
    i.systemPrompt,
    '--model',
    i.model,
    '--max-turns',
    String(i.maxTurns),
    '--allowedTools',
    'mcp__workplace__*',
    '--mcp-config',
    i.mcpConfigPath,
    '--output-format',
    'stream-json',
    '--dangerously-skip-permissions',
  ];
}

// 구독 모드 강제: ANTHROPIC_API_KEY 가 있으면 CLI 가 API key 모드로 빠지므로 제거.
// CLAUDE_CODE_OAUTH_TOKEN 은 parent 에서 그대로 전달 (값이 없으면 CLI 가 부재 에러).
export function buildChildEnv(
  parent: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

export interface RunCliInput {
  args: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  logTag: string;
}

export async function runClaudeCli(i: RunCliInput): Promise<void> {
  return new Promise<void>((resolve) => {
    const child = spawn('claude', i.args, {
      env: i.env,
      stdio: ['pipe', 'pipe', 'pipe'],
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
