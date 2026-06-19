// MCP config — 매 spawn 직전에 임시 파일로 동적 생성.
// 정적 mcp-config.json 의 ${VAR} 치환을 claude CLI 가 보장 안 해
// (#34 spec 위험 #1 의 fallback 경로) 우리가 직접 값을 박아 넣는다.
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * MCP 도구 서버 실행 커맨드를 dev/prod 자동 감지로 결정한다. (#277)
 *
 * <ul>
 *   <li>prod(dist): 컴파일된 .js 가 있으면 `node <dist>/mcp/workplace-mcp-server.js`
 *   <li>dev(src): 컴파일본이 없으면 `tsx <src>/mcp/workplace-mcp-server.ts` (node 는 .ts 실행 불가)
 * </ul>
 *
 * 과거엔 dist 경로를 무조건 하드코딩해, dev 에서 `tsx watch` 로 소스를 고쳐도 MCP 서버만은
 * stale dist 를 띄웠다 → 메시징/채팅 AI 무응답. 이제 dev 는 tsx 로 항상 라이브 소스를 실행한다.
 *
 * @param hereDir mcp-config 모듈 디렉터리(import.meta.url 기준). dev=src/agent, prod=dist/agent.
 * @param fileExists 존재 확인 함수. 테스트 주입용(기본 existsSync).
 */
export function resolveMcpServerCommand(
  hereDir: string,
  fileExists: (p: string) => boolean = existsSync,
): { command: string; args: string[] } {
  const compiledJs = path.resolve(hereDir, '..', 'mcp', 'workplace-mcp-server.js');
  if (fileExists(compiledJs)) {
    return { command: 'node', args: [compiledJs] };
  }
  const sourceTs = path.resolve(hereDir, '..', 'mcp', 'workplace-mcp-server.ts');
  const tsxBin = path.resolve(hereDir, '..', '..', 'node_modules', '.bin', 'tsx');
  return { command: tsxBin, args: [sourceTs] };
}

// 임시 mcp-config 파일을 생성하고 경로 반환. 호출자가 정리 책임.
export function writeTempMcpConfig(opts: {
  agentId: number;
  baseURL: string;
  internalToken: string;
  profile?: 'issue' | 'chat' | 'home' | 'messaging' | 'assistant';
  pendingActionPath?: string; // #333 M2: propose 핸들러가 제안을 쓸 사이드카 절대경로(cwd 비의존)
  // #376: 요청자 userId — MCP 서버가 X-On-Behalf-Of 를 assistantAgentId 대신 이 값으로 설정해
  // 드라이브·캘린더 등 사용자 귀속 리소스를 올바른 userId 기준으로 접근한다.
  userId?: number;
}): string {
  const { command, args } = resolveMcpServerCommand(here);
  const config = {
    mcpServers: {
      workplace: {
        command,
        args,
        env: {
          WORKPLACE_API_BASE_URL: opts.baseURL,
          INTERNAL_SERVICE_TOKEN: opts.internalToken,
          ACTING_AGENT_ID: String(opts.agentId),
          WORKPLACE_MCP_PROFILE: opts.profile ?? 'issue',
          // 설정 시에만 키 추가(없으면 propose 핸들러가 동작 안 함 — 정상).
          ...(opts.pendingActionPath ? { WORKPLACE_PENDING_ACTION_PATH: opts.pendingActionPath } : {}),
          // #376: userId 가 주어지면 MCP child 에도 ACTING_USER_ID 주입. MCP 서버는 claude CLI 가
          // 별도 child process 로 spawn 하므로 buildChildEnv 만으로는 전달이 안 된다.
          ...(opts.userId !== undefined ? { ACTING_USER_ID: String(opts.userId) } : {}),
        },
      },
    },
  };
  const p = path.join(tmpdir(), `workplace-mcp-config-${randomUUID()}.json`);
  writeFileSync(p, JSON.stringify(config), 'utf8');
  return p;
}

// Wiki S3(A2): 도구 없는(순수 텍스트 생성) 컴포즈용 — 빈 mcpServers 임시 설정.
// buildCliArgs 의 allowedTools(mcp__workplace__*)는 등록된 서버가 없으므로 아무 도구로도 해석되지 않는다.
// --strict-mcp-config 와 함께 도구를 0개로 노출한다. 호출자가 정리 책임.
export function writeEmptyMcpConfig(): string {
  const p = path.join(tmpdir(), `workplace-mcp-config-${randomUUID()}.json`);
  writeFileSync(p, JSON.stringify({ mcpServers: {} }), 'utf8');
  return p;
}

export function cleanupTempMcpConfig(p: string): void {
  try {
    unlinkSync(p);
  } catch {
    // 이미 삭제됐거나 권한 문제 — 무시
  }
}
