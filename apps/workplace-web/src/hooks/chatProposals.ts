// 확인카드 승인(WP-190) — 카드 결과를 "그 카드가 있던 대화" 에만 반영한다. 대화별 동시 생성이 생기며 승인 도중 대화를 옮길 수 있게 됐다 —
// 매 카드마다 현재 대화를 다시 읽으면 "모두 승인" 중 B 로 옮겼을 때 A 의 남은 카드 결과 줄이 B 에 붙는다. 그래서 대상 대화·세대를 한 번
// 잡아 끝까지 그것만 쓴다. API 를 부르지만 React 가 필요 없어 훅(useChatSession)과 분리해 vitest 로 검증한다.
import { isAxiosError } from 'axios';
import { toast } from 'sonner';

import { homeApi } from '@/api/home';
import { type ChatStreams, chatStreams } from '@/lib/ai/chatStreams';
import { messageToTurn } from '@/lib/ai/chatTurns';
import { extractApiError, handleApiError } from '@/lib/api-error';
import type { ActionOutcome, ProposalCard } from '@/types/home';

/** 결과를 반영할 대화 칸과 그 세대 — 그 사이 새 질문이 끼어들면(세대 증가) 반영하지 않는다. */
export interface CardTarget {
  key: string;
  gen: number;
}

/** 카드 자체가 무효(이미 처리됨 409 · 없음 404)인지 — 다시 눌러도 소용없으므로 실패로 확정한다. */
export const isStaleProposal = (e: unknown) =>
  isAxiosError(e) && (e.response?.status === 409 || e.response?.status === 404);

/** 현재 칸과 그 세대 — 클릭 시점에 한 번 잡아 확인카드 비동기 결과를 그 대화·그 세대에만 반영한다. */
export function currentTarget(store: ChatStreams = chatStreams): CardTarget | null {
  const s = store.getSnapshot();
  const e = s.currentKey ? s.entries.get(s.currentKey) : undefined;
  return s.currentKey && e ? { key: s.currentKey, gen: e.gen } : null;
}

/** 카드가 그 대화 칸(그 세대)에 아직 있는가 — 다른 대화의 카드·이미 걷힌 카드를 승인하지 않는다. */
function cardIn(store: ChatStreams, at: CardTarget, id: number): boolean {
  const e = store.getSnapshot().entries.get(at.key);
  return !!e && e.gen === at.gen && e.pendingActions.some((c) => c.id === id);
}

/**
 * #843: 단일 카드 승인. 서버가 성공·실패를 대화 이력에 기록하고 그 메시지를 돌려준다 — 결과 줄을 붙이고 성공이면 카드 제거, 실패면 사유 표시.
 * @param at 카드가 있는 대화(호출 시점에 잡은 것) — 승인 도중 대화를 옮겨도 결과는 여기에만 붙는다
 * @returns 결과 종류. 카드가 그 대화에 없거나 그 대화에 새 질문이 끼어들어 반영하지 않았으면 null.
 */
export async function confirmProposalCard(
  card: ProposalCard,
  at: CardTarget | null,
  store: ChatStreams = chatStreams,
): Promise<ActionOutcome | null> {
  if (card.phase !== 'pending' || !at || !cardIn(store, at, card.id)) return null;
  store.patchCard(at.key, at.gen, card.id, { phase: 'submitting', error: undefined });
  try {
    const { data } = await homeApi.confirmProposal(card.id);
    if (!store.appendTurn(at.key, at.gen, messageToTurn(data.message))) return null;
    if (data.proposal.status === 'DONE') {
      store.removeCard(at.key, at.gen, card.id);
      return 'done';
    }
    store.patchCard(at.key, at.gen, card.id, { phase: 'failed', error: data.proposal.errorMessage ?? '처리하지 못했습니다' });
    return 'failed';
  } catch (e) {
    if (isStaleProposal(e)) {
      if (!store.patchCard(at.key, at.gen, card.id, { phase: 'failed', error: extractApiError(e, '이미 처리된 확인 카드입니다') })) return null;
    } else {
      if (!store.patchCard(at.key, at.gen, card.id, { phase: 'pending' })) return null;
      handleApiError(e, '승인 요청을 보내지 못했습니다');
    }
    return 'failed';
  }
}

/** #843: "모두 승인" — 시작 시점의 대화를 한 번 잡아 그 대화의 대기 카드를 순서대로 하나씩, 실패는 토스트 1건으로 집계. */
export async function confirmAllProposalCards(at: CardTarget | null, store: ChatStreams = chatStreams): Promise<void> {
  if (!at) return;
  const targets = (store.getSnapshot().entries.get(at.key)?.pendingActions ?? []).filter((c) => c.phase === 'pending');
  let failed = 0;
  for (const card of targets) {
    const outcome = await confirmProposalCard(card, at, store);
    if (outcome === null) return;
    if (outcome === 'failed') failed++;
  }
  if (failed > 0) toast.error(`${targets.length}건 중 ${failed}건을 처리하지 못했어요`);
  else toast.success(`${targets.length}건을 모두 처리했어요`);
}
