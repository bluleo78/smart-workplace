// Task9: RunnerInput → opencode Config 빌더. opencode 는 별도 프로세스(opencode CLI)로 스폰되며
// createOpencode({config}) 가 OPENCODE_CONFIG_CONTENT 환경변수(JSON)로 config 전체를 그 프로세스에
// 주입한다(비밀 포함 — 우리 자신의 process.env 에는 아무 것도 심지 않는다).
// 실제 타입은 node_modules/@opencode-ai/sdk 의 gen/types.gen.d.ts 기준(Config/AgentConfig/McpLocalConfig).
import type { Config as OpencodeConfig, AgentConfig as OpencodeAgentConfig } from '@opencode-ai/sdk';

import { DEFAULT_API_BASE_URL, DEFAULT_PORT } from '../constants.js';
import type { RunnerInput } from './agent-runner.js';
import { loadSubagents, type SubagentDefinition } from './subagent-loader.js';

// opencode 모델 표기 'providerId/modelId' 를 첫 '/' 기준으로 분해. 이 프로젝트의 opencode 모델
// 저장 규약(Task 1-3 DB 설계)은 항상 이 형식이므로, 없으면 설정 오류로 간주해 명확히 throw 한다.
export function splitOpencodeModel(model: string): { providerID: string; modelID: string } {
  const idx = model.indexOf('/');
  if (idx < 0) {
    throw new Error(`opencode 모델은 'providerId/modelId' 형식이어야 합니다(받은 값: ${model})`);
  }
  return { providerID: model.slice(0, idx), modelID: model.slice(idx + 1) };
}

// dev(tsx, src/*.ts 실행) 인지 build(dist/*.js 실행) 인지 판별. 이 모듈이 .ts 로 로드되면 dev,
// 컴파일된 .js 로 로드되면 build 로 간주 — import.meta.url 확장자 기반의 실용적 판별(기존 패턴 부재).
export function isDev(): boolean {
  return import.meta.url.endsWith('.ts');
}

// opencode 러너가 stdio MCP 자식 프로세스로 spawn 할 커맨드. dev 는 tsx 로 소스(.ts) 직접 실행,
// build 는 컴파일된 dist/mcp/stdio-entry.js 를 현재 node 실행파일로 실행.
export function resolveStdioEntryCmd(): string[] {
  if (isDev()) {
    // 이 파일: <root>/src/agent/opencode-config.ts → 형제 mcp/stdio-entry.ts
    const entry = new URL('../mcp/stdio-entry.ts', import.meta.url).pathname;
    return ['npx', 'tsx', entry];
  }
  // 빌드 산출물: dist/agent/opencode-config.js → dist/mcp/stdio-entry.js
  const entry = new URL('../mcp/stdio-entry.js', import.meta.url).pathname;
  return [process.execPath, entry];
}

// stdio MCP 자식 프로세스에 전달할 환경변수. stdio-entry.ts 의 parseConfigFromEnv 가 요구하는
// 키를 정확히 채운다(WORKPLACE_API_BASE_URL/INTERNAL_SERVICE_TOKEN/MCP_PROFILE/MCP_ON_BEHALF_OF/
// MCP_THREAD_BINDING/MCP_DELEGATION_CONTEXT/MCP_BRIDGE_URL/MCP_BRIDGE_RUN_ID).
// baseURL/internalToken 은 RunnerMcpConfig 에 없으므로(client 뒤에 캡슐화) 메인 프로세스 자신의
// 부트스트랩 env(index.ts 가 이미 필수 검증)를 그대로 재사용한다 — 자식도 같은 workplace-api 를 호출.
function buildMcpEnvironment(i: RunnerInput, runId: string): Record<string, string> {
  const mcp = i.mcp;
  if (!mcp) return {};
  const env: Record<string, string> = {
    WORKPLACE_API_BASE_URL: process.env.WORKPLACE_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN ?? '',
    MCP_PROFILE: mcp.profile,
    MCP_ON_BEHALF_OF: String(mcp.onBehalfOfId),
  };
  if (mcp.threadBinding) env.MCP_THREAD_BINDING = JSON.stringify(mcp.threadBinding);
  if (mcp.delegationContext) env.MCP_DELEGATION_CONTEXT = JSON.stringify(mcp.delegationContext);
  // hostBridge(propose/submit/unassign 콜백) 또는 onTool(도구 호출 로깅) 이 필요하면 브리지 좌표를
  // 심는다. 실제 등록(registerBridge)은 러너가 수행 — 이 함수는 순수 config 조립만 담당.
  if (mcp.hostBridge || mcp.onTool) {
    const port = process.env.PORT ?? String(DEFAULT_PORT);
    env.MCP_BRIDGE_URL = `http://localhost:${port}/internal/bridge`;
    env.MCP_BRIDGE_RUN_ID = runId;
  }
  return env;
}

