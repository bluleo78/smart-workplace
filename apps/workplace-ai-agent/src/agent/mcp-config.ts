// MCP config — 매 spawn 직전에 임시 파일로 동적 생성.
// 정적 mcp-config.json 의 ${VAR} 치환을 claude CLI 가 보장 안 해
// (#34 spec 위험 #1 의 fallback 경로) 우리가 직접 값을 박아 넣는다.
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// dev (tsx): here = src/agent → ../../ = ai-agent root
// prod (node): here = dist/agent → ../../ = ai-agent root
// 두 경우 모두 ai-agent/dist/mcp/workplace-mcp-server.js 를 가리킨다 (dev 도 사전 빌드 필요).
const MCP_SERVER_JS = path.resolve(
  here,
  '..',
  '..',
  'dist',
  'mcp',
  'workplace-mcp-server.js',
);

// 임시 mcp-config 파일을 생성하고 경로 반환. 호출자가 정리 책임.
export function writeTempMcpConfig(opts: {
  agentId: number;
  baseURL: string;
  internalToken: string;
  profile?: 'issue' | 'chat' | 'home' | 'messaging';
}): string {
  const config = {
    mcpServers: {
      workplace: {
        command: 'node',
        args: [MCP_SERVER_JS],
        env: {
          WORKPLACE_API_BASE_URL: opts.baseURL,
          INTERNAL_SERVICE_TOKEN: opts.internalToken,
          ACTING_AGENT_ID: String(opts.agentId),
          WORKPLACE_MCP_PROFILE: opts.profile ?? 'issue',
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
