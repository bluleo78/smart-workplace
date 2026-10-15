// MCP 엔드포인트 기대값 (WP-387) — 화면이 보이는 MCP 주소는 빌드 모드에 따라 다르다.
// dev 서버는 로컬 workplace-mcp(6090), preview 서버(운영 빌드)는 접속한 웹 origin 의 /mcp 이다.
export function expectedMcpEndpoint(origin: string): string {
  return process.env.E2E_SERVER === 'preview' ? `${origin}/mcp` : 'http://localhost:6090/mcp';
}
