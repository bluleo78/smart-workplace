// 메일 작성 새 창(WP-1535) — /mail/compose?draftId=N. 메인 창 작성창의 ↗ 가 임시저장한 뒤 이 주소로 독립 브라우저 창을 연다.
// 앱 셸(레일·메뉴·AI·인박스) 없이 작성창 하나만 창 전체에 그린다. 인증은 이 창이 refresh 쿠키로 스스로 부팅한다(AuthProvider·ProtectedRoute).
// 보내거나 닫거나 버리면(서버 작업이 끝난 뒤) 메인 창에 알리고(BroadcastChannel) 이 창을 닫는다.
// OS 창 닫기로 닫혀도 pagehide 에 알려 메인 창 임시보관함이 바로 갱신되게 한다.
import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext';
import { HelpPanelProvider } from '@/components/help/HelpPanelContext';
import { MailComposeProvider, useMailCompose } from '@/components/mail/MailComposeContext';
import { MailComposeDock, type MailComposePopout } from '@/components/mail/MailComposeDock';
import { Button } from '@/components/ui/button';
import { useOpenMailDraft } from '@/hooks/queries/useMailDrafts';
import { type MailComposeWindowEvent, postMailComposeWindowEvent } from '@/lib/mailComposeChannel';

/** 새 창 페이지 — 작성 상태·AI 모드(작성창이 읽는다)·도움말 공급자를 이 창 안에서 따로 둔다(앱 셸은 없다). */
export default function MailComposeWindowPage() {
  return (
    <MailComposeProvider>
      <AIAssistantProvider hotkeysEnabled={false}>
        <HelpPanelProvider>
          <MailComposeWindow />
        </HelpPanelProvider>
      </AIAssistantProvider>
    </MailComposeProvider>
  );
}

/** 창 단계 — 불러오는 중 / 작성 중 / 불러오지 못함 / 끝남(창이 스스로 닫히지 못했을 때 보인다). */
type Phase = 'loading' | 'open' | 'error' | 'done';

function MailComposeWindow() {
  const [params] = useSearchParams();
  const raw = params.get('draftId');
  const draftId = raw != null && /^\d+$/.test(raw) ? Number(raw) : null;
  // 이 창을 연 창의 id — 끝났다는 알림에 실어, 연 창만 결과 토스트를 띄우게 한다.
  const opener = params.get('opener');
  // 손대지 않은 작성을 옮기려 방금 만든 임시저장 — 여기서도 손대지 않고 닫으면 지운다.
  const fresh = params.get('fresh') === '1';
  const { draft, closeCompose } = useMailCompose();
  const openDraft = useOpenMailDraft();
  const [phase, setPhase] = useState<Phase>(draftId == null ? 'error' : 'loading');
  // 처음 한 번만 연다 — StrictMode 의 두 번 실행이 openCompose 를 다시 불러 회차(instanceId)를 바꾸지 않게.
  const startedRef = useRef(false);
  // 마지막으로 연 작성의 계정 — OS 닫기(pagehide) 알림에 싣는다.
  const accountRef = useRef<number | null>(null);
  // 이미 알렸는가 — 보내거나 버린 뒤 창이 닫히며 pagehide 가 또 알리지 않게.
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (draftId == null || startedRef.current) return;
    startedRef.current = true;
    void openDraft(draftId).then(() => setPhase((p) => (p === 'loading' ? 'open' : p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  // 받지 못했으면(지워진 임시저장·다른 워크스페이스) useOpenMailDraft 가 토스트만 띄우고 작성을 열지 않는다 — 빈 창 대신 안내를 보인다.
  // 상태로 굳히지 않고 매 렌더 판정한다 — 작성이 다시 열리면(충돌 다시 불러오기 등) 안내가 남지 않게.
  const showError = phase === 'error' || (phase === 'open' && draft == null);
  useEffect(() => {
    if (draft) accountRef.current = draft.accountId;
  }, [draft]);

  // OS 창 닫기·새로고침 — 저장 결과는 모르지만 임시보관함은 바뀌었을 수 있어 메인 창이 다시 받게 알린다.
  useEffect(() => {
    const onPageHide = () => {
      if (notifiedRef.current || accountRef.current == null || draftId == null) return;
      postMailComposeWindowEvent({ type: 'closed', accountId: accountRef.current, draftId, opener });
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [draftId, opener]);

  // 작성이 끝났다(서버 작업 완료) — 메인 창에 알리고 작성창을 내린다. 창 닫기는 아래 효과가 한다.
  const onDone = useCallback(
    (kind: MailComposeWindowEvent, accountId: number) => {
      notifiedRef.current = true;
      if (draftId != null) postMailComposeWindowEvent({ type: kind, accountId, draftId, opener });
      closeCompose();
      setPhase('done');
    },
    [closeCompose, draftId, opener],
  );
  // 창 닫기는 작성창이 내려간 커밋 뒤에 한다 — 여기서 바로 닫으면 저장 중이던 작성창의 나가기 경고(beforeunload)가 아직 걸려 있어
  // 「사이트에서 나가시겠어요?」가 뜬다. 언마운트 정리가 새 효과보다 먼저 돌므로 이때는 경고가 풀려 있다.
  // 직접 연 탭처럼 스크립트로 닫을 수 없는 창이면 끝남 안내가 남는다.
  useEffect(() => {
    if (phase === 'done') window.close();
  }, [phase]);
  const popout = useMemo<MailComposePopout>(() => ({ onDone, fresh }), [onDone, fresh]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground" data-testid="mail-compose-window">
      {phase === 'loading' && !showError && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground" data-testid="mail-compose-window-loading">
          불러오는 중…
        </div>
      )}
      {showError && (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center" data-testid="mail-compose-window-error">
          <AlertTriangle className="size-10 text-destructive" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">작성 중인 메일을 불러오지 못했어요. 임시보관함에서 다시 열어 주세요.</p>
          <Button variant="outline" onClick={() => window.close()}>
            창 닫기
          </Button>
        </div>
      )}
      {phase === 'done' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" data-testid="mail-compose-window-done">
          <p className="text-sm text-muted-foreground">이 창을 닫아도 돼요.</p>
          <Button variant="outline" asChild>
            <Link to="/mail">메일로 가기</Link>
          </Button>
        </div>
      )}
      {/* 작성창은 열려 있는 동안만 그린다 — 끝난 뒤(done)엔 컨텍스트 작성이 비어 아무것도 그리지 않는다. */}
      {phase !== 'done' && <MailComposeDock popout={popout} />}
    </div>
  );
}
