// 서버 기준 생성 중 대화 재동기화(WP-190) — 앱 시작·SSE (재)연결·409/429 직후 호출한다.
import { homeApi } from '@/api/home';
import { type ChatStreams, chatStreams } from '@/lib/ai/chatStreams';

/** 실패는 조용히 넘긴다 — 다음 재연결·종결 이벤트로 회복되고, 토스트로 화면을 어지럽히지 않는다. */
export async function resyncActiveChats(store: ChatStreams = chatStreams): Promise<void> {
  const token = store.beginResync();
  try {
    const { data } = await homeApi.activeChats();
    store.setActive(data.items, data.limit, token);
  } catch {
    // 조용히 — 다음 기회에 다시 맞춘다.
  }
}
