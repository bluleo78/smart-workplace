// Claude Agent SDK import — 본 epic 은 패키지 의존성만 확보, 호출 미구현.
// Phase 5b/5c 에서 query() / createSdkMcpServer() 패턴을 채운다.
import { query } from '@anthropic-ai/claude-agent-sdk';

// Phase 5b/5c 진입점 예약 — 현 시점은 SDK 의존성 설치 확인용.
// 실제 호출(query, createSdkMcpServer)은 5b 에서 채운다.
export { query };
