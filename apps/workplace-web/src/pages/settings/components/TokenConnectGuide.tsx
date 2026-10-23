// 외부 도구 연결 안내 — 발급 결과 모달(TokenIssueDialog)과 API 토큰 화면의 「도구에 연결하기」 섹션이 같이 쓴다(WP-875).
// 한 곳에 두어 연결 주소·명령이 두 곳에서 어긋나지 않게 한다(WP-387 재발 방지).
// Claude Code 는 genia-works 플러그인 설치 안내(WP-378)로 연결한다 — 토큰이 든 명령은 셸 기록에 남으므로 보여 주지 않는다.

// WP-350: 앱 목록은 공유 패키지 소스(순수 모듈 — 번들에 zod·도구 핸들러가 들어오지 않는다)에서 가져와 하드코딩이 어긋나지 않게 한다.
import { TOOL_APPS } from '@smart-workplace/mcp-tools-shared/tool-apps';
import { ChevronDown } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MCP_ENDPOINT } from '@/lib/mcpEndpoint';
import { buildPluginInstallCommands } from '@/lib/pluginGuide';

import { CopyableCommand } from '../../admin/components/CopyableCommand';
import { PluginServerUrlStep } from '../../admin/components/PluginServerUrlStep';

interface TokenConnectGuideProps {
  /**
   * 토큰 단계 문구 — issued: 발급 직후 모달(위에 토큰이 보인다), saved: 토큰 화면(토큰 값은 다시 보이지 않는다).
   */
  tokenSource: 'issued' | 'saved';
  /** data-testid 접두 — 모달과 화면이 같은 DOM 에 함께 있을 수 있어 서로 다르게 둔다. */
  testIdPrefix: string;
  /** 서버 주소 단계 testId — 기본은 `${testIdPrefix}-server-url`. 모달은 기존 plugin-server-url 을 이어 쓴다. */
  serverUrlTestId?: string;
}

export function TokenConnectGuide({ tokenSource, testIdPrefix: p, serverUrlTestId = `${p}-server-url` }: TokenConnectGuideProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">1. 플러그인 설치 (Claude Code 안에서)</p>
        <CopyableCommand command={buildPluginInstallCommands()} testId={`${p}-plugin-install-command`} />
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">2. 토큰 넣기</p>
        <p className="text-xs text-muted-foreground" data-testid={`${p}-plugin-token-step`}>
          {tokenSource === 'issued'
            ? '설치하면서 토큰을 물으면 위 토큰을 붙여 넣으세요.'
            : '설치하면서 토큰을 물으면 발급 때 복사한 토큰을 붙여 넣으세요.'}{' '}
          묻지 않았거나 나중에 바꿀 때는 <code className="font-mono">/plugin configure genia-works@genia-works</code> 를
          실행해 붙여 넣으세요.
        </p>
      </div>
      <PluginServerUrlStep testId={serverUrlTestId} />
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">3. 확인</p>
        <p className="text-xs text-muted-foreground">
          <code className="font-mono">/mcp</code> 에서 genia-works 가 연결됨으로 보이면 끝입니다. 예전에 명령으로
          연결해 두었다면 플러그인이 확인한 뒤 알아서 정리합니다.
        </p>
      </div>

      {/* 플러그인을 못 쓰는 도구(Claude.ai·ChatGPT 등)용 — 기본은 접어 두어 Claude Code 안내가 먼저 보이게 한다. */}
      <Collapsible className="border-t pt-3">
        <CollapsibleTrigger
          className="group flex w-full items-center justify-between text-left text-sm text-muted-foreground hover:text-foreground"
          data-testid={`${p}-other-tools`}
        >
          다른 도구로 연결 (Claude.ai, ChatGPT 등)
          <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <p className="text-xs text-muted-foreground">연결 주소</p>
          <CopyableCommand command={MCP_ENDPOINT} testId={`${p}-mcp-endpoint`} />
          {/* WP-350: 기본 주소는 전체 도구를 싣는다 — Claude·ChatGPT 는 도구 정의를 전부 읽으므로 필요한 앱만, 또는 읽기 전용으로 좁히는 방법을 알린다. */}
          <div className="space-y-1 text-xs text-muted-foreground" data-testid={`${p}-connect-scope-guide`}>
            <p>
              기본 주소(<code className="font-mono">/mcp</code>)는 모든 앱의 도구를 연결합니다. 주소 끝을 바꾸면 범위를 좁힐 수 있습니다.
            </p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>
                <code className="font-mono">/mcp/x/issue,wiki</code> — 이슈·노트 도구만
              </li>
              <li>
                <code className="font-mono">/mcp/readonly</code> — 조회 도구만(읽기 전용)
              </li>
              <li>
                <code className="font-mono">/mcp/x/issue,wiki/readonly</code> — 앱 선택 + 읽기 전용
              </li>
            </ul>
            <p>앱: {TOOL_APPS.join(', ')}</p>
            <p>플러그인에서도 설정 › 서버 주소에 이 주소를 넣으면 범위를 좁힐 수 있습니다.</p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
