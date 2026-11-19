// 메일 작성 새 창(WP-1535) 알림을 메인 창이 받는다 — AppLayout 에 한 번 둔다.
// 새 창은 자기 쿼리 캐시만 고치므로, 거기서 보내거나 닫거나 버리면 이 창의 보낸편지함·임시보관함(목록·개수)을 다시 받는다.
// 새 창은 끝나자마자 닫혀 그 창의 토스트를 볼 수 없으므로 결과도 여기서 알린다 — 단 그 새 창을 연 창만(다른 탭은 목록만 갱신).
// OS 닫기는 결과를 모르니 갱신만 한다. 끝난 임시저장은 「새 창에서 쓰는 중」 기억에서 지운다.
// WP-1786: 보냈다는 알림엔 「메일 보냄 · 되돌리기」를 띄운다 — 되돌리면 이 창(메인 창)의 작성창으로 다시 연다.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { invalidateMailDrafts } from '@/hooks/queries/mailDraftKeys';
import { useOpenMailDraft } from '@/hooks/queries/useMailDrafts';
import { scheduleSentRefresh, showSentToast } from '@/hooks/queries/useMailMessages';
import { useLatest } from '@/hooks/useLatest';
import { forgetMailComposePopout, listenMailComposeWindowEvents, MAIL_COMPOSE_WINDOW_ID } from '@/lib/mailComposeChannel';
import { notifySentElsewhere } from '@/lib/mailDraftCompose';

export function MailComposeWindowSync() {
  const qc = useQueryClient();
  const openDraft = useOpenMailDraft();
  // 듣기는 한 번만 건다 — openDraft 는 렌더마다 새 함수라 최신 것을 ref 로 읽는다.
  const openRef = useLatest(openDraft);
  useEffect(
    () =>
      listenMailComposeWindowEvents(({ type, accountId, draftId, opener, sentDraftId }) => {
        forgetMailComposePopout(draftId);
        // 어느 경우든 임시보관함은 바뀌었을 수 있다(저장·발송 뒤 삭제·버림).
        void invalidateMailDrafts(qc, accountId);
        const mine = opener === MAIL_COMPOSE_WINDOW_ID;
        if (type === 'sent') {
          const queuedId = sentDraftId ?? draftId;
          // 연 창은 「메일 보냄 · 되돌리기」(지금·20초 뒤 다시 받기 포함), 다른 탭은 목록만 다시 받는다.
          if (mine) showSentToast(qc, accountId, queuedId, (id, detail) => openRef.current(id, { detail }));
          else scheduleSentRefresh(qc, accountId);
          return;
        }
        if (!mine) return;
        if (type === 'saved') {
          toast.success('임시보관함에 저장했어요');
        } else if (type === 'discarded') {
          toast('임시저장을 버렸어요');
        } else if (type === 'sentElsewhere' || type === 'sentElsewhereSaved') {
          // WP-1786 리뷰 후속 — 새 창이 다른 곳에서 보냈거나 지운 작성을 닫았다. 새 창은 곧 닫혀 토스트를 못 보므로 연 창이 알린다
          // (연 창이 듣고 있지 않으면 새 창이 스스로 안내한다 — MailComposeWindowPage).
          notifySentElsewhere(type === 'sentElsewhereSaved');
        }
      }),
    // openRef 는 useLatest 가 돌려주는 같은 ref 라 의존성에 넣어도 다시 걸지 않는다.
    [qc, openRef],
  );
  return null;
}
