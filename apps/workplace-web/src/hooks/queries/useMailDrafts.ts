// 메일 임시저장(WP-577) TanStack Query 훅 — 임시보관함 목록·개수, 목록에서 작성창으로 열기, 목록에서 삭제(되돌리기).
// 작성창의 자동 저장은 저장 순서를 직접 이어 붙여야 해서(POST 뒤 PUT) useMutation 이 아니라 useMailDraftAutosave 가 api 를 직접 부른다.
import { type QueryClient, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { type ComposePlacement, useMailCompose } from '@/components/mail/MailComposeContext';
import { handleApiError } from '@/lib/api-error';
import {
  forgetMailComposePopout,
  liveMailComposePopout,
  MAIL_COMPOSE_WINDOW_ID,
  mailComposeWindowUrl,
  openMailComposeWindow,
  rememberMailComposePopout,
  toastMailComposePopupBlocked,
} from '@/lib/mailComposeChannel';
import { composeFromDraft, draftPreview, savePayloadFromDetail } from '@/lib/mailDraftCompose';

import { createMailDraft, deleteMailDraft, getMailDraft, getMailDraftCount, listMailDrafts } from '../../api/mailDrafts';
import type { MailDraftCreated, MailDraftSaveRequest, MailDraftSummary, MailDraftUpdated } from '../../types/mailDraft';
import { invalidateMailDrafts, mailDraftKeys } from './mailDraftKeys';
import { mailMessageQuery } from './useMailMessages';

// 키·무효화는 순수 파일(mailDraftKeys)에 두고 여기서 다시 내보낸다 — 발송 훅이 이 파일의 무거운 의존 없이 쓰게.
export { invalidateMailDrafts, mailDraftKeys };

/** 임시저장 상세 쿼리 — 열기·지우기(되돌리기용 사본) 모두 서버 최신을 받는다(staleTime 0). */
const mailDraftQuery = (id: number) =>
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

/** 사이드바 「임시보관함」 배지 개수. */
export function useMailDraftCount(accountId: number | undefined) {
  return useQuery({
    queryKey: mailDraftKeys.count(accountId ?? 0),
    queryFn: () => getMailDraftCount(accountId as number),
    enabled: !!accountId,
  });
}

/**
 * 임시저장을 작성창으로 연다 — 상세 패널이 아니라 작성창이 그 내용으로 열린다.
 * - 같은 임시저장이 이미 열려 있으면 새로 열지 않고 그 창을 앞으로 가져온다(최소화 해제). force 면(충돌 「다시 불러오기」) 서버 내용으로 다시 연다.
 * - 받기에 실패하면 토스트로 알리고 지금 작성은 그대로 둔다.
 * - 답장·전달은 sourceMessageId 로 원본 상세를 받아 인용문을 다시 만든다. 원본을 받지 못하면(지워진 메일 등) 인용 없이 연다.
 * - 작성 방식 기본값(WP-1744): placement 는 openCompose 와 같은 뜻이다 — 임시보관함 행 클릭(새 작성)은 'default' 를 넘겨 기본값대로 열고,
 *   쓰던 작성을 다시 여는 길(보내기 실패 「다시 열기」·충돌 「다시 불러오기」·새 창 페이지)은 넘기지 않아 기본값을 쓰지 않는다.
 *   'default' 이고 기본값이 「새 창」이면(공급자가 데스크톱 앱 창에서만 WINDOW 를 준다) 클릭 처리 중에 빈 창을 먼저 열고(팝업 차단 회피),
 *   임시저장을 받아 존재를 확인한 뒤 beforeOpen 을 부르고 그 창 주소를 임시저장 주소로 옮긴다 — 작성창·저장 없이 새 창이 그것을 연다.
 *   받기 실패면 빈 창을 닫고 메인 창에서 알리며, 받는 동안 사용자가 빈 창을 닫았으면 메인 창에 열지 않고 끝낸다. 빈 창이 막히면 받아서 우측 하단에 열고 알린다.
 * - force: 열린 작성의 저장을 건너뛰고 같은 임시저장도 서버 내용으로 다시 연다(충돌 「다시 불러오기」).
 */
export function useOpenMailDraft() {
  const qc = useQueryClient();
  const { openCompose, focusDraft, isMovingToWindow, getComposeDefault } = useMailCompose();
  return async (id: number, opts: { force?: boolean; placement?: ComposePlacement; beforeOpen?: () => void } = {}) => {
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
    if (!opts.force && focusDraft(id)) return;
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
        // 받는 동안에도 같은 행을 다시 누르면 두 번째 창을 열지 않고 이 창을 앞으로 가져오게, 창을 연 바로 뒤에 기억한다.
        rememberMailComposePopout(id, blankWin);
      }
    }
    if (blankWin) {
      const win = blankWin;
      try {
        await qc.fetchQuery(mailDraftQuery(id));
      } catch (e) {
        // 지워진 임시저장 등 — 빈 창은 닫고 메인 창에서 알린다(새 창 안에서 실패하지 않게). 기억도 지워 다시 누르면 다시 연다.
        forgetMailComposePopout(id);
        win.close();
        handleApiError(e, '임시저장을 불러오지 못했어요');
        return;
      }
      // 받는 동안 사용자가 빈 창을 닫았다 — 그만둔 것이라 메인 창에 열지 않는다(↗ 와 같은 규칙).
      if (win.closed) {
        forgetMailComposePopout(id);
        return;
      }
      opts.beforeOpen?.();
      win.location.href = mailComposeWindowUrl(id, { opener: MAIL_COMPOSE_WINDOW_ID });
      return;
    }
    try {
      const detail = await qc.fetchQuery(mailDraftQuery(id));
      const needSource = detail.sourceMessageId != null && !detail.quoteRemoved;
      const source = needSource ? await qc.fetchQuery(mailMessageQuery(detail.sourceMessageId)).catch(() => null) : null;
      // 충돌 다시 불러오기는 지금 창의 내용을 버리고 서버 내용으로 바꾸는 것이라 앞 작성의 저장(flush)을 건너뛴다.
      // beforeOpen 은 받아 온 뒤 바꾸기 직전에 부른다 — 받지 못하면 지금 작성을 그대로 둔다(충돌 다시 불러오기가 세션을 끝내는 시점).
      opts.beforeOpen?.();
      openCompose(composeFromDraft(detail, source), { skipSave: opts.force, placement });
      if (blocked) toastMailComposePopupBlocked();
    } catch (e) {
      handleApiError(e, '임시저장을 불러오지 못했어요');
    }
  };
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
