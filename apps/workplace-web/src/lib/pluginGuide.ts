// genia-works Claude Code 플러그인 설치·사용 안내 명령 — 설정 › API 토큰, 관리자 › 에이전트 화면이 같은 문구를 쓴다(WP-378).
// 토큰·키는 명령에 넣지 않는다(셸 기록에 남음). 키는 Claude Code 안의 로그인 화면에만 붙여 넣는다.

/** 플러그인 명령 표기 — plugins/genia-works/hooks/lib.js 의 COMMANDS 와 같아야 한다. */
export const PLUGIN_COMMANDS = {
  login: '/genia-works:login',
  as: '/genia-works:as',
  logout: '/genia-works:logout',
} as const;

/** 웹이 정적으로 내주는 마켓플레이스 목록 파일 주소(nginx location = /claude/marketplace.json). */
export function marketplaceUrl(origin: string = window.location.origin): string {
  return `${origin}/claude/marketplace.json`;
}

/** Claude Code 안에서 실행하는 설치 명령 두 줄. */
export function buildPluginInstallCommands(origin?: string): string {
  return [`/plugin marketplace add ${marketplaceUrl(origin)}`, '/plugin install genia-works@genia-works'].join('\n');
}

/** 지금 세션을 그 AI 로 바꾸는 명령. */
export function buildSwitchCommand(username: string): string {
  return `${PLUGIN_COMMANDS.as} ${username}`;
}

/** 처음부터 그 AI 로 띄우는 명령 — 환경변수에는 이름만 있어 비밀이 아니다. */
export function buildLaunchAsCommand(username: string): string {
  return `GENIA_WORKS_AS=${username} claude`;
}

/** 플러그인 전환을 쓸 수 없는 환경(Windows 등)의 대체 실행 — 키 자리는 비워 둔다. */
export function buildTokenFallbackCommand(): string {
  return 'GENIA_WORKS_TOKEN=<발급한 키> claude';
}

/**
 * 플러그인 userConfig `server_url` 의 기본값 — plugins/genia-works/.claude-plugin/plugin.json 의
 * userConfig.server_url.default 와 같아야 한다(pluginGuide.test.ts 가 두 값을 대조한다).
 */
export const PLUGIN_DEFAULT_SERVER_URL = 'https://genia-works.iacloud.kr/mcp';

/**
 * 이 배포의 MCP 주소가 플러그인 기본 주소와 다른지 — 다르면(로컬·스테이징·compose 등) 설치한 사람이
 * 서버 주소를 바꿔야 한다. 안 바꾸면 운영 서버에 다른 환경의 토큰으로 접속하게 된다. 끝의 '/' 는 무시한다.
 */
export function needsServerUrlSetting(endpoint: string): boolean {
  return endpoint.replace(/\/+$/, '') !== PLUGIN_DEFAULT_SERVER_URL;
}
