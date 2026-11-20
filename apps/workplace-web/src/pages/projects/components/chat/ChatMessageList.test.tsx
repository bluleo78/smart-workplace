// ChatMessageList 읽음 다시 보내기(WP-1855) — 실제 useMarkChatRead 와 함께, 실패한 읽음을 탭이 다시 보일 때 다시 보내는지 본다.
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createChatMessage } from '../../../../../e2e/factories/chat.factory';
import { chatApi } from '../../../../api/chat';
import { useMarkChatRead } from '../../../../hooks/queries/useMarkChatRead';
import { httpError } from '../../../../test/httpError';
import { controlIntersection } from '../../../../test/kits/layout';
import { renderWithProviders } from '../../../../test/renderWithProviders';
import { ChatMessageList } from './ChatMessageList';

const THREAD_ID = 100;

/** 이슈 채팅 섹션처럼 읽음 훅을 목록에 잇는 최소 감싸개. */
function Harness() {
  const markRead = useMarkChatRead(THREAD_ID);
  return (
    <ChatMessageList
      messages={[
        createChatMessage({ id: 10, createdAt: '2026-11-20T10:00:00Z' }),
        createChatMessage({ id: 11, createdAt: '2026-11-20T10:01:00Z' }),
      ]}
      currentUserId={1}
      hasMore={false}
      isFetchingMore={false}
      onLoadMore={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      onMarkRead={markRead}
      editingMessageId={null}
      renderEditor={() => null}
      questionWorks={new Map()}
    />
  );
}

/** 탭 표시 상태를 바꾸고 visibilitychange 를 쏜다 — 문서 인스턴스에만 덮어쓰고 afterEach 에서 지운다. */
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** 읽음 디바운스(1초)를 넘기고 요청 프라미스까지 흘린다. */
async function flushDebounce() {
  await vi.advanceTimersByTimeAsync(1000);
}

describe('ChatMessageList 읽음 다시 보내기', () => {
  let markRead: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    markRead = vi.spyOn(chatApi, 'markRead').mockResolvedValue(undefined as never);
    vi.spyOn(toast, 'error').mockImplementation(() => 'id');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // 인스턴스에 덮어쓴 getter 를 지워 jsdom 원래 값(프로토타입)으로 돌린다.
    Reflect.deleteProperty(document, 'visibilityState');
  });

  test('읽음이 실패한 뒤 탭이 다시 보이면 같은 id 를 다시 보내고, 성공한 뒤에는 더 보내지 않는다', async () => {
    markRead.mockRejectedValueOnce(httpError(500));
    const io = controlIntersection();
    renderWithProviders(<Harness />);

    // 마지막 메시지가 보인다 → 1초 뒤 읽음 요청, 500 으로 실패.
    io.set(() => true);
    await flushDebounce();
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenLastCalledWith(THREAD_ID, { uptoMessageId: 11 });

    // 탭을 떠났다가 돌아온다 — 숨김 동안은 보내지 않고, 다시 보이면 같은 id 를 다시 보낸다(이번엔 성공).
    setVisibility('hidden');
    await flushDebounce();
    expect(markRead).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await flushDebounce();
    expect(markRead).toHaveBeenCalledTimes(2);
    expect(markRead).toHaveBeenLastCalledWith(THREAD_ID, { uptoMessageId: 11 });

    // 성공한 뒤 또 돌아와도 이미 보낸 id 라 요청이 없다.
    setVisibility('hidden');
    setVisibility('visible');
    await flushDebounce();
    expect(markRead).toHaveBeenCalledTimes(2);
  });

  test('마지막 메시지가 화면 밖이면 탭이 다시 보여도 보내지 않는다', async () => {
    const io = controlIntersection();
    renderWithProviders(<Harness />);

    io.set(() => false);
    setVisibility('hidden');
    setVisibility('visible');
    await flushDebounce();
    expect(markRead).not.toHaveBeenCalled();
  });
});
