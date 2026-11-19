// 메일 임시저장(WP-577) TanStack Query 훅 — 임시보관함 목록·개수, 목록에서 작성창으로 열기, 목록에서 삭제(되돌리기).
// 작성창의 자동 저장은 저장 순서를 직접 이어 붙여야 해서(POST 뒤 PUT) useMutation 이 아니라 useMailDraftAutosave 가 api 를 직접 부른다.
import { type QueryClient, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';

import { type ComposePlacement, useMailCompose } from '@/components/mail/MailComposeContext';
import { handleApiError } from '@/lib/api-error';
import {
  liveMailComposePopout,
  MAIL_COMPOSE_WINDOW_ID,
  mailComposeWindowUrl,
  openMailComposeWindow,
  rememberMailComposePopout,
  toastMailComposePopupBlocked,
} from '@/lib/mailComposeChannel';
import {
  composeFromDraft,
  draftPreview,
  isSendInFlight,
  MAIL_ALREADY_SENDING,
  MAIL_ALREADY_SENDING_CHECK_SENT,
  MAIL_ALREADY_SENDING_UNDO_REOPENS,
  savePayloadFromDetail,
} from '@/lib/mailDraftCompose';
import { MAIL_SEND_UNKNOWN } from '@/lib/notifText';

import { createMailDraft, deleteMailDraft, getMailDraft, getMailDraftCount, listMailDrafts } from '../../api/mailDrafts';
import type { MailDraftCreated, MailDraftDetail, MailDraftSaveRequest, MailDraftSummary, MailDraftUpdated } from '../../types/mailDraft';
import { invalidateMailDrafts, mailDraftKeys } from './mailDraftKeys';
import { mailMessageQuery, type OpenSentDraft, toastSendUndo } from './useMailMessages';

// 키·무효화는 순수 파일(mailDraftKeys)에 두고 여기서 다시 내보낸다 — 발송 훅이 이 파일의 무거운 의존 없이 쓰게.
export { invalidateMailDrafts, mailDraftKeys };

/**
 * 임시저장 상세 쿼리 — 열기·지우기(되돌리기용 사본) 모두 서버 최신을 받는다(staleTime 0).
 * 작성창 자동 저장(useMailDraftAutosave)도 보내는 중(inflight)인 임시저장을 다시 확인할 때 쓴다.
 */
export const mailDraftQuery = (id: number) =>
  queryOptions({ queryKey: mailDraftKeys.detail(id), queryFn: () => getMailDraft(id), staleTime: 0 });

/** 임시보관함 목록. enabled=false 면 요청하지 않는다. */
export function useMailDrafts(accountId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: mailDraftKeys.list(accountId ?? 0),
    queryFn: () => listMailDrafts(accountId as number),
    enabled: enabled && !!accountId,
  });
}

/**
 * 임시저장을 고친(PUT) 뒤 목록의 그 행만 그 자리에서 고친다 — 개수는 그대로라 목록을 다시 받지 않는다.
 * 미리보기는 서버와 같은 규칙으로 만들고, 첨부 수는 서버가 정한 값(응답)을 쓴다. 목록에 그 행이 없으면(목록이 그 뒤에 바뀌었다) 다시 받는다.
 */
export function patchMailDraftRow(qc: QueryClient, id: number, payload: MailDraftSaveRequest, saved: MailDraftUpdated) {
  const key = mailDraftKeys.list(payload.accountId);
  const rows = qc.getQueryData<MailDraftSummary[]>(key);
  if (!rows) return;
  if (!rows.some((r) => r.id === id)) {
    void qc.invalidateQueries({ queryKey: key });
    return;
  }
  const row = rows.find((r) => r.id === id) as MailDraftSummary;
  const patched: MailDraftSummary = {
    ...row,
    to: payload.to,
    subject: payload.subject,
    preview: draftPreview(payload.bodyText),
    attachmentCount: saved.attachmentCount,
    updatedAt: saved.updatedAt,
  };
  // 서버 목록은 최근 저장 순이고 방금 저장한 행이 가장 새것이라 맨 위로 옮긴다(시각 문자열 비교는 소수 자릿수가 달라 쓰지 않는다).
  const next = [patched, ...rows.filter((r) => r.id !== id)];
  qc.setQueryData(key, next);
}

