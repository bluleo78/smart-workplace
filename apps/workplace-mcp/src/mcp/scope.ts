// src/mcp/scope.ts — 연결 범위(WP-350): 어떤 앱의 도구를 싣고, 읽기 전용인지.
// Claude.ai·ChatGPT 는 연결한 서버의 도구 정의를 전부 싣는다(토큰·도구 선택 정확도 부담) — 그래서 URL 경로나 헤더로 범위를 좁힐 수 있게 한다.
//   POST /mcp                      전체(기존 연결 그대로)
//   POST /mcp/readonly             읽기(kind=read) 도구만
//   POST /mcp/x/{apps}             쉼표로 고른 앱의 도구만            예: /mcp/x/issue,wiki
//   POST /mcp/x/{apps}/readonly    앱 선택 + 읽기 전용
//   X-MCP-Toolsets: issue,wiki     경로에 앱 선택이 없을 때 같은 의미(경로가 있으면 경로 우선)
import { isToolApp, TOOL_APPS, type ToolApp } from '@smart-workplace/mcp-tools-shared';

/** 연결 범위. apps 가 null 이면 앱 제한 없음(전체). */
export interface McpScope {
  apps: ToolApp[] | null;
  readOnly: boolean;
}

/** 기본 `/mcp` 의 범위 — 지금까지와 똑같이 전부 노출한다. */
export const FULL_SCOPE: McpScope = { apps: null, readOnly: false };

/** 라우트가 알려 주는 원시 범위 — 경로의 앱 목록 문자열(없으면 undefined)과 읽기 전용 여부. */
export interface McpRoute {
  pathApps?: string;
  readOnly: boolean;
}

/** 앱 이름이 잘못되었을 때 — HTTP 400 으로 바꿔 사용 가능한 목록과 함께 돌려준다. */
export class InvalidScopeError extends Error {
  constructor(
    message: string,
    readonly available: readonly string[] = TOOL_APPS,
  ) {
    super(message);
  }
}

/**
 * 쉼표로 이은 앱 이름을 검증된 앱 목록으로 바꾼다. 공백·대소문자는 무시하고 중복은 하나로 합친다.
 * 모르는 이름이 하나라도 있거나 하나도 없으면 InvalidScopeError(전부 거절 — 일부만 로드하면 모델이 없는 도구를 찾게 된다).
 */
export function parseApps(raw: string, source: string): ToolApp[] {
  const names = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (names.length === 0) {
    throw new InvalidScopeError(`${source}: 앱 이름이 비어 있습니다. 사용 가능한 앱: ${TOOL_APPS.join(', ')}`);
  }
  const unknown = names.filter((n) => !isToolApp(n));
  if (unknown.length > 0) {
    throw new InvalidScopeError(`${source}: 알 수 없는 앱 ${unknown.map((n) => `'${n}'`).join(', ')}. 사용 가능한 앱: ${TOOL_APPS.join(', ')}`);
  }
  return [...new Set(names as ToolApp[])];
}

/**
 * 경로·헤더에서 연결 범위를 정한다. 우선순위: 경로의 앱 선택 > X-MCP-Toolsets 헤더 > 전체.
 * 경로를 우선하는 이유: 경로는 사용자가 연결 URL 로 명시한 값이고, 헤더는 URL 을 바꿀 수 없는 클라이언트를 위한 대체 수단이다
 * (둘이 다르면 합치지 않고 경로만 쓴다). 읽기 전용은 경로(`/readonly`)로만 정한다 — 헤더 앱 선택과는 함께 쓸 수 있다.
 * 헤더 값이 비어 있으면 없는 것으로 본다(프록시가 빈 헤더를 붙이는 경우 전체로 열리게).
 */
export function resolveScope(route: McpRoute, header: string | string[] | undefined): McpScope {
  if (route.pathApps !== undefined) {
    return { apps: parseApps(route.pathApps, '경로'), readOnly: route.readOnly };
  }
  const headerValue = Array.isArray(header) ? header.join(',') : header;
  if (headerValue !== undefined && headerValue.trim() !== '') {
    return { apps: parseApps(headerValue, 'X-MCP-Toolsets 헤더'), readOnly: route.readOnly };
  }
  return { apps: null, readOnly: route.readOnly };
}
