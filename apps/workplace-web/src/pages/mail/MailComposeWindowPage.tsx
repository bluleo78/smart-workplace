// 메일 작성 새 창(WP-1535) — /mail/compose?draftId=N. 메인 창 작성창의 ↗ 가 임시저장한 뒤 이 주소로 독립 브라우저 창을 연다.
// 앱 셸(레일·메뉴·AI·인박스) 없이 작성창 하나만 창 전체에 그린다. 인증은 이 창이 refresh 쿠키로 스스로 부팅한다(AuthProvider·ProtectedRoute).
// 보내거나 닫거나 버리면(서버 작업이 끝난 뒤) 메인 창에 알리고(BroadcastChannel) 이 창을 닫는다.
// OS 창 닫기로 닫혀도 pagehide 에 알려 메인 창 임시보관함이 바로 갱신되게 한다.
// WP-1786: 보낸 순간 결과를 맡을 메인 창이 없으면(연 창 없이 알림으로 바로 열었거나, 연 창이 닫혔거나 새로 고쳐졌다) 이 창이 「메일 보냄 · 되돌리기」를
// 띄우고 10초 동안 열려 있다. 「되돌리기」를 누르면 닫기 시계를 멈추고, 되돌리지 못하면 안내를 볼 수 있게 창을 남긴다.
// 이미 보내는 중인 메일(QUEUED·SENDING)을 이 주소로 열면 쓰기 창 대신 「보내는 중」 안내를 보인다.
// WP-1786 리뷰 후속: 다른 곳에서 보냈거나 지운 작성이라 닫을 때(sentElsewhere*)도 메인 창이 듣고 있지 않으면 이 창이 그 안내를 보이고 열려 있다.
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext';
import { HelpPanelProvider } from '@/components/help/HelpPanelContext';
import { MailComposeProvider, useMailCompose } from '@/components/mail/MailComposeContext';
import { MailComposeDock, type MailComposePopout } from '@/components/mail/MailComposeDock';
import { Button } from '@/components/ui/button';
import { useOpenMailDraft } from '@/hooks/queries/useMailDrafts';
import { SEND_UNDO_MS, showSentToast } from '@/hooks/queries/useMailMessages';
import { isOpenerListening, type MailComposeWindowEvent, postMailComposeWindowEvent } from '@/lib/mailComposeChannel';
import { MAIL_ALREADY_SENDING_NOTICE, sentElsewhereNotice } from '@/lib/mailDraftCompose';

/**
 * 새 창 페이지 — 작성 상태·AI 모드(작성창이 읽는다)·도움말 공급자를 이 창 안에서 따로 둔다(앱 셸은 없다).
 * 작성 상태는 popout 으로 둔다 — 이미 새 창이라 작성 방식 기본값(WP-1744)을 읽지도, 또 다른 창을 미리 열지도 않는다.
 */
export default function MailComposeWindowPage() {
  return (
    <MailComposeProvider popout>
      <AIAssistantProvider hotkeysEnabled={false}>
        <HelpPanelProvider>
          <MailComposeWindow />
        </HelpPanelProvider>
      </AIAssistantProvider>
    </MailComposeProvider>
  );
}

/**
 * 창 단계 — 불러오는 중 / 작성 중 / 불러오지 못함 / 끝남(창이 스스로 닫히지 못했을 때 보인다) /
 * 보냄(결과를 맡을 메인 창이 없는 창 — 되돌릴 수 있는 10초 동안 열어 둔다, WP-1786) / 보내는 중(이미 대기열에 오른 메일이라 열지 않았다, WP-1786) /
 * 다른 곳에서 보냈거나 지움(안내를 맡을 메인 창이 없는 창 — 안내를 보이고 사용자가 닫을 때까지 열어 둔다, WP-1786 리뷰 후속.
 * elsewhereSaved 는 그러면서 저장 못 한 변경을 새 임시저장으로 남긴 경우 — 안내에 덧붙임을 단다).
 */
type Phase = 'loading' | 'open' | 'error' | 'done' | 'sent' | 'sending' | 'elsewhere' | 'elsewhereSaved';

/** 보냄 단계의 「되돌리기」 — idle(누르지 않음) / pending(되돌리는 중 — 닫기 시계를 멈춘다) / failed(되돌리지 못함 — 창을 남긴다). */
type UndoState = 'idle' | 'pending' | 'failed';

/** 보냄 단계 안내 — 「되돌리기」 진행마다 한 문구. */
const SENT_NOTICE: Record<UndoState, string> = {
  idle: '메일을 보냈어요. 되돌릴 수 있는 동안 이 창을 열어 둘게요.',
  pending: '되돌리는 중…',
  failed: '메일을 되돌리지 못했어요. 이 창을 닫아도 돼요.',
};