/**
 * 버린 임시저장을 같은 내용의 새 임시저장으로 되살린다(작성창 🗑·임시보관함 ⋯ 삭제의 「되돌리기」). 서버가 지운 임시저장의 업로드를
 * 24시간 임시로 풀어 두므로 같은 첨부로 다시 만들 수 있다. 실패하면 알리고 null.
 */
export async function restoreMailDraft(qc: QueryClient, payload: MailDraftSaveRequest): Promise<MailDraftCreated | null> {
  try {
    const r = await createMailDraft(payload);
    void invalidateMailDrafts(qc, payload.accountId);
    return r;
  } catch (e) {
    handleApiError(e, '되돌리지 못했어요');
    return null;
  }
}

/** 「임시저장을 버렸어요 · 되돌리기」 토스트 — 작성창과 임시보관함이 같은 모양으로 알린다. */
export function toastDraftDiscarded(onUndo: () => void) {
  toast('임시저장을 버렸어요', { action: { label: '되돌리기', onClick: onUndo } });
}

/**
 * 보내지 못한 임시보관을 다시 열 때 그 이유를 한 번 알린다(WP-1786). 연 순간의 상세 값을 쓴다 — 작성창의 자동 저장이 FAILED 흔적(sendState·sendError)을
 * 지우므로 뒤에 다시 받으면 이유가 없다. 멈춰서 결과를 모르는 행(UNKNOWN)은 이유 대신 보낸편지함을 확인하라고 알린다(알림과 같은 문구).
 */
function toastSendFailure(detail: MailDraftDetail) {
  if (detail.sendState !== 'FAILED' || !detail.sendError) return;
  toast.error(detail.sendError === 'UNKNOWN' ? MAIL_SEND_UNKNOWN : `보내지 못한 이유: ${detail.sendError}`);
}

/**
 * 보내는 중인 행(QUEUED·SENDING)이면 안내하고 true(WP-1786) — 호출부는 쓰기 창으로 열지 않고 'sending' 을 돌려준다(같은 메일이 두 번 나가지 않게).
 * 아직 대기(QUEUED)면 「메일 보냄」 토스트와 같은 「되돌리기」를 둔다 — 서버가 대기를 풀면 그 내용으로 쓰기 창을 연다(늦었으면 「이미 보냄」).
 * 이미 보내는 중(SENDING)이면 되돌릴 수 없어 보낸편지함 확인만 안내한다. 보내는 중이 아니면 아무것도 하지 않고 false.
 */
function toastIfSending(qc: QueryClient, detail: MailDraftDetail, reopen: OpenSentDraft): boolean {
  if (!isSendInFlight(detail)) return false;
  if (detail.sendState === 'QUEUED') {
    toastSendUndo(qc, detail.accountId, detail.id, reopen, {
      message: MAIL_ALREADY_SENDING,
      description: MAIL_ALREADY_SENDING_UNDO_REOPENS,
    });
  } else {
    toast(MAIL_ALREADY_SENDING, { description: MAIL_ALREADY_SENDING_CHECK_SENT });
  }
  return true;
}

/**
 * 임시저장 열기 결과 — 'sending' 이면 보내는 중인 행이라 열지 않고 안내만 했다(WP-1786). 새 창 페이지가 「불러오지 못함」 대신
 * 「보내는 중」 안내를 보이는 데 쓴다. 그 밖(열었거나·앞으로 가져왔거나·실패를 알렸다)은 undefined.
 */
export type OpenMailDraftResult = 'sending' | undefined;

/** 사이드바 「임시보관함」 배지 개수. */
export function useMailDraftCount(accountId: number | undefined) {
  return useQuery({
    queryKey: mailDraftKeys.count(accountId ?? 0),
    queryFn: () => getMailDraftCount(accountId as number),
    enabled: !!accountId,
  });
}

/**
 * 새 창을 빈 채로 열어 두고 임시저장을 받는 중인 id → 그 빈 창. 훅 인스턴스(목록·도크 등)마다 따로 두면 다른 곳에서 누른 같은 행을
 * 못 알아보므로, 같은 창 안에서 공유하게 모듈 수준에 둔다. 받기가 끝나 창 주소를 정하면 rememberMailComposePopout 으로 넘기고 여기서 뺀다.
 */
const fetchingDraftWindows = new Map<number, Window>();

