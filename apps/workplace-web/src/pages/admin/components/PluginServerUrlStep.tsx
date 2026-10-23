// 플러그인 서버 주소 바꾸기 안내 — 기본 주소(운영)가 아닌 배포에서만 보인다(WP-378).
// 이런 배포에서 설치한 사람이 서버 주소를 그대로 두면 운영 서버에 다른 환경의 토큰·키로 접속하게 된다.

import { MCP_ENDPOINT } from '@/lib/mcpEndpoint';
import { needsServerUrlSetting } from '@/lib/pluginGuide';

import { CopyableCommand } from './CopyableCommand';

// testId — 한 화면에 안내가 둘 놓일 수 있어(API 토큰 화면 + 발급 모달, WP-875) 바꿀 수 있게 둔다. 단계는 `${testId}-step`.
export function PluginServerUrlStep({ testId = 'plugin-server-url' }: { testId?: string }) {
  if (!needsServerUrlSetting(MCP_ENDPOINT)) return null;
  return (
    <div className="space-y-1.5" data-testid={`${testId}-step`}>
      <p className="text-xs text-muted-foreground">
        이 서버는 기본 주소가 아니에요 — <code className="font-mono">/plugin configure genia-works@genia-works</code> 에서
        서버 주소를 아래 주소로 바꾸세요.
      </p>
      <CopyableCommand command={MCP_ENDPOINT} testId={testId} />
    </div>
  );
}
