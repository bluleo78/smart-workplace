// 확인카드 승인(WP-190) — "모두 승인" 도중 대화를 옮겨도 결과가 카드의 대화에만 붙는지.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/home', () => ({ homeApi: { confirmProposal: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api-error', () => ({ handleApiError: vi.fn(), extractApiError: (_e: unknown, m: string) => m }));

import { homeApi } from '@/api/home';
import { createChatStreams } from '@/lib/ai/chatStreams';
import type { HomeMessage, PendingAction } from '@/types/home';

import { confirmAllProposalCards, confirmProposalCard, currentTarget } from './chatProposals';

const action = (id: number): PendingAction => ({ id, actionType: 'issue.assign', summary: `카드${id}`, params: {} });
const resultMsg = (id: number): HomeMessage => ({
  id,
  role: 'ACTION_DONE',
  content: `승인${id}`,
  widgets: null,
  toolCalls: null,
  createdAt: '',
});

/** 대화 A 에 카드 2장, 대화 B 는 카드 없음. 현재 = A. */
function setup() {
  const s = createChatStreams({ storage: () => null });
  s.setOwner('1:1');
  s.select('s-b');
  s.load('s-b', [{ role: 'user', content: 'B 질문' }], []);
  s.select('s-a');
  s.load('s-a', [{ role: 'user', content: 'A 질문' }], [action(1), action(2)]);
  return s;
}
const contents = (s: ReturnType<typeof setup>, key: string) => s.getSnapshot().entries.get(key)?.turns.map((t) => t.content);

describe('확인카드 승인 대상 대화 고정', () => {
  beforeEach(() => vi.mocked(homeApi.confirmProposal).mockReset());

  it('모두 승인 도중 다른 대화로 옮겨도 남은 카드 결과는 A 에만 붙고 B 에는 붙지 않는다', async () => {
    const s = setup();
    let switched = false;
    vi.mocked(homeApi.confirmProposal).mockImplementation(async (id: number) => {
      // 첫 카드 응답 전에 사용자가 B 로 옮긴다.
      if (!switched) {
        switched = true;
        s.select('s-b');
      }
      return { data: { message: resultMsg(id), proposal: { status: 'DONE' } } } as never;
    });

    await confirmAllProposalCards(currentTarget(s), s);

    expect(homeApi.confirmProposal).toHaveBeenCalledTimes(2);
    expect(contents(s, 's-a')).toEqual(['A 질문', '승인1', '승인2']);
    expect(contents(s, 's-b')).toEqual(['B 질문']);
    expect(s.getSnapshot().entries.get('s-a')?.pendingActions).toEqual([]);
  });

  it('다른 대화의 카드는 승인하지 않는다(서버 호출 없음)', async () => {
    const s = setup();
    const cardOfA = s.getSnapshot().entries.get('s-a')!.pendingActions[0];
    s.select('s-b');
    expect(await confirmProposalCard(cardOfA, currentTarget(s), s)).toBeNull();
    expect(homeApi.confirmProposal).not.toHaveBeenCalled();
  });
});