/**
 * 임시저장을 작성창으로 연다 — 상세 패널이 아니라 작성창이 그 내용으로 열린다.
 * - 같은 임시저장이 이미 열려 있으면 새로 열지 않고 그 창을 앞으로 가져온다(최소화 해제). 그 임시저장이 보내는 중이면 함께 안내한다(WP-1786).
 *   force 면(충돌 「다시 불러오기」), detail 이면(되돌리기) 서버 내용으로 다시 연다.
 * - 받기에 실패하면 토스트로 알리고 지금 작성은 그대로 둔다.
 * - 답장·전달은 sourceMessageId 로 원본 상세를 받아 인용문을 다시 만든다. 원본을 받지 못하면(지워진 메일 등) 인용 없이 연다.
 * - 작성 방식 기본값(WP-1744): placement 는 openCompose 와 같은 뜻이다 — 임시보관함 행 클릭(새 작성)은 'default' 를 넘겨 기본값대로 열고,
 *   쓰던 작성을 다시 여는 길(보내기 실패 「다시 열기」·충돌 「다시 불러오기」·새 창 페이지)은 넘기지 않아 기본값을 쓰지 않는다.
 *   'default' 이고 기본값이 「새 창」이면(공급자가 데스크톱 앱 창에서만 WINDOW 를 준다) 클릭 처리 중에 빈 창을 먼저 열고(팝업 차단 회피),
 *   임시저장을 받아 존재를 확인한 뒤 beforeOpen 을 부르고 그 창 주소를 임시저장 주소로 옮긴다 — 작성창·저장 없이 새 창이 그것을 연다.
 *   받기 실패면 빈 창을 닫고 메인 창에서 알리며, 받는 동안 사용자가 빈 창을 닫았으면 메인 창에 열지 않고 끝낸다. 빈 창이 막히면 받아서 우측 하단에 열고 알린다.
 * - force: 열린 작성의 저장을 건너뛰고 같은 임시저장도 서버 내용으로 다시 연다(충돌 「다시 불러오기」).
 * - detail(WP-1786): 「메일 보냄 · 되돌리기」가 cancel-send 로 돌려받은 상세 — 다시 받지 않고 그것으로 연다. 본문이 보내기 요청 형태라
 *   composeFromDraft 가 인용문을 떼고 붙여 넣은 이미지를 업로드 경로로 되돌린다(sent). 쓰던 작성을 다시 여는 길이라 placement 는 넘기지 않는다.
 * - 보내지 못한 임시보관(WP-1786, sendState FAILED)이면 연 뒤 그 이유를 토스트로 한 번 알린다(toastSendFailure). 새 창 기본값으로 여는 길은
 *   새 창 페이지가 이 훅으로 다시 열며 그 창에서 알린다.
 * - 보내는 중인 행(WP-1786, QUEUED·SENDING — 실패 알림·딥링크·새 창 주소로 들어온 경우)은 쓰기 창으로 열지 않는다. 열어 다시 보내면
 *   같은 메일이 두 번 나갈 수 있다 — 「이 메일은 이미 보내는 중이에요」로 알리고(아직 대기면 「되돌리기」) 'sending' 을 돌려준다.
 *   되돌리기가 넘긴 detail 은 대기를 푼 뒤의 상세라 해당하지 않는다.
 */
