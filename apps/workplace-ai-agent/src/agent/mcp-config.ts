// MCP config 파일 경로 — Claude CLI 에 --mcp-config 로 전달.
// 정적 파일을 프로젝트 루트에 두고 child env 가 ${VAR} 치환을 담당한다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// dist/agent/mcp-config.js 기준 → 프로젝트 루트(apps/workplace-ai-agent)
// 의 mcp-config.json 절대 경로.
export const MCP_CONFIG_PATH = path.resolve(here, '..', '..', 'mcp-config.json');
