// 「Claude 앱에 연결」 블록 — 토큰 없이 OAuth 로 Claude 앱(데스크톱·웹)에 연결하는 커넥터 주소를 복사하게 한다(WP-1687).
// 주소가 MCP_ENDPOINT 인 까닭: 보호 리소스 메타데이터의 resource 가 요청의 공개 원점 기준이라 어느 배포에서든 늘 같은 주소다
//   (설계 3절) — 그래서 따로 주소를 만들지 않고 「다른 도구」 안내와 같은 상수를 쓴다.
// 토큰 화면(TokenConnectGuide showClaudeApp)에서만 보인다 — 발급 결과 창은 토큰을 막 발급한 사람에게 토큰 없는 연결을 섞지 않으려 쓰지 않는다.

import { CopyableCommand } from '@/components/CopyableCommand';
import { MCP_ENDPOINT } from '@/lib/mcpEndpoint';

export function ClaudeAppConnect({ testIdPrefix: p }: { testIdPrefix: string }) {
  return (
    <div className="space-y-1.5 border-t pt-3" data-help="tokens.claude-app" data-testid={`${p}-claude-app`}>
      <p className="text-sm font-medium">Claude 앱에 연결</p>
      <p className="text-xs text-muted-foreground">
        Claude 앱(데스크톱·웹)의 커넥터 추가 화면에 아래 주소를 넣으세요. 토큰은 필요 없어요 — 로그인한 뒤 동의 화면에서 워크스페이스를 고르고
        허용하면 연결됩니다.
      </p>
      <CopyableCommand command={MCP_ENDPOINT} label="커넥터 주소" testId={`${p}-claude-app-url`} />
      {/* 연결이 없으면 「연결된 앱」 절이 숨으므로 「위」라고 가리키지 않는다 — 늘 보여도 맞는 말로 쓴다. */}
      <p className="text-xs text-muted-foreground">연결하면 이 화면의 「연결된 앱」에서 보고 끊을 수 있어요.</p>
    </div>
  );
}