export function useOpenMailDraft() {
  const qc = useQueryClient();
  const { openCompose, focusDraft, isDraftSendPaused, isMovingToWindow, getComposeDefault } = useMailCompose();
  // 공급자의 함수들은 안정적이라 open 도 렌더마다 바뀌지 않는다 — 호출부(새 창 페이지 등)가 deps 에 넣어도 효과·메모가 다시 돌지 않는다.
  // 이름 붙인 함수식이라 보내는 중 안내의 「되돌리기」(reopen)가 선언 순서 걱정 없이 자기 자신을 다시 부른다.
  const open = useCallback(
    async function openDraft(
      id: number,
      opts: { force?: boolean; placement?: ComposePlacement; beforeOpen?: () => void; detail?: MailDraftDetail } = {},
    ): Promise<OpenMailDraftResult> {
      // 보내는 중 안내의 「되돌리기」가 대기를 푼 상세로 다시 이 함수를 부른다(쓰던 작성을 다시 여는 길이라 placement 없음).
      const reopen: OpenSentDraft = (draftId, detail) => openDraft(draftId, { detail });
      // 빈 창을 열고 임시저장을 받는 중에 같은 행을 다시 눌렀다 — 아직 쓰는 중이 아니라 안내 없이 그 빈 창만 앞으로 가져온다(받기가 실패할 수 있다).
      // force(충돌 「다시 불러오기」)는 서버 내용으로 다시 여는 것이라 조회 중이라는 이유로 건너뛰지 않는다.
      const fetching = opts.force ? undefined : fetchingDraftWindows.get(id);
      if (fetching && !fetching.closed) {
        try {
          fetching.focus();
        } catch {
          /* 창 전환을 막았다 — 조용히 둔다 */
        }
        return;
      }
      // 받는 중 표시의 창이 이미 닫혔다 — 앞 호출은 닫힌 줄 알고 곧 그만둔다. 표시를 빼고 아래로 이어 새 빈 창을 연다.
      if (fetching) fetchingDraftWindows.delete(id);
      // 이 창이 새 창으로 옮긴 임시저장이 아직 그 창에서 쓰이고 있으면(WP-1535) 두 번째 편집기를 열지 않고 그 창을 앞으로 가져온다.
      // 브라우저가 창 전환을 막을 수 있어(성공 여부를 알 수 없다) 어디서 쓰는 중인지 토스트로도 알린다.
      const popout = liveMailComposePopout(id);
      if (popout) {
        try {
          popout.focus();
        } catch {
          /* 창 전환을 막았다 — 아래 토스트가 알린다 */
        }
        toast('이 메일은 새 창에서 쓰는 중이에요');
        return;
      }
      // 기본값 「새 창」으로 옮기는 중인 임시저장 — 감춰진 작성창을 올려 봐야 아무 일도 없어 보이므로 열고 있다고만 알린다.
      if (!opts.force && isMovingToWindow(id)) {
        toast('새 창을 여는 중이에요');
        return;
      }
      // 이미 열린 같은 임시저장 — 앞으로 가져온다. 되돌리기가 넘긴 상세(detail)면 건너뛰고 아래에서 그 내용으로 바꿔 연다(WP-1786 코드 리뷰 —
      // 앞으로 가져오기만 하면 보내는 중으로 멈춘 작성이 그대로 남아 되돌린 내용이 보이지 않는다). 바꿀 때 openCompose 가 앞 작성의 남은 변경을 먼저
      // 저장한다(보내는 중으로 멈춘 뒤 쓴 것은 새 임시저장으로 — useMailDraftAutosave flushSession).
      if (!opts.force && !opts.detail && focusDraft(id)) {
        // 열린 작성이 다른 곳에서 보내는 중이라 멈춰 있다 — 앞으로 가져오기만 하면 되돌릴 길이 없어, 받아 보고 아직 보내는 중이면 열지 않은 경우와
        // 같이 안내한다(대기 중이면 「되돌리기」). 멈추지 않은 작성은 쓰던 내용 그대로 앞으로 가져오기만 한다(다시 받지 않는다). 받지 못해도 그렇다.
        if (!isDraftSendPaused(id)) return;
        const current = await qc.fetchQuery(mailDraftQuery(id)).catch(() => null);
        return current && toastIfSending(qc, current, reopen) ? 'sending' : undefined;
      }
      let { placement } = opts;
      // 기본값 「새 창」 — 받기를 기다리면 클릭의 사용자 활성화가 지나 팝업이 막히므로, 지금 빈 창만 먼저 연다(주소는 받은 뒤에 정한다).
      let blocked = false;
      let blankWin: Window | null = null;
      if (placement === 'default' && getComposeDefault() === 'WINDOW') {
        blankWin = openMailComposeWindow();
        if (!blankWin) {
          // 막혔으면 다시 창을 열지 않고 우측 하단으로(default-inline — 읽기 창 기본값이 아니니 곧 우측 하단).
          blocked = true;
          placement = 'default-inline';
        } else {
          // 받는 동안에도 같은 행을 다시 누르면 두 번째 창을 열지 않고 이 창을 앞으로 가져오게, 창을 연 바로 뒤에 받는 중으로 적어 둔다.
          // 받기가 성공하기 전에는 「쓰는 중」으로 기억하지 않는다 — 실패하면 그 안내가 거짓이 된다.
          fetchingDraftWindows.set(id, blankWin);
        }
      }
      if (blankWin) {
        const win = blankWin;
        try {
          let fetched: MailDraftDetail;
          try {
            fetched = await qc.fetchQuery(mailDraftQuery(id));
          } catch (e) {
            // 지워진 임시저장 등 — 빈 창은 닫는다(새 창 안에서 실패하지 않게). 이 호출의 빈 창을 사용자가 이미 닫았거나 다른 호출이 그 자리를
            // 넘겨받았으면(맵이 다른 창을 가리킨다) 그만둔 일의 늦은 실패라 알리지 않는다. 아니면 메인 창에서 알린다.
            const superseded = win.closed || fetchingDraftWindows.get(id) !== win;
            win.close();
            if (!superseded) handleApiError(e, '임시저장을 불러오지 못했어요');
            return;
          }
          // 받는 동안 사용자가 빈 창을 닫았다 — 그만둔 것이라 메인 창에 열지 않는다(↗ 와 같은 규칙).
          if (win.closed) return;
          // 보내는 중인 행 — 빈 창을 닫고 메인 창에서 알린다(새 창에 쓰기 창을 열지 않는다).
          if (toastIfSending(qc, fetched, reopen)) {
            win.close();
            return 'sending';
          }
          // 받기가 끝났다 — 이제부터 그 창이 쓰는 중이다(받는 중 표시는 아래 finally 가 뺀다).
          rememberMailComposePopout(id, win);
          opts.beforeOpen?.();
          win.location.href = mailComposeWindowUrl(id, { opener: MAIL_COMPOSE_WINDOW_ID });
        } finally {
          // 어느 길로 끝나든 받는 중 표시가 이 창 것이면 뺀다(실패 뒤 다시 누르면 다시 연다. 다른 호출이 넘겨받았으면 건드리지 않는다).
          if (fetchingDraftWindows.get(id) === win) fetchingDraftWindows.delete(id);
        }
        return;
      }
      try {
        // 되돌리기가 넘긴 상세는 서버 최신이다 — 캐시에 두고 그대로 쓴다.
        if (opts.detail) qc.setQueryData(mailDraftKeys.detail(id), opts.detail);
        const detail = opts.detail ?? (await qc.fetchQuery(mailDraftQuery(id)));
        if (!opts.detail && toastIfSending(qc, detail, reopen)) return 'sending';
        const needSource = detail.sourceMessageId != null && !detail.quoteRemoved;
        const source = needSource ? await qc.fetchQuery(mailMessageQuery(detail.sourceMessageId)).catch(() => null) : null;
        // 충돌 다시 불러오기는 지금 창의 내용을 버리고 서버 내용으로 바꾸는 것이라 앞 작성의 저장(flush)을 건너뛴다.
        // beforeOpen 은 받아 온 뒤 바꾸기 직전에 부른다 — 받지 못하면 지금 작성을 그대로 둔다(충돌 다시 불러오기가 세션을 끝내는 시점).
        opts.beforeOpen?.();
        openCompose(composeFromDraft(detail, source, { sent: !!opts.detail }), { skipSave: opts.force, placement });
        toastSendFailure(detail);
        if (blocked) toastMailComposePopupBlocked();
      } catch (e) {
        handleApiError(e, '임시저장을 불러오지 못했어요');
      }
    },
    [qc, openCompose, focusDraft, isDraftSendPaused, isMovingToWindow, getComposeDefault],
  );
  return open;
}

