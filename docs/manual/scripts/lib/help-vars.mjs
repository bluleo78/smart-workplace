// 매뉴얼 도움말 표기에서 쓸 수 있는 자리표시·조건 이름 목록(WP-1504).
// 화면이 넘겨주는 값만 쓸 수 있으므로 목록을 한 곳에 둔다 — PDF 변환(help-markup)·묶음(manual-vars.json)·검사가 같은 목록을 읽어
// 「값이 없을 때 보이는 이름」이 PDF·도움말 패널·MCP 에서 어긋나지 않게 한다. 근거: docs/superpowers/specs/help-panel-design.md 14절.
// 새 자리표시를 더하려면 화면(도움말 패널)이 그 값을 넘겨주는지 먼저 확인하고 여기에 한 줄 더한다.

/**
 * 자리표시 이름 → { display: 값이 없을 때(PDF 등) 「<…>」 안에 보일 이름, description: 무슨 값인지 }.
 */
export const PLACEHOLDERS = {
  'agent.username': { display: 'AI 아이디', description: '그 AI 의 아이디(에이전트 상세)' },
  'app.mcpEndpoint': { display: 'MCP 주소', description: '이 서버의 MCP 주소' },
  'app.origin': { display: '앱 주소', description: '이 앱의 주소(플러그인 마켓플레이스 주소 등에 씀)' },
};

/**
 * 조건 블록 이름 → { tag: PDF 에서 블록 앞에 붙일 꼬리표, description: 언제 보이는 블록인지 }.
 * PDF 는 조건을 판정할 수 없으므로 블록 글을 그대로 보이되 꼬리표로 「누구에게만 해당하는지」를 알린다.
 */
export const CONDITIONS = {
  'app.customMcpServer': {
    tag: '(기본 주소가 아닌 서버만)',
    description: '이 서버의 MCP 주소가 기본 주소가 아닐 때만 보이는 절차',
  },
};

/**
 * 자리표시의 「값 없음」 표시. 목록에 있으면 `<AI 아이디>` 꼴, 없으면 이름을 그대로 `<name>` 으로 —
 * 목록 밖 자리표시는 검사가 오류로 막지만, 렌더가 그 때문에 멈추지는 않게 한다.
 */
export function placeholderLabel(name) {
  return `<${PLACEHOLDERS[name]?.display ?? name}>`;
}