function MailComposeWindow() {
  const [params] = useSearchParams();
  const raw = params.get('draftId');
  const draftId = raw != null && /^\d+$/.test(raw) ? Number(raw) : null;
  // 이 창을 연 창의 id — 끝났다는 알림에 실어, 연 창만 결과 토스트를 띄우게 한다.
  const opener = params.get('opener');
  // 손대지 않은 작성을 옮기려 방금 만든 임시저장 — 여기서도 손대지 않고 닫으면 지운다.
  const fresh = params.get('fresh') === '1';
  const { draft, closeCompose } = useMailCompose();
  const qc = useQueryClient();
  const openDraft = useOpenMailDraft();
  const [phase, setPhase] = useState<Phase>(draftId == null ? 'error' : 'loading');
  // 처음 한 번만 연다 — StrictMode 의 두 번 실행이 openCompose 를 다시 불러 회차(instanceId)를 바꾸지 않게.
  const startedRef = useRef(false);
  // 마지막으로 연 작성의 계정 — OS 닫기(pagehide) 알림에 싣는다.
  const accountRef = useRef<number | null>(null);
  // 이미 알렸는가 — 보내거나 버린 뒤 창이 닫히며 pagehide 가 또 알리지 않게.
  const notifiedRef = useRef(false);
  // 보낸 회차(연 창이 없는 창) — 보낼 때마다 새 객체라, 되돌려 다시 연 작성을 또 보내면 단계가 같은 'sent' 여도 닫기 시계가 10초를 다시 센다.
  const [sentRound, setSentRound] = useState<object | null>(null);
  // 지금 작성이 열려 있는가 — 10초 타이머가 끝날 때 되돌려 다시 열었으면 창을 닫지 않는다.
  const draftOpenRef = useRef(false);
  // 「되돌리기」 진행 — 안내 문구를 고르고 닫기 시계를 멈춘다. 토스트 단추 클릭은 이산 이벤트라 누른 그 자리에서 다시 그려지고 효과 정리가
  // 돌아 시계가 바로 멈춘다(9.8초에 눌러도 창이 닫히지 않는다).
  const [undo, setUndo] = useState<UndoState>('idle');
  useEffect(() => {
    draftOpenRef.current = draft != null;
  }, [draft]);

  useEffect(() => {
    if (draftId == null || startedRef.current) return;
    startedRef.current = true;
    // 이미 새 창이라 작성 방식 기본값을 쓰지 않는다(WP-1744 — placement 없음. 새 창 페이지 공급자는 어차피 늘 DOCK).
    // 보내는 중인 메일이면(WP-1786) 훅이 쓰기 창을 열지 않고 알린다 — 「불러오지 못함」 대신 보내는 중 안내를 보인다.
    void openDraft(draftId).then((r) => setPhase((p) => (p === 'loading' ? (r === 'sending' ? 'sending' : 'open') : p)));
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
    (kind: MailComposeWindowEvent, accountId: number, sentDraftId?: number) => {
      notifiedRef.current = true;
      // 보냈을 때 「메일 보냄 · 되돌리기」를 이 창이 맡는가 — 보낸 지금 정한다(WP-1786 코드 리뷰). 연 메인 창이 없거나 닫혔거나 새로 고쳐져
      // 이 창의 알림을 받지 못하면 이 창이 띄운다. 연 창이 열려 있을 때 정해 두면 그 사이 닫힌 경우 아무 데서도 되돌릴 수 없었다.
      const queuedId = sentDraftId ?? draftId;
      const undoHere = kind === 'sent' && queuedId != null && !isOpenerListening(opener);
      // 다른 곳에서 보냈거나 지운 작성이라 닫는다(WP-1786 리뷰 후속) — 보냄과 같이 지금 메인 창이 듣고 있는지 보고, 없으면(연 창이 닫혔거나
      // 새로 고쳐졌거나 주소로 바로 열었다) 이 창이 안내를 맡는다. 맡지 않으면 메인 창이 띄우고 이 창은 곧 닫힌다.
      const elsewhereHere = (kind === 'sentElsewhere' || kind === 'sentElsewhereSaved') && !isOpenerListening(opener);
      // 보냈으면 대기 행 id 를 함께 알린다(WP-1786) — 메인 창이 맡으면 그 창이 「되돌리기」를 띄운다. 이 창이 맡으면 연 창 id 를 싣지 않는다
      // (다른 탭은 목록만 다시 받는다 — 같은 토스트가 두 곳에 뜨지 않게).
      if (draftId != null) {
        postMailComposeWindowEvent({
          type: kind,
          accountId,
          draftId,
          opener: undoHere || elsewhereHere ? null : opener,
          ...(sentDraftId != null ? { sentDraftId } : {}),
        });
      }
      closeCompose();
      // 이 창이 안내를 맡는다 — 닫지 않고 안내와 「창 닫기」를 보인다(읽기 전에 사라지지 않게 사용자가 닫는다)(WP-1786 리뷰 후속).
      if (elsewhereHere) {
        setPhase(kind === 'sentElsewhereSaved' ? 'elsewhereSaved' : 'elsewhere');
        return;
      }
      // 이 창이 「메일 보냄 · 되돌리기」를 띄우고, 누를 수 있게 10초 동안 열어 둔다(아래 효과가 닫는다). 되돌리면 이 창에 다시 연다.
      if (undoHere && queuedId != null) {
        setUndo('idle');
        setPhase('sent');
        setSentRound({});
        showSentToast(qc, accountId, queuedId, (id, detail) => openDraft(id, { detail }), {
          // 누른 즉시 닫기 시계를 멈춘다 — 되돌리기 요청이 끝나기 전에 창이 닫히면 다시 연 작성이 보이지 않는다.
          onStart: () => setUndo('pending'),
          // 되돌렸으면 작성이 다시 열렸다(그 작성이 끝날 때 닫힌다). 못 했으면(이미 보냄 등) 안내를 볼 수 있게 창을 남긴다.
          onSettled: (ok) => setUndo(ok ? 'idle' : 'failed'),
        });
        return;
      }
      setPhase('done');
    },
    // openDraft 는 useOpenMailDraft 가 useCallback 으로 고정해 둬 이 콜백(과 아래 popout 메모)이 렌더마다 바뀌지 않는다.
    [closeCompose, draftId, opener, qc, openDraft],
  );
  // 보냄 단계 — 되돌릴 수 있는 시간이 지나면 닫는다. 그 사이 되돌려 작성이 다시 열렸거나 「되돌리기」를 눌렀으면 닫지 않는다(작성은 끝날 때 닫히고,
  // 되돌리지 못했으면 창이 남아 안내를 보인다). 되돌리는 중에는 시계를 걸지 않는다 — 누르면 undo 가 바뀌어 정리가 걸어 둔 시계를 지운다.
  useEffect(() => {
    if (phase !== 'sent' || sentRound == null || undo !== 'idle') return;
    const t = setTimeout(() => {
      if (!draftOpenRef.current) setPhase('done');
    }, SEND_UNDO_MS);
    return () => clearTimeout(t);
  }, [phase, sentRound, undo]);
  // 창 닫기는 작성창이 내려간 커밋 뒤에 한다 — 여기서 바로 닫으면 저장 중이던 작성창의 나가기 경고(beforeunload)가 아직 걸려 있어
  // 「사이트에서 나가시겠어요?」가 뜬다. 언마운트 정리가 새 효과보다 먼저 돌므로 이때는 경고가 풀려 있다.
  // 직접 연 탭처럼 스크립트로 닫을 수 없는 창이면 끝남 안내가 남는다.
  useEffect(() => {
    if (phase === 'done') window.close();
  }, [phase]);
  const popout = useMemo<MailComposePopout>(() => ({ onDone, fresh }), [onDone, fresh]);
  // 보냄·보내는 중 안내는 작성이 닫혀 있을 때만 — 「되돌리기」로 이 창에 다시 열면 작성창이 보인다.
  const showSent = phase === 'sent' && draft == null;
  const showSending = phase === 'sending' && draft == null;
  const showElsewhere = (phase === 'elsewhere' || phase === 'elsewhereSaved') && draft == null;

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
          <CloseWindowButton />
        </div>
      )}
      {showSent && (
        <WindowNotice testId="mail-compose-window-sent" text={SENT_NOTICE[undo]}>
          {undo === 'failed' && <CloseWindowButton />}
        </WindowNotice>
      )}
      {showSending && (
        <WindowNotice testId="mail-compose-window-sending" text={MAIL_ALREADY_SENDING_NOTICE}>
          <CloseWindowButton />
        </WindowNotice>
      )}
      {showElsewhere && (
        <WindowNotice
          testId="mail-compose-window-sent-elsewhere"
          text={sentElsewhereNotice(phase === 'elsewhereSaved')}
        >
          <CloseWindowButton />
        </WindowNotice>
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

/** 새 창 가운데 안내(보냄·보내는 중·다른 곳에서 보냈거나 지움) — 상태 알림(role=status) 문구 한 줄과 그 아래 단추(있으면)를 같은 모양으로 그린다. */
function WindowNotice({ testId, text, children }: { testId: string; text: string; children?: ReactNode }) {
  return (
    <div role="status" className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center" data-testid={testId}>
      <p className="text-sm text-muted-foreground">{text}</p>
      {children}
    </div>
  );
}

/** 「창 닫기」 — 스크립트로 이 창을 닫는다(안내를 본 뒤 사용자가 직접 닫게). */
function CloseWindowButton() {
  return (
    <Button variant="outline" onClick={() => window.close()}>
      창 닫기
    </Button>
  );
}
