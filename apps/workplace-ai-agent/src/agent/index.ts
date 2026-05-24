// Claude Agent SDK import — 본 epic 은 패키지 의존성만 확보, 호출 미구현.
// Phase 5b/5c 에서 query() / createSdkMcpServer() 패턴을 채운다.
import { query } from '@anthropic-ai/claude-agent-sdk';

// re-export 만 두어 트리쉐이킹 대상 노출을 방지.
export { query };