/**
 * 임시보관함 ⋯ 메뉴의 삭제 — 지우기 전에 상세를 받아 두었다가 「되돌리기」로 같은 내용을 새로 만든다(id 는 새로 받는다).
 * 그 임시저장이 작성창에 열려 있으면 지우기가 성공한 뒤 저장 없이 닫는다(쓰던 변경은 함께 버려진다). 실패하면 작성창과 아직 저장하지 않은
 * 변경을 그대로 둔다. 지우는 사이 작성창이 PUT 해 404 를 받으면 잠깐 「다른 곳에서 보냈거나 버린 메일」로 보였다가 닫힌다.
 */
export function useDeleteMailDraft(accountId: number | undefined) {
  const qc = useQueryClient();
  const { closeDraft } = useMailCompose();
  return useMutation({
    mutationFn: async (row: MailDraftSummary) => {
      const detail = await qc.fetchQuery(mailDraftQuery(row.id));
      await deleteMailDraft(row.id);
      return { detail, preview: row.preview };
    },
    onSuccess: ({ detail, preview }) => {
      closeDraft(detail.id);
      if (accountId != null) void invalidateMailDrafts(qc, accountId);
      qc.removeQueries({ queryKey: mailDraftKeys.detail(detail.id) });
      toastDraftDiscarded(() => void restoreMailDraft(qc, savePayloadFromDetail(detail, preview)));
    },
    onError: (e) => handleApiError(e, '임시저장을 지우지 못했어요'),
  });
}
