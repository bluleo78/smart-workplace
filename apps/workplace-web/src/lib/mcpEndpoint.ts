// 원격 MCP 게이트웨이(workplace-mcp) 주소 — Claude Code 연결 명령을 안내하는 화면들이 같은 값을 쓰도록 한곳에 둔다.
// dev 기본값은 로컬 workplace-mcp 포트(6090). 배포 환경에서는 빌드 인자 VITE_MCP_URL 로 재정의한다.
export const MCP_BASE_URL = (import.meta.env['VITE_MCP_URL'] as string | undefined) ?? 'http://localhost:6090';

/** Claude Code 가 접속할 MCP 엔드포인트(Streamable HTTP). */
export const MCP_ENDPOINT = `${MCP_BASE_URL}/mcp`;
