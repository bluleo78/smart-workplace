// 메일 작성 새 창(WP-1535) 알림을 메인 창이 받는다 — AppLayout 에 한 번 둔다.
// 새 창은 자기 쿼리 캐시만 고치므로, 거기서 보내거나 닫거나 버리면 이 창의 보낸편지함·임시보관함(목록·개수)을 다시 받는다.
// 새 창은 끝나자마자 닫혀 그 창의 토스트를 볼 수 없으므로 결과도 여기서 알린다 — 단 그 새 창을 연 창만(다른 탭은 목록만 갱신).
// OS 닫기는 결과를 모르니 갱신만 한다. 끝난 임시저장은 「새 창에서 쓰는 중」 기억에서 지운다.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { invalidateMailDrafts } from '@/hooks/queries/mailDraftKeys';
import { forgetMailComposePopout, listenMailComposeWindowEvents, MAIL_COMPOSE_WINDOW_ID } from '@/lib/mailComposeChannel';

export function MailComposeWindowSync() {
  const qc = useQueryClient();
  useEffect(
    () =>
      listenMailComposeWindowEvents(({ type, accountId, draftId, opener }) => {
        forgetMailComposePopout(draftId);
        // 어느 경우든 임시보관함은 바뀌었을 수 있다(저장·발송 뒤 삭제·버림).
        void invalidateMailDrafts(qc, accountId);
        // useSendMail 이 새 창에서 무효화하는 것과 같은 키.
        if (type === 'sent') void qc.invalidateQueries({ queryKey: ['mail-messages', accountId, 'SENT'] });
        if (opener !== MAIL_COMPOSE_WINDOW_ID) return;
        if (type === 'sent') {
          toast.success('메일을 보냈습니다');
        } else if (type === 'saved') {
          toast.success('임시보관함에 저장했어요');
        } else if (type === 'discarded') {
          toast('임시저장을 버렸어요');
        }
      }),
    [qc],
  );
  return null;
}
