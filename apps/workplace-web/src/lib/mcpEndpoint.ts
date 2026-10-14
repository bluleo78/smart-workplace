// 원격 MCP 게이트웨이(workplace-mcp) 주소 — Claude Code 연결 명령을 안내하는 화면들이 같은 값을 쓰도록 한곳에 둔다.

/**
 * MCP 기준 주소를 정한다(WP-387). 우선순위:
 * 1) 명시한 VITE_MCP_URL(빈 문자열이면 없는 것으로 봄 — 빌드 인자를 비워 넘기는 배포가 있다)
 * 2) 개발 모드면 로컬 workplace-mcp 포트(6090)
 * 3) 그 밖(운영 빌드)은 접속한 웹 origin — 운영은 web 과 같은 호스트의 /mcp 로 MCP 가 열려 있다.
 */
export function resolveMcpBaseUrl(opts: { explicit: string | undefined; dev: boolean; origin: string }): string {
  if (opts.explicit) return opts.explicit;
  if (opts.dev) return 'http://localhost:6090';
  return opts.origin;
}

// window 가 없는 환경(node 단위 테스트 등)에서도 import 가 깨지지 않게 origin 을 안전하게 읽는다.
export const MCP_BASE_URL = resolveMcpBaseUrl({
  explicit: import.meta.env['VITE_MCP_URL'] as string | undefined,
  dev: import.meta.env.DEV,
  origin: typeof window !== 'undefined' ? window.location.origin : '',
});

/** Claude Code 가 접속할 MCP 엔드포인트(Streamable HTTP). */
export const MCP_ENDPOINT = `${MCP_BASE_URL}/mcp`;