// SubagentDefinition → opencode AgentConfig(mode:'subagent'). model 미지정 = primary 상속.
// tools 는 workplace MCP 도구만 허용(빌트인 bash/edit/write/read 차단) — primary 와 동일 정책.
export function toOpencodeSubagents(defs: Record<string, SubagentDefinition>): Record<string, OpencodeAgentConfig> {
  const out: Record<string, OpencodeAgentConfig> = {};
  for (const [name, d] of Object.entries(defs)) {
    const cfg: OpencodeAgentConfig = {
      mode: 'subagent',
      description: d.description,
      prompt: d.prompt,
      tools: { '*': false, 'workplace*': true },
    };
    if (typeof d.maxTurns === 'number') cfg.maxSteps = d.maxTurns;
    out[name] = cfg;
  }
  return out;
}

// RunnerInput → opencode Config. i.credential 은 반드시 opencode credential 이어야 한다
// (호출부는 OpencodeRunner 뿐이지만, credential 오분기를 조기에 잡기 위해 방어적으로 재확인).
export function buildOpencodeConfig(i: RunnerInput, runId: string, stdioEntryCmd: string[]): OpencodeConfig {
  if (i.credential.provider !== 'opencode') {
    throw new Error('buildOpencodeConfig 는 opencode credential 만 지원합니다');
  }
  const { payload } = i.credential;
  const { providerID, modelID } = splitOpencodeModel(i.model);

  const config: OpencodeConfig = {
    provider: {
      [payload.providerId]: {
        npm: payload.npm ?? '@ai-sdk/openai-compatible',
        options: payload.options,
        models: { [modelID]: {} },
      },
    },
    agent: {
      primary: {
        mode: 'primary',
        prompt: i.systemPrompt,
        maxSteps: i.maxTurns,
        // MCP-only: opencode 빌트인 도구(bash/edit/write/read 등)는 전부 차단하고 workplace MCP
        // 도구만 허용. 이름은 stdio-entry 서버명 'workplace' 접두 네임스페이스와 일치.
        tools: { '*': false, 'workplace*': true },
        permission: { edit: 'deny', bash: 'deny', webfetch: 'deny' },
      },
      ...(i.allowSubagents ? toOpencodeSubagents(loadSubagents()) : {}),
    },
    mcp: i.mcp
      ? {
          workplace: {
            type: 'local',
            command: stdioEntryCmd,
            environment: buildMcpEnvironment(i, runId),
          },
        }
      : {},
  };
  // 진단용 옵트인 — WORKPLACE_OPENCODE_DEBUG=1 이면 opencode CLI 를 --log-level=debug 로 띄워
  // ~/.local/share/opencode/log/opencode.log 에 상세 로그를 남긴다(콘솔에는 요약 메시지만 나가므로
  // "Unexpected error" 류의 opencode 자체 크래시를 조사할 때 유용). 기본은 off(로그 폭증 방지).
  if (process.env.WORKPLACE_OPENCODE_DEBUG === '1') {
    config.logLevel = 'DEBUG';
  }
  // providerID 는 splitOpencodeModel 검증용으로만 쓰이고(모델 registration 은 payload.providerId
  // 기준 — 둘이 다르면 opencode 가 provider 미스매치로 실패하므로 방어적으로 확인).
  if (providerID !== payload.providerId) {
    throw new Error(
      `opencode 모델의 providerID(${providerID}) 가 credential.payload.providerId(${payload.providerId}) 와 다릅니다`,
    );
  }
  return config;
}
