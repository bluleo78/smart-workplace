// 메일 작성창. 보내기 = useSendMail. MailComposeProvider 의 draft 가 있으면 렌더, 없으면 null.
// - 데스크톱: Gmail식 우하단 작은 창. 최소화·읽기 창 전환(WP-1743)/닫기 — 「읽기 창으로」를 누르면 메일 읽기 자리 슬롯 안에서 그려진다.
// - 모바일: 다른 메일 앱처럼 처음부터 화면 전체 작성 화면(WP-583). 상단 바 [✕] 제목 … [📎 파일 첨부] [➤ 보내기].
// - 첨부(WP-574): 📎(데스크톱은 보내기 옆, 모바일은 상단 바)·창 위로 끌어다 놓기 → 바로 올리고 본문 아래 칩으로 보인다.
// - 임시저장(WP-577): 쓰는 동안 1.5초마다 자동 저장하고 상태를 제목 옆(모바일은 제목 아래)에 보인다. ✕·뒤로가기는 묻지 않고
//   남은 저장을 마친 뒤 닫는다. 버리기(🗑)는 임시저장을 지우고 「되돌리기」 토스트를 띄운다.
// - 서명(WP-1517): 처음 여는 작성은 설정(새 메일·답장·전달 스위치)대로 본문 끝에 빈 줄 + 서명을 넣는다. 본문은 서명 조회를 기다리지 않고 바로 그리고,
//   서명이 늦게 오면 아직 손대지 않은 본문에만 넣는다(메일 화면이 미리 받아 두므로 보통은 처음 본문에 들어 있다).
//   펜(✒, 데스크톱은 📎 왼쪽·모바일은 상단 바 🗑 와 📎 사이)으로 빼고 넣는다. 보낼 때 서명 이미지는 작성창 업로드 사본으로 바꿔 cid 로 보낸다.
// - 작성 방식 기본값(WP-1744): 새 작성은 설정대로 읽기 창·우측 하단에 열리고, 「새 창」이면 openCompose 가 미리 연 창으로 옮긴다.
// - 새 창으로 열기(WP-1535): 데스크톱 머리줄 ↗ 가 지금 작성을 임시저장한 뒤 독립 브라우저 창(/mail/compose?draftId=N)으로 옮긴다.
//   그 창에서는 같은 작성창을 popout 모드로 그린다 — 창 전체를 채우고, 닫기·버리기·보내기는 서버 작업이 끝난 뒤 onDone 으로 페이지에 넘긴다(페이지가 창을 닫는다).

import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, Maximize2, Minimize2, Minus, Paperclip, PenLine, Send, Trash2, X } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { uploadComposeAttachment } from '@/api/mailMessages';
import { stageSignatureImages } from '@/api/mailSignature';
import { useAssistant } from '@/components/ai/AIAssistantContext';
import { AiContent } from '@/components/ai/AiContent';
import { AiIcon } from '@/components/ai/AiIcon';
import { inertPageArea } from '@/components/ai/aiPanelSurface';
import { captureScroll, restoreScroll } from '@/components/layout/scrollSnapshot';
import { mobileBackButtonClass, mobileDetailBarClass } from '@/components/mobile/headerClass';
import { HeaderIconAction } from '@/components/mobile/HeaderIconAction';
import { isKeyboardEditable } from '@/components/mobile/useVisualViewport';
import { useMailAccounts } from '@/hooks/queries/useMailAccounts';
import { restoreMailDraft, toastDraftDiscarded, useOpenMailDraft } from '@/hooks/queries/useMailDrafts';
import { useMailSignature } from '@/hooks/queries/useMailSignature';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import { useComposerFileDrop } from '@/hooks/useComposerFileDrop';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useMailComposeAttachments } from '@/hooks/useMailComposeAttachments';
import { useMailDarkHtml } from '@/hooks/useMailDarkHtml';
import { type DraftFlushResult, type DraftSnapshot, hasUnsavedDraft, useMailDraftAutosave } from '@/hooks/useMailDraftAutosave';
import { useSheetHistory } from '@/hooks/useSheetHistory';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { extractApiError } from '@/lib/api-error';
import { withComposerPreviewStyle } from '@/lib/composerPreviewHtml';
import { hasLiveStateMark } from '@/lib/historyParam';
import { type ComposeAttachment, quoteInlineBytes } from '@/lib/mailComposeAttachments';
import {
  MAIL_COMPOSE_WINDOW_ID,
  type MailComposeWindowEvent,
  mailComposeWindowUrl,
  openMailComposeWindow,
  rememberMailComposePopout,
  toastMailComposePopupBlocked,
} from '@/lib/mailComposeChannel';
import { buildDraftSavePayload } from '@/lib/mailDraftCompose';
import { pastedImageSrc, toSendablePastedImages, uploadIdsWithBodyImages } from '@/lib/mailPastedImages';
import { parseRecipientInput } from '@/lib/mailRecipients';
import {
  appendSignature,
  htmlToPlainText,
  replaceBodyKeepingSignature,
  replaceSignatureImageSrcs,
  shouldAutoInsertSignature,
  signatureImageIds,
  splitSignature,
} from '@/lib/mailSignature';
import { cn } from '@/lib/utils';

import { useCoachDraft, useSendMail } from '../../hooks/queries/useMailMessages';
import type { CoachingNote, MailSendRequest } from '../../types/mailMessage';
import { SandboxedHtmlFrame } from '../SandboxedHtmlFrame';
import { AiDraftBar, AiDraftChip, AiDraftPanel, AiDraftSkeleton, AiDraftToolbarButton } from './MailAiDraft';
import { MailComposeAttachmentChips } from './MailComposeAttachmentChips';
import { type ComposeDraft, useMailCompose, useMailComposeLayout, useMailComposeWindowMove } from './MailComposeContext';
import { MailComposeDropOverlay } from './MailComposeDropOverlay';
import { MailComposer, type MailComposerHandle, type MailComposerLayout } from './MailComposer';
import { MailDraftSaveStatus } from './MailDraftSaveStatus';
import { MailQuoteBlock } from './MailQuoteBlock';
import { MailRecipientInput } from './MailRecipientInput';
import { useMailAiDraft } from './useMailAiDraft';

/**
 * 작성창 바깥 틀 배치 — 에디터 배치(MailComposerLayout)에 메일 읽기 자리(pane, WP-1743)를 더한 것.
 * pane 은 바깥 틀(패널·본문 칸·머리줄)만 다르고 편집기는 넓은 자리(fill) 규칙을 그대로 쓰므로, 편집기에는 fill 로 넘긴다.
 */
type MailComposeFrameLayout = MailComposerLayout | 'pane';

/**
 * 작성창 껍데기 — 모바일 화면 전체 / 데스크톱 우하단 작은 창 / 메일 읽기 자리(WP-1743). 배치는 MailComposeFrameLayout.
 * - mobile: 탭바도 덮는다. 가상 키보드가 열리면 보이는 영역(--vv-top ~ 아래 --kb-inset)만 차지해 상단 바(보내기)와
 *   하단 서식 버튼이 모두 키보드 밖에 남는다(WP-154 — iOS 는 키보드가 열리며 보이는 영역이 아래로 밀리기도 한다).
 * - dock·pane 은 데스크톱 셸 전용이라 키보드 변수(--vvh·--kb-inset — 모바일 셸만 쓴다)에 기대지 않는다.
 * - pane: 읽기 자리 슬롯(display:contents) 안에서 그려진다 — 패널만 읽기 자리 박스를 그대로 채우고, 테두리·모서리·그림자
 *   없이 페이지 일부로 보인다. 뒤 목록을 잠그지 않으므로 배경·Esc·대화상자 처리가 없다(WP-1743).
 * - fill: 새 창(popout, WP-1535) 전용 배치 — 브라우저 창 전체를 채운다(WINDOW_PANEL_CLASS). 앱 안에서는 fill 이 되지 않는다.
 * 모든 배치가 위치 기준(fixed 또는 relative)을 가진다 — 끌어다 놓기 겹침(MailComposeDropOverlay, absolute inset-0)이 패널을 채운다.
 */
/** 새 창(popout, WP-1535) 껍데기 — 브라우저 창 전체를 채운다. */
const WINDOW_PANEL_CLASS = 'fixed inset-0 flex flex-col bg-background';

const PANEL_CLASS: Record<MailComposeFrameLayout, string> = {
  mobile: 'fixed inset-x-0 top-[var(--vv-top,0px)] bottom-[var(--kb-inset,0px)] z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]',
  // 새 창 — 앱 셸이 없으니 겹칠 것도, 가릴 뒤 페이지도 없다.
  fill: WINDOW_PANEL_CLASS,
  // 읽기 창(WP-1743) — 읽기 자리 박스를 꽉 채운다(h-full·w-full). 포커스 링 없이 페이지 한 부분처럼 보이게 outline-none.
  // relative — 드롭 겹침이 엉뚱한 조상이 아니라 이 패널을 기준으로 펼쳐지게 한다.
  pane: 'relative flex h-full min-h-0 w-full flex-col bg-background outline-none',
  dock: 'fixed bottom-0 right-4 z-50 flex w-[32rem] max-w-[calc(100vw-2rem)] flex-col rounded-t-lg border border-b-0 bg-background shadow-2xl',
};

/**
 * 새 창 모드 손잡이 — 새 창 페이지가 넘긴다. 작성이 끝나면(보냄·닫으며 저장·버림) 서버 작업이 끝난 뒤 한 번 부른다.
 * kind 는 메인 창에 알릴 이유, accountId 는 다시 받을 목록의 계정, sentDraftId 는 보냈을 때 대기열에 올라간 행 id(WP-1786 — 메인 창 「되돌리기」의 키).
 */
export interface MailComposePopout {
  onDone: (kind: MailComposeWindowEvent, accountId: number, sentDraftId?: number) => void;
  /**
   * 손대지 않은 작성을 새 창으로 옮기려 방금 만든 임시저장인가 — 새 창에서도 손대지 않고 닫으면 그 임시저장을 지운다
   * (앱 안 작성창은 빈 작성을 닫을 때 임시저장을 만들지 않으므로 같은 결과가 되게).
   */
  fresh?: boolean;
}

/** 본문 영역 — 모바일은 하단 고정 서식 버튼(44px+여백+홈 인디케이터 안전영역)만큼 아래 여백, 읽기 창·새 창은 남은 높이를 채움, 작은 창은 화면 높이 안으로 제한. */
const FILL_BODY_CLASS = 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3';
const BODY_CLASS: Record<MailComposeFrameLayout, string> = {
  // 모바일 아래 여백은 서식 줄 높이(3.5rem)에 0.5rem 을 더해 마지막 첨부 칩과 서식 줄 사이를 띄운다.
  mobile: 'flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 pb-[calc(4rem+env(safe-area-inset-bottom))]',
  fill: FILL_BODY_CLASS,
  // 읽기 창(WP-1743) — 새 창과 같은 값(남은 높이를 채운다). 한 곳(FILL_BODY_CLASS)만 고치면 둘 다 바뀐다.
  pane: FILL_BODY_CLASS,
  dock: 'flex max-h-[min(75vh,calc(100vh-3rem))] flex-col gap-2 overflow-y-auto p-3',
};

/** 모바일 상단 바 제목 — 전달(인용문이 전달용) / 회신(답장 대상 있음) / 새 메일. */
function composeTitle(draft: ComposeDraft): string {
  if (draft.mode === 'forward') return '전달';
  if (draft.mode === 'reply') return '회신';
  return '새 메일';
}

/**
 * 제목 한 줄(받는사람·참조·숨은참조는 칩 입력 MailRecipientInput, WP-945). 모바일은 칸 앞에 이름표를 붙이고(빈 새 메일에서도 칸이 구분되게, WP-583),
 * 데스크톱은 작은 창 공간을 아끼려 자리표시자만 쓴다.
 */
function FieldRow({
  label,
  mobile,
  testId,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  mobile: boolean;
  testId: string;
  value: string;
  onChange: (v: string) => void;
  /** 입력 길이 상한 — 서버 상한(제목 500자)을 넘겨 저장·발송이 거절되지 않게 입력에서 막는다. */
  maxLength?: number;
}) {
  return (
    <div className={cn('flex items-center gap-2 border-b focus-within:border-primary', mobile ? 'py-3' : 'pb-2')}>
      {mobile && (
        <label htmlFor={testId} className="w-16 shrink-0 text-sm text-muted-foreground">
          {label}
        </label>
      )}
      <input
        id={testId}
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        placeholder={mobile ? undefined : label}
        className={cn('min-w-0 flex-1 bg-transparent outline-none', mobile ? 'text-[15px]' : 'text-sm')}
      />
    </div>
  );
}

/** 제목 길이 상한 — 서버 MailComposeLimits.MAX_SUBJECT_LENGTH(임시저장·발송 공통)와 같은 값. */
const MAIL_SUBJECT_MAX = 500;

/** 붙여 넣은 이미지 올리기(WP-947) — 일반 첨부와 같은 작성창 업로드로 올리고 id 만 쓴다(칩으로는 보이지 않는다). */
const uploadPastedImage = (file: File) => uploadComposeAttachment(file).then((res) => res.id);

/** 모바일 작성 화면의 히스토리 표식 키 — 서명 설정으로 옮겨 갈 때 그 항목을 설정 화면으로 바꾼다(MobileComposeHistory 와 같은 값). */
const MOBILE_COMPOSE_HISTORY_KEY = 'mailCompose';

/** 버림 확인이 없어졌으므로(WP-577 — back 은 자동 저장 후 닫기) 막힌 back 처리가 쓰이지 않는다. */
const noop = () => {};

/**
 * 모바일 작성 화면은 페이지처럼 보이므로 시스템 back 이 작성 화면을 닫게 히스토리 항목 하나에 묶는다(WP-222 공용 훅).
 * back 은 ✕ 와 같이 묻지 않고 남은 임시저장을 마친 뒤 닫는다(WP-577) — 그래서 hasContent 를 늘 false 로 넘겨 막지 않는다.
 * 열려 있을 때만 마운트한다 — 훅이 위치(useLocation)를 구독하므로, 작성창 본체에 두면 모든 페이지 이동마다 작성창이 다시 렌더된다.
 */
function MobileComposeHistory({ onClose }: { onClose: () => void }) {
  useSheetHistory({ historyKey: MOBILE_COMPOSE_HISTORY_KEY, open: true, hasContent: false, onClose, onBlockedBack: noop });
  return null;
}

/**
 * 작성창 — AI 컨텍스트에서 "전체 화면인가" 하나만 읽어 본체에 넘긴다.
 * 컨텍스트는 옆 패널 폭(드래그 중 매 프레임)·프롬프트 등으로 자주 바뀌므로, 본체(에디터·코칭 미리보기)는 memo 로 그 값이 바뀔 때만 다시 그린다.
 * 배치(size)·슬롯(slotEl)은 배치 컨텍스트(useMailComposeLayout)에서 직접 읽는다 — 호스트를 어디로 옮길지 여기서 정하기 때문이다(WP-1743).
 *
 * 호스트 이동(포털 금지) — React 트리에서는 호스트가 늘 주차 칸 안에 있고, DOM 만 슬롯(읽기 자리) 사이로 옮긴다.
 * createPortal 을 쓰면 컨테이너가 바뀌는 순간 React 가 서브트리를 재마운트해 편집기·본문이 날아간다(설계 §접근 방식 A·B).
 */
export function MailComposeDock({ popout }: { popout?: MailComposePopout } = {}) {
  const aiFullscreen = useAssistant().mode === 'fullscreen';
  const { size, setSize, slotEl } = useMailComposeLayout();
  // 좁은 폭(폭 < 1024) 판정 — 접기 효과가 쓴다(본체의 isMobile 은 새 창 제외 판정이라 여기서 따로 읽는다).
  const isMobile = useIsMobile();
  // 주차 칸(기본 자리)·호스트 — 둘 다 display: contents 라 레이아웃에 끼지 않고, 슬롯 안에서도 패널만 박스를 채운다.
  const parkingRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // 슬롯은 메일 화면에 있는 한 늘 등록돼 있다(「읽기 창으로」 단추가 슬롯 유무로 쓸 수 있음을 가르기 때문)라,
  // 호스트는 「읽기 창」 상태일 때만 그 안으로 옮긴다. 이미 같은 부모면 옮기지 않는다(중복 이동 방지).
  useLayoutEffect(() => {
    const host = hostRef.current;
    const parking = parkingRef.current;
    if (!host || !parking) return;
    const target = size === 'pane' && slotEl ? slotEl : parking;
    if (host.parentNode !== target) {
      // 옮기기 전 포커스가 호스트 안(예: 본문 편집기)에 있었으면 옮긴 뒤 되돌린다 — DOM 을 떼었다 붙이면 브라우저가 포커스를 body 로 풀기 때문.
      // 옮긴 뒤에도 그 요소가 연결돼 있을 때만 돌린다(「읽기 창으로」 단추처럼 이동과 함께 사라지는 요소는 그냥 둔다).
      // 스크롤도 같다 — 떼었다 붙이면 하위 스크롤 오프셋이 0 으로 돌아가므로 옮기기 전 잡아 두었다 되돌린다(WP-1488 셸 전환과 같은 도우미).
      const active = document.activeElement;
      const hadFocus = active instanceof HTMLElement && host.contains(active) ? active : null;
      const scroll = captureScroll(host);
      target.appendChild(host);
      restoreScroll(scroll);
      if (hadFocus?.isConnected && document.activeElement !== hadFocus) hadFocus.focus({ preventScroll: true });
    }
    // cleanup — 호스트를 주차 칸으로 되돌린다.
    // React 은 호스트의 부모를 트리 기준(주차 칸)으로 보고 지우기 때문에, 슬롯에 있는 채로 이 컴포넌트가 사라지면
    // removeChild(주차 칸, 호스트) 가 DOM 예외를 던진다. layout cleanup 은 자식 DOM 을 떼기 전에 돌기 때문에 이 자리가 유일한 안전 지점이다.
    // 읽기 창 → 우측 하단처럼 슬롯을 떠나는 이동은 이 cleanup 이 하므로 여기서도 스크롤을 잡았다 되돌린다.
    return () => {
      if (host.parentNode === parking) return;
      const scroll = captureScroll(host);
      parking.appendChild(host);
      restoreScroll(scroll);
    };
  }, [size, slotEl]);
  // 접기 규칙(설계 결정 5) — 읽기 창(pane) 상태에서 조건이 맞으면 그 자리에서 접는다(우선순위 없음, 각 조건이 곧 접기).
  // dock·min 은 이미 접힌 자리라 건드리지 않는다 — 우측 하단 작성까지 좁은 폭마다 최소화로 숨길 일은 없다.
  // AI 전체 화면은 layout 만 바꾸고 size 를 pane 에 두면 MailInboxPage 가 읽기 자리 상세를 계속 감춰 빈 읽기 자리가 남고,
  // 메일 화면 밖에서는 pane 패널이 주차 칸 자리에 그대로 남아(WP-1743 Task 1 리뷰 Important 1) — 두 경우 모두 size 레벨에서 접는다.
  useEffect(() => {
    if (size !== 'pane') return;
    // 폭 < 1024(모바일 셸) · 슬롯 소실(메일 화면 밖) → 우측 하단 최소화
    if (isMobile || slotEl == null) setSize('min');
    // AI 전체 화면 → 우측 하단 작은 창(옛 fill 이 dock 으로 접히던 규칙을 이어받는다)
    else if (aiFullscreen) setSize('dock');
  }, [size, isMobile, slotEl, aiFullscreen, setSize]);
  return (
    <div ref={parkingRef} style={{ display: 'contents' }} data-compose-parking>
      <div ref={hostRef} style={{ display: 'contents' }} data-compose-host>
        <MailComposeDockBody aiFullscreen={aiFullscreen} popout={popout} />
      </div>
    </div>
  );
}

/** 작성창 본체. draft 없으면 렌더 안 함. popout 이면 새 창(WP-1535) 모드. */
const MailComposeDockBody = memo(function MailComposeDockBody({ aiFullscreen, popout }: { aiFullscreen: boolean; popout?: MailComposePopout }) {
  const { draft, openCompose, closeCompose, closeInstance, clearQuote, bindDraftId, unbindDraftId, setComposeHandlers } = useMailCompose();
  const { size, setSize, slotEl, initialPlacementFor } = useMailComposeLayout();
  const { windowMoveFor, takePendingWindow, rearmPendingWindow, endWindowMove } = useMailComposeWindowMove();
  const qc = useQueryClient();
  const openDraft = useOpenMailDraft();
  // 「메일 보냄 · 되돌리기」(WP-1786) — 되돌리면 돌려받은 상세로 이 창에 다시 연다. 새 창은 보내자마자 닫히므로 토스트를 띄우지 않고 메인 창이 맡는다.
  const send = useSendMail(popout ? null : (id, detail) => openDraft(id, { detail }));

  const composerRef = useRef<MailComposerHandle>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const coach = useCoachDraft();
  const [tab, setTab] = useState<'compose' | 'review'>('compose');
  const [hasBody, setHasBody] = useState(false);
  // 마지막으로 코칭한 본문 HTML — 본문이 바뀌면(편집/개선본 교체) 재검토를 트리거하기 위한 stale 가드.
  // 평문이 아니라 HTML 로 비교한다(WP-404) — AI 입력이 HTML 이라, 굵게·빈 줄만 바꿔도 다시 검토해야 교체 때 그 서식이 남는다.
  // 서명을 뺀 HTML 이다(WP-1517) — 서명만 넣고 뺀 것은 검토할 본문이 바뀐 것이 아니다.
  const lastCoachedRef = useRef<string | null>(null);

  // 새 창은 늘 데스크톱 배치다 — 900px 창은 lg 미만이라 그대로 두면 모바일 화면 전체 작성(히스토리 항목·상단 바)으로 그려진다.
  const viewportMobile = useIsMobile();
  const isMobile = !popout && viewportMobile;
  const navigate = useNavigate();
  // 내 서명(WP-1517) — 처음 여는 작성의 자동 넣기와 펜 단추가 읽는다. 본문은 조회를 기다리지 않는다(늦으면 아래 효과가 넣는다).
  const signature = useMailSignature();
  const sig = signature.data;
  // 본문에 서명 블록이 있는가 — 에디터 onChange 의 info 에서 받는다(펜 단추 강조·aria-label).
  const [signatureInBody, setSignatureInBody] = useState(false);
  // 지금 열린 작성 회차 — 늦게 누른 토스트 단추(서명 설정)가 이미 닫혔거나 바뀐 작성을 다시 닫지 않게.
  const liveInstanceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    liveInstanceRef.current = draft?.instanceId;
  });
  // 새 메일 AI 초안(WP-576) — 새 메일에서만, 회신 AI 초안 버튼과 같은 조건(쓸 수 있는 비서 + 이 계정 AI 사용)일 때.
  const aiAvailable = useAiAvailable();
  const { data: accounts } = useMailAccounts();
  const accountAiEnabled = accounts?.find((a) => a.id === draft?.accountId)?.aiEnabled ?? false;
  const aiDraftEnabled = draft?.mode === 'new' && aiAvailable && accountAiEnabled;
  const ai = useMailAiDraft(draft?.accountId);
  const aiGenerating = ai.phase === 'generating';
  // 본문 끝 초점 요청 깨우기 — AI 초안을 넣은 뒤 요청(bodyFocusRef)을 걸고 이 값을 올려 아래 초점 효과를 다시 돌린다.
  const [bodyFocusNonce, setBodyFocusNonce] = useState(0);
  // 데스크톱 배치(size) — 작은 창 / 최소화 / 읽기 창. 컨텍스트 값(WP-1743)이라 메일 읽기 자리 슬롯이 함께 본다.
  // 하나의 값이라 최소화와 읽기 창이 동시에 걸리지 않고, 새 작성마다 아래 instanceId 효과가 작성 방식 기본값(읽기 창 또는 dock, WP-1744)으로 처음 배치를 정한다(모바일은 항상 화면 전체라 이 값을 쓰지 않는다).
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState('');
  // 지금 제목 — 늦게 도착한 AI 초안이 "응답 때의 제목"으로 판정하도록(생성 중 쓴 제목을 덮지 않게, WP-576) 화면 값과 함께 갱신한다.
  const subjectRef = useRef('');
  // 이 회차의 처음 본문 — 처음 여는 작성이고 설정이 켜져 있으면 빈 줄 + 서명을 붙인다(임시저장·다시 열기는 저장된 본문 그대로).
  // 회차가 열릴 때 한 번 정하고, 작성 중 서명 캐시가 바뀌어도(설정에서 저장) 이 회차엔 다시 넣지 않는다 — 에디터도 처음 값만 쓴다.
  // 그때 서명 조회가 아직이면 서명 없이 시작하고(signatureSettled=false) 아래 늦은 넣기 효과가 맡는다 — 본문이 조회에 묶여 멈추지 않게.
  // 넣은 서명은 처음 본문(baseline)에 들어가므로 서명만 있는 새 메일은 닫아도 임시저장하지 않는다.
  const composeInitial = useMemo(() => {
    if (!draft) return { html: '', signatureSettled: true };
    if (signature.isPending) return { html: draft.initialHtml, signatureSettled: false };
    const html = sig && shouldAutoInsertSignature(draft, sig) ? appendSignature(draft.initialHtml, sig.html) : draft.initialHtml;
    return { html, signatureSettled: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.instanceId]);
  const composeInitialHtml = composeInitial.html;
  // 본문은 ref 로 보관(매 키 입력마다 리렌더 방지).
  const bodyHtmlRef = useRef('');
  const bodyTextRef = useRef('');
  // 본문을 사용자가 고쳤는지 — 처음 채워진 본문(AI 답장 초안 등)과 비교한다. 기준은 에디터가 만들어질 때의 HTML.
  const bodyBaselineRef = useRef('');
  const [bodyEdited, setBodyEdited] = useState(false);
  // 에디터가 처음 본문을 알린 회차 — 늦게 온 서명은 에디터가 만들어진 뒤에만 넣을 수 있다.
  const [composerReadyFor, setComposerReadyFor] = useState<number | undefined>(undefined);
  // 늦은 서명 넣기를 이미 판단한 회차 — 한 회차에 한 번만(넣었든 안 넣었든) 정한다.
  // 늦은 서명 넣기를 이미 정한 회차 — 자동 옮기기 효과가 이 값을 조건·deps 로 읽어, 두 효과의 선언 순서에 기대지 않는다.
  const [signatureDecidedFor, setSignatureDecidedFor] = useState<number | undefined>(undefined);
  // 아직 주지 않은 본문 끝 초점 요청 하나 — 답장을 열 때(WP-1746)·AI 초안을 넣은 뒤(WP-576) 건다. 그 회차의 에디터가 준비되고
  // 생성 중(inert)이 아닐 때 한 번 주고 비운다. dropIfMinimized: 최소화로 숨어 있으면 주지 않고 버린다(AI 초안 — 페이지에서 하던 일을
  // 빼앗지 않게). false 면 펼칠 때까지 남겨 둔다(답장 — 처음 초점이라 펼친 뒤 받는 게 맞다).
  const bodyFocusRef = useRef<{ instanceId: number | undefined; dropIfMinimized: boolean } | undefined>(undefined);
  // 인용문을 지웠는지 — 기밀 문단을 빼고 회신하는 것도 쓴 내용으로 본다.
  const [quoteRemoved, setQuoteRemoved] = useState(false);
  // 첨부(WP-574) — 📎·끌어다 놓기로 받은 파일을 바로 올린다. 창 전체가 놓을 자리라 패널에 dropProps 를 편다.
  // 인용문이 다시 붙이는 본문 이미지도 한 통 합계(25MB)에 든다 — 인용문을 지우면 0.
  const attachments = useMailComposeAttachments(quoteInlineBytes(draft?.quote));
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 최소화한 창에 놓아도 첨부된 것이 보이게 작은 창으로 펼친다.
  const { isDragging, dropProps } = useComposerFileDrop((files) => {
    setSize((v) => (v === 'min' ? 'dock' : v));
    attachments.addFiles(files);
  });

  // AI 전체 화면에서는 읽기 창이 되지 않는다 — 위 접기 효과가 size 를 dock 으로 접어 우측 하단 작은 창으로 비켜 주고,
  // AI 를 닫거나 옆 패널로 돌려도 자동으로 되돌아가지 않는다(다시 「읽기 창으로」 를 눌러 들어간다).
  // 여기 `!aiFullscreen` 은 접기 효과가 돌기 전 한 렌더 동안 pane 배치가 그려지지 않게 막는 가드다.
  // 새 창(popout)은 창 전체를 채우는 배치를 쓰되, 새로 뜨는 창이라 페이지와 겹칠 것이 없어 배경·Esc·대화상자 처리는 하지 않는다.
  const layout: MailComposeFrameLayout = popout
    ? 'fill'
    : isMobile
      ? 'mobile'
      : size === 'pane' && !aiFullscreen
        ? 'pane'
        : 'dock';
  // 편집기 배치 — 읽기 창(pane)은 편집기에서 보면 새 창과 같은 넓은 자리(fill)다.
  const editorLayout: MailComposerLayout = layout === 'pane' ? 'fill' : layout;
  // 본문이 남은 높이를 채우는가 — 읽기 창과 새 창.
  const fillsHeight = editorLayout === 'fill';
  // 모바일 화면 전체만 화면을 덮는 대화상자다 — 그동안 뒤 페이지를 inert 로 만들어 Tab·보조기기가 가려진 페이지로 새지 않게 한다
  // (useAiPanelAwareDialog 와 같은 공용 처리 — AI 표면은 그대로 쓸 수 있다).
  // 읽기 창(pane)은 페이지 일부라 뒤를 잠그지 않는다 — 대화상자·배경·inert 가 없다(WP-1743).
  // aria-modal 은 달지 않는다 — 보조기기가 대화상자 밖의 AI 까지 무시하게 되므로(useAiPanelAwareDialog 와 같은 이유).
  const isModal = !!draft && isMobile;
  // 대상은 켤 때 한 번 모으므로 셸이 바뀌면(lg 경계 리사이즈) 새 셸 DOM 에 다시 건다 — isMobile 도 deps.
  useEffect(() => (isModal ? inertPageArea() : undefined), [isModal, isMobile]);

  // 사용자가 쓴 내용이 있는가 — 본문·받는사람·참조·숨은참조·제목·인용문·첨부 중 하나라도 처음 채워진 값에서 바뀌었다.
  // 빈 새 메일(이 값이 false)은 임시저장하지 않는다. 조기 return 앞에서 계산해 자동 저장 훅이 읽는다.
  const hasContent =
    !!draft &&
    (bodyEdited ||
      quoteRemoved ||
      attachments.changed ||
      to !== draft.to.join(', ') ||
      cc !== draft.cc.join(', ') ||
      bcc !== draft.bcc.join(', ') ||
      subject !== draft.subject);

  // 새 창 탭 제목(WP-1535) — 쓰는 제목, 없으면 「새 메일」(머리줄 제목과 같은 규칙). 앱 안 작성창은 탭 제목을 바꾸지 않는다.
  useDocumentTitle(popout && draft ? [subject || '새 메일'] : []);
  // 떠나는 중인 회차 — 새 창으로 옮기는 저장(메인 창) 또는 새 창을 닫기 전 저장·삭제를 기다리는 동안 그 회차의 작성창을 잠근다(그사이 쓴 것이 빠지지 않게).
  // 회차 id 로 가린다 — 도크 본체는 회차 사이에 다시 마운트되지 않아, 불리언이면 앞 회차의 늦은 저장이 끝날 때 지금 회차의 잠금을 풀거나
  // 앞 회차가 옮기는 동안 연 새 회차를 잠그기 때문이다.
  const [leavingFor, setLeavingFor] = useState<number | null>(null);
  const leaving = draft != null && leavingFor === draft.instanceId;
  // 작성 방식 기본값 「새 창」으로 옮기는 중인 회차인가(WP-1744) — 그동안 우측 하단 창을 감춘다(새 창 페이지 공급자는 옮기지 않아 늘 거짓).
  const movingToWindow = draft != null && windowMoveFor === draft.instanceId;

  // 임시저장(WP-577) 지금 내용 — 본문은 에디터 HTML 만(인용문은 다시 열 때 원본으로 다시 만든다), 첨부는 올라간 것만.
  const getSnapshot = (): DraftSnapshot => ({
    payload: buildDraftSavePayload({
      draft: draft ?? { accountId: 0, mode: 'new', sourceMessageId: null },
      to,
      cc,
      bcc,
      subject: subjectRef.current,
      bodyHtml: bodyHtmlRef.current,
      bodyText: bodyTextRef.current,
      quoteRemoved,
      // 보내기 요청과 같은 인용 이미지 참조(WP-1786) — 인용문을 지웠으면 clearQuote 로 quote 가 비어 빠진다.
      quoteInlineImages: draft?.quote?.inlineImages,
      attachments: attachments.items,
    }),
    // 「다시 열기」로 연 저장 안 된 내용은 처음 값과 같아도 저장 대상이다(새 메일도 POST 한다).
    empty: !hasContent && !draft?.unsaved,
  });
  // 늦게 끝나는 저장 뒤(popOut 의 then)에서 「지금」 비었는지 보려면 그때의 최신 스냅샷이 필요하다 — 호출 시점의 클로저는 낡았다.
  const getSnapshotRef = useRef(getSnapshot);
  useLayoutEffect(() => {
    getSnapshotRef.current = getSnapshot;
  });
  const autosave = useMailDraftAutosave({
    instanceId: draft?.instanceId,
    initialDraftId: draft?.draftId,
    initialVersion: draft?.draftVersion,
    initialUnsaved: draft?.unsaved,
    accountId: draft?.accountId,
    getSnapshot,
    onCreated: bindDraftId,
  });
  // 보내기 준비 중(진행 중인 임시저장을 기다리는 동안) — send.isPending 이 켜지기 전에도 보내기를 잠가 두 번 나가지 않게 한다.
  // 상태는 버튼 표시용, ref 는 같은 틱의 두 번째 클릭을 막는 동기 잠금.
  const [preparingSend, setPreparingSend] = useState(false);
  const sendLock = useRef(false);
  // 저장하지 않은 변경(대기·저장 중·실패·충돌)이 있을 때만 새로고침·탭 닫기를 경고한다.
  useUnsavedChangesWarning(!!draft && hasUnsavedDraft(autosave.status));

  // 첨부가 올라가 끝나거나 빠지면 저장한다 — 올리는 중인 칩은 저장에 싣지 않으므로 완료 목록이 바뀔 때만.
  // 새 작성의 처음 첨부(전달 원본·임시저장)는 아래 초기화가 기준값으로 맞춰 저장을 부르지 않는다.
  const doneAttachmentKey = attachments.items.filter((a) => a.status === 'done').map((a) => a.key).join('|');
  const doneAttachmentBase = useRef('');
  useEffect(() => {
    if (doneAttachmentKey === doneAttachmentBase.current) return;
    doneAttachmentBase.current = doneAttachmentKey;
    autosave.schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneAttachmentKey]);

  // 새 draft 가 열릴 때마다 폼 초기화. 인용문 제거(clearQuote)도 draft 객체를 바꾸지만 같은 작성이므로
  // instanceId 로만 판단한다 — 안 그러면 지우는 순간 받는사람·제목·크기가 처음 값으로 돌아가고 본문 ref 가 화면과 어긋난다.
  useEffect(() => {
    // 올리던 첨부·진행 중인 AI 초안 요청은 닫힐 때도 새로 열릴 때도 멈추고 비운다 — 본체는 닫혀도 언마운트되지 않으므로(null 렌더)
    // 닫힌 작성창에 늦게 도착한 초안이 반영되지 않게. 첨부는 draft 에서 매 렌더 끌어오지 않고 여기서 한 번 채운다
    // — 인용문 지우기(clearQuote)가 draft 를 바꿔도 첨부가 되돌아가지 않게.
    attachments.reset(draft?.attachments);
    doneAttachmentBase.current = (draft?.attachments ?? []).filter((a) => a.status === 'done').map((a) => a.key).join('|');
    ai.reset();
    // 새 작성의 처음 배치(작성 방식 기본값, WP-1744) — 이 회차에 적용할 기본값(openCompose 가 placement 로 정함)이 읽기 창이고
    // 데스크톱·AI 전체 화면 아님·읽기 자리 슬롯 있음(메일 화면)이면 읽기 창, 그 밖(우측 하단·새 창 기본값, 설정 못 받음, 메일 화면 밖,
    // placement 없이 다시 연 작성)은 우측 하단 작은 창. 새 창 기본값은 아래 「기본값 새 창」 효과가 옮긴다.
    // 닫힌 작성(보냄·✕·새 창으로 보냄)은 우측 하단으로 — 읽기 창 상태가 남아 읽기 자리가 비어 있지 않게 한다(WP-1743).
    // 읽기 자리(slotEl)는 MailInboxPage 가 읽기 영역에만 그린다 — 임시보관함처럼 읽는 자리가 없는 메일 화면도 slotEl 이 없어 우측 하단이다.
    // 새 창 페이지(popout)는 공급자가 늘 DOCK 이라 읽기 창이 되지 않는다(그 창의 배치는 늘 fill).
    const initialPlacement = draft?.instanceId != null ? initialPlacementFor(draft.instanceId) : null;
    setSize(draft && initialPlacement === 'PANE' && !isMobile && !aiFullscreen && slotEl ? 'pane' : 'dock');
    if (!draft) return;
    setTo(draft.to.join(', '));
    setCc(draft.cc.join(', '));
    setBcc(draft.bcc.join(', '));
    setShowCcBcc(draft.cc.length > 0 || draft.bcc.length > 0);
    setSubject(draft.subject);
    subjectRef.current = draft.subject;
    bodyHtmlRef.current = composeInitialHtml;
    bodyTextRef.current = '';
    setSignatureInBody(false);
    // 새 draft 진입 시 탭/코칭 결과 초기화.
    setTab('compose');
    coach.reset();
    lastCoachedRef.current = null;
    setHasBody(false);
    setBodyEdited(false);
    // 임시보관함에서 연 작성은 지웠던 인용문 상태를 이어받는다 — 다음 저장이 quoteRemoved 를 false 로 되돌려 인용문이 되살아나지 않게.
    setQuoteRemoved(!!draft.quoteRemoved);
    // 처음 초점 — 답장(전체 답장 포함)은 받는 사람이 이미 채워져 있으니 본문으로(WP-1746, Outlook 식). 에디터는 비동기로 준비되므로
    // 여기서는 요청만 걸고 아래 「본문 끝 초점」 효과가 composerReadyFor 뒤에 준다. 늘 「내가 쓴 글 끝」(focusEnd — 서명과 그 앞 빈 줄 위)이라
    // 빈 새 답장이면 첫 줄, 임시저장·AI 답장 초안처럼 쓴 글이 있으면 그 끝에서 이어 쓴다.
    // 전달·새 메일은 받는 사람부터 채워야 하므로 "받는사람"으로 초점을 명시적으로 이동한다 — 본문 에디터가 자동으로 초점을 가져가
    // 수신자→제목→본문 순서를 건너뛰던 문제(#802).
    if (draft.mode === 'reply') {
      bodyFocusRef.current = { instanceId: draft.instanceId, dropIfMinimized: false };
    } else {
      bodyFocusRef.current = undefined;
      toInputRef.current?.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.instanceId]);

  // 늦게 온 서명(WP-1517) — 회차를 열 때 조회가 아직이었으면, 끝난 뒤 한 번만 정한다. 자동 넣기 대상이고 본문이 아직 처음 그대로일 때만
  // 넣는다 — 그사이 사용자가 쓰기 시작했거나 AI 초안이 들어왔으면 덮거나 끼어들지 않는다(필요하면 펜으로 넣는다). 실패면 넣지 않는다.
  const instanceId = draft?.instanceId;
  useEffect(() => {
    if (!draft || composeInitial.signatureSettled || signature.isPending) return;
    if (composerReadyFor !== instanceId || signatureDecidedFor === instanceId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서명 조회가 끝난 뒤(비동기 결과)에야 정해지고 회차마다 한 번이라 렌더 중으로 못 옮긴다.
    setSignatureDecidedFor(instanceId);
    if (!sig || !shouldAutoInsertSignature(draft, sig)) return;
    if (bodyHtmlRef.current !== bodyBaselineRef.current) return;
    composerRef.current?.insertInitialSignature(sig.html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, composerReadyFor, signature.isPending, sig, signatureDecidedFor]);

  // 개선본 미리보기 문서(WP-404) — 에디터와 같은 문단·글자 규칙을 입히고, 다크 테마면 받은 메일 본문처럼 테마색으로 바꾼다.
  // 그래야 미리보기에서 본 모습이 "개선본으로 교체" 후 에디터 모습과 같다.
  const improvedHtml = coach.data?.improvedBodyHtml;
  const styledImprovedHtml = useMemo(
    () => (improvedHtml ? withComposerPreviewStyle(improvedHtml) : null),
    [improvedHtml],
  );
  const improvedPreviewHtml = useMailDarkHtml(styledImprovedHtml);

  // 본문 끝 초점(WP-576 AI 초안·WP-1746 답장) — 걸린 요청(bodyFocusRef)을 그 회차의 에디터가 처음 본문을 알린 뒤(composerReadyFor) 한 번 준다.
  // 생성 중이면 래퍼가 inert 라 focus 가 무시되므로 끝날 때까지 기다린다. 최소화로 숨어 있으면 숨은 에디터는 초점을 받지 못한다 —
  // AI 초안 요청은 버리고(페이지에서 하던 일을 빼앗지 않게), 답장 요청은 펼칠 때까지 남겨 둔다. 준 뒤 ref 를 비워
  // 사용자가 다른 칸으로 옮긴 다음 다시 끌어오지 않는다. 늦게 온 서명은 문서 끝에 붙으므로(insertInitialSignature) 커서는 움직이지 않는다.
  const minimized = size === 'min' && !isMobile;
  useEffect(() => {
    const req = bodyFocusRef.current;
    if (!req || composerReadyFor !== req.instanceId || aiGenerating) return;
    if (minimized && !req.dropIfMinimized) return;
    bodyFocusRef.current = undefined;
    if (!minimized) composerRef.current?.focusEnd();
    // 회차가 바뀐 렌더에서도 다시 본다 — 위 초기화 효과가 같은 커밋에서 ref 를 먼저 채운다(선언 순서).
  }, [bodyFocusNonce, composerReadyFor, draft?.instanceId, minimized, aiGenerating]);

  /**
   * 지금 작성 내용을 작성창 초기값으로 — 닫은 뒤 저장이 실패했을 때 「다시 열기」, 버린 뒤 「되돌리기」로 같은 내용을 다시 연다.
   * 본문은 에디터 HTML, 인용문은 지금 것(지웠으면 null), 첨부는 올라간 것만.
   */
  function snapshotDraft(): ComposeDraft {
    const d = draft as ComposeDraft;
    return {
      ...d,
      to: parseRecipientInput(to),
      cc: parseRecipientInput(cc),
      bcc: parseRecipientInput(bcc),
      subject: subjectRef.current,
      initialHtml: bodyHtmlRef.current,
      attachments: attachments.items.filter((a): a is ComposeAttachment => a.status === 'done'),
      quoteRemoved,
      // 「다시 열기」 표시는 그 자리에서 정한다(되돌리기로 연 작성은 이미 저장된 것이다).
      unsaved: undefined,
      instanceId: undefined,
    };
  }

  /**
   * 닫은 뒤 저장 결과 알림 — 저장된 임시저장이 있으면 「임시보관함에 저장했어요」.
   * 실패하면 쓴 내용을 잃지 않게 「다시 열기」로 같은 내용의 작성창을 다시 연다(그 창이 다시 자동 저장한다).
   */
  function notifySaved(r: DraftFlushResult, reopen: ComposeDraft) {
    if (!r.ok) {
      toast.error('임시저장하지 못했어요', {
        action: {
          label: '다시 열기',
          // 저장 안 된 내용으로 연다 — 열자마자 다시 저장하고(새 메일 POST, 기존 임시저장 PUT), 그냥 닫아도 저장한다.
          onClick: () =>
            openCompose({ ...reopen, draftId: r.draftId ?? undefined, draftVersion: r.version ?? undefined, unsaved: true }),
        },
      });
      return;
    }
    if (r.wrote) toast.success('임시보관함에 저장했어요');
  }

  /** 남은 저장을 바로 돌리고 결과를 알린다 — flush 가 지금 세션을 동기로 잡으므로 닫기·바꾸기보다 먼저 부른다. */
  function saveAndNotify() {
    const reopen = snapshotDraft();
    void autosave.flush().then((r) => notifySaved(r, reopen));
  }

  // ↗ 새 창으로 열기(WP-1535) — 팝업 차단을 피하려 클릭에서 바로 빈 창을 연 뒤, 지금 내용을 임시저장해(손대지 않은 작성도 만든다)
  // 받은 id 로 그 창의 주소를 정한다. 저장하지 못하면 빈 창을 닫고 작성창은 그대로 둔다. 옮긴 뒤엔 이 창의 저장을 끝내고 알림 없이 닫는다
  // — 두 창이 같은 임시저장을 번갈아 고쳐 충돌(409)하지 않게.
  // preopened: 작성 방식 기본값 「새 창」(WP-1744)이 openCompose 클릭 처리 중에 미리 연 창(null 이면 팝업 차단). 넘기면 창을 새로 열지 않고
  // 그 창으로 같은 흐름을 탄다. 그때 감춰 둔 우측 하단 창은 옮기지 못하면(차단·저장 실패·빈 창을 닫음) 다시 보인다(endWindowMove —
  // ↗ 를 직접 누른 때는 옮기는 중인 회차가 없어 아무 일도 하지 않는다).
  // 조기 return 앞에 둔다 — 아래 「기본값 새 창」 효과가 부른다(작성창이 없으면 그 효과가 부르지 않는다).
  const popOut = (preopened?: Window | null, opts?: { auto?: boolean }) => {
    // 이 호출이 속한 회차 — 늦게 끝나는 저장 뒤의 해제가 그 사이 연 다음 회차를 건드리지 않게 endWindowMove 에 넘긴다.
    const opened = instanceId as number;
    // 옮기기를 그만둔다 — 미리 연 창이 있으면 닫고 우측 하단 창을 되돌린다(닫힌 창·null 에는 close 가 아무 일도 하지 않는다).
    const giveUp = (w?: Window | null) => {
      w?.close();
      endWindowMove(opened);
    };
    // 붙여 넣은 그림은 올라가는 중이면 아직 본문 자리표시라 저장되지 않는다 — 다 올라간 뒤 옮긴다(보내기와 같은 규칙).
    const blockedByPendingImage = () => {
      if (!composerRef.current?.hasPendingImage()) return false;
      giveUp(preopened);
      toast.error('이미지를 올리는 중이에요. 다 올라간 뒤 새 창으로 열어 주세요');
      return true;
    };
    // ↗ 를 직접 누른 경우는 창을 새로 열기 전에 막는다(열었다 닫는 깜빡임 방지). 미리 연 창은 아래에서 차례로 본다.
    if (preopened === undefined && blockedByPendingImage()) return;
    const win = preopened !== undefined ? preopened : openMailComposeWindow();
    if (!win) {
      giveUp();
      toastMailComposePopupBlocked();
      return;
    }
    // 미리 연 창을 사용자가 이미 닫았다 — 막힘 안내 없이(닫은 창에 이유를 알릴 일이 아니다), 손대지 않은 작성으로 서버 임시저장을 만들지 않게 저장 전에 그만두고 우측 하단에 둔다.
    if (preopened?.closed) {
      giveUp();
      return;
    }
    // 자동 옮기기(기본값 「새 창」)는 ↗ 단추가 막히는 이유(올리는 중인 첨부 등)에도 옮기지 않고 창을 닫아 우측 하단에 두며 이유를 알린다.
    if (opts?.auto && popoutBaseBlockedReason != null) {
      giveUp(preopened);
      toast('새 창으로 열지 못해 우측 하단에 열었어요', { description: popoutBaseBlockedReason });
      return;
    }
    if (preopened !== undefined && blockedByPendingImage()) return;
    // 아직 서버에 없고 손댄 것도 없는 작성 — 강제 저장으로 만드는 임시저장은 새 창에서도 손대지 않고 닫으면 지운다(fresh).
    const fresh = autosave.currentDraftId() == null && getSnapshot().empty;
    setLeavingFor(opened);
    void autosave.flush({ force: true }).then((r) => {
      setLeavingFor((cur) => (cur === opened ? null : cur));
      // 저장하는 동안 사용자가 빈 창을 닫았다 — 여기서 이어 쓴다(작성창을 닫지 않고, 죽은 창은 건드리지 않는다).
      // 저장은 끝났으니 이 작성은 그 임시저장에 이어 저장된다.
      if (win.closed) {
        giveUp();
        // 손대지 않은 작성으로 새로 만든 임시저장이면 빈 채로 임시보관함에 남지 않게 지운다(작성창은 그대로 두고 다음 입력에 다시 만든다).
        // 저장하는 동안 우측 하단 창에 입력했으면(지금은 비어 있지 않다) 지우지 않고 그 임시저장에 이어 쓴다.
        if (fresh && r.ok && r.draftId != null && getSnapshotRef.current().empty) {
          void autosave.detach(r.draftId);
          // 작성이 지운 번호를 계속 가리키지 않게 푼다 — 임시보관함 행 눌림이 없는 임시저장을 앞으로 가져오거나 닫지 않게.
          unbindDraftId(opened, r.draftId);
        }
        return;
      }
      if (!r.ok || r.draftId == null) {
        giveUp(win);
        toast.error('새 창으로 열지 못했어요', {
          description: r.reason ?? '임시저장하지 못했어요. 잠시 뒤 다시 시도해 주세요',
        });
        return;
      }
      // 기다리는 동안 다른 작성(답장·편지쓰기)으로 바뀌었으면 그 작성의 저장을 끝내지 않는다 — 옮긴 작성의 세션은 바뀔 때 이미 떨어졌다.
      if (liveInstanceRef.current === opened) autosave.end();
      closeInstance(opened);
      // 이 임시저장을 새 창이 쓰는 동안 임시보관함에서 다시 열면 그 창을 앞으로 가져오게 기억한다.
      rememberMailComposePopout(r.draftId, win);
      win.location.href = mailComposeWindowUrl(r.draftId, { opener: MAIL_COMPOSE_WINDOW_ID, fresh });
    });
  };

  // 아래 「기본값 새 창」 자동 옮기기 효과도 이 이유를 보므로(조기 return 뒤에서는 효과를 못 건다) 효과보다 앞에서 계산한다.
  // 올리는 중이거나 실패한 첨부가 있으면 보내지 않는다 — 빠진 채 나가지 않게. 이유는 칩 목록 위 한 줄(모바일 포함)과 데스크톱 보내기 툴팁으로 알린다.
  const { block } = attachments;
  const blockedReason = block?.reason ?? null;
  // 새 창으로 열기를 막는 이유(WP-1535) — 업로드 중·실패한 첨부는 저장에 실리지 않아 새 창에서 빠지므로 기다리지 않고 막는다.
  // 보내는 중·AI 초안 생성 중(반쯤 찬 본문)·옮기는 중에도 막는다. 이유는 툴팁으로 보인다.
  // 「옮기는 중」(leaving)만 따로 뺀다 — 자동 옮기기는 앞 회차의 늦은 저장(leaving)이 남은 채 다음 회차를 열어도 그 회차를 막으면 안 되기 때문이다.
  const popoutBaseBlockedReason =
    blockedReason ??
    (autosave.status === 'gone'
      ? '다른 곳에서 보냈거나 버린 메일이라 새 창으로 열 수 없어요'
      : aiGenerating
        ? 'AI 초안을 만드는 중이에요'
        : null);
  // 「보내는 중」도 따로 뺀다 — 도크 본체는 회차 사이에 다시 마운트되지 않아 앞 회차가 보내는 중이면 새 회차가 잘못 막힌다. ↗ 단추는 막는다.
  const popoutBlockedReason =
    popoutBaseBlockedReason ?? (send.isPending || preparingSend ? '보내는 중이에요' : leaving ? '새 창을 여는 중이에요' : null);
  // 작성 방식 기본값 「새 창」(WP-1744) — 이 회차를 위해 openCompose 가 미리 연 창이 있으면, 작성기가 처음 본문을 알린 뒤(지금 내용을
  // 임시저장할 수 있을 때) 한 번 꺼내 ↗ 와 같은 흐름으로 옮긴다. 꺼내면 비워지므로 다시 돌아도(StrictMode 등) 두 번 옮기지 않는다.
  // 처음 본문에 서명이 아직 없으면(서명 조회 중에 열었다) 조회가 끝나고 위 늦은 서명 넣기 효과가 이 회차를 정한 뒤(signatureDecidedFor)에
  // 옮긴다 — 먼저 옮기면 서명 없는 본문이 임시저장돼 새 창에서 서명이 빠진다. 효과 선언 순서가 아니라 그 상태값에 기댄다.
  // ↗ 단추가 막히는 경우(올리는 중인 첨부 등, popoutBaseBlockedReason)에는 옮기지 않고 창을 닫아 우측 하단에 두며 이유를 알린다(popOut 의 auto).
  // 새 창 페이지(popout)에서는 공급자가 창을 미리 열지 않아 takePendingWindow 가 늘 undefined 다.
  useEffect(() => {
    if (instanceId == null || composerReadyFor !== instanceId) return;
    // 작성기가 준비됐으니 미리 연 창의 시한을 서명 기다림 시한으로 다시 건다 — 서명 조회가 10초 넘게 걸려도 닫지 않되 영영 안 오면 닫는다.
    rearmPendingWindow(instanceId);
    if (!composeInitial.signatureSettled && (signature.isPending || signatureDecidedFor !== instanceId)) return;
    const preopened = takePendingWindow(instanceId);
    if (preopened === undefined) return;
    // 막힘(올리는 중인 첨부 등)·팝업 차단·닫힌 창은 popOut 이 한 곳에서 가려 우측 하단에 둔다(auto).
    popOut(preopened, { auto: true });
    // popOut 은 매 렌더 새 함수라 deps 에서 뺀다 — 이 효과는 작성기 준비·서명 결정 같은 회차 전환 시점에만 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerReadyFor, instanceId, signature.isPending, signatureDecidedFor]);

  // 다른 작성으로 바뀌기 직전(다른 메일 답장·임시저장 열기) 이 작성을 저장하고, 같은 임시저장을 다시 열면 이 창을 앞으로 가져오고(최소화를 푼다),
  // 임시보관함에서 이 임시저장을 지우면 저장을 멈춘다. 매 렌더 최신 내용을 읽는 함수로 다시 건다.
  useEffect(() => {
    if (!draft) return;
    setComposeHandlers({
      save: saveAndNotify,
      raise: () => setSize((v) => (v === 'min' ? 'dock' : v)),
      abandon: autosave.end,
    });
    return () => setComposeHandlers(null);
  });

  if (!draft) return null;

  // ✕·모바일 back 공통 — 묻지 않고 남은 저장을 바로 돌린 뒤 닫는다. 저장 결과는 닫힌 뒤 토스트로 알린다.
  // 새 창은 저장이 끝난 뒤에 닫는다 — 창을 먼저 닫으면 나가던 저장 요청이 끊긴다. 저장하지 못했으면 창을 남기고 알린다(쓴 것을 잃지 않게).
  const closeWithSave = () => {
    if (popout) {
      const accountId = draft.accountId;
      const leavingId = draft.instanceId as number;
      setLeavingFor(leavingId);
      void autosave.flush().then((r) => {
        if (!r.ok) {
          setLeavingFor((cur) => (cur === leavingId ? null : cur));
          // 검증 오류(400)면 실제 사유를, 그 밖이면 일반 안내를 보인다.
          toast.error(r.reason ?? '임시저장하지 못했어요', { description: '창을 닫지 않았어요. 고치거나 잠시 뒤 다시 닫아 주세요' });
          return;
        }
        // 손대지 않은 작성을 옮기려 만든 임시저장을 새 창에서도 손대지 않았다 — 지우고 조용히 닫는다(앱 안 작성창과 같이 빈 작성은 남기지 않는다).
        // 지우지 못해도 창은 닫는다 — 빈 임시저장 하나가 남을 뿐이고, 알릴 결과는 없다.
        if (popout.fresh && !r.wrote && r.draftId != null) {
          const done = () => popout.onDone('closed', accountId);
          autosave.discard().then(done, done);
          return;
        }
        autosave.end();
        // 임시보관함에 남아 있으면(새 창으로 옮길 때 이미 저장했다) 저장으로, 다른 곳에서 보냈거나 버렸으면 그냥 닫힘으로 알린다.
        popout.onDone(r.draftId != null ? 'saved' : 'closed', accountId);
      });
      return;
    }
    saveAndNotify();
    closeCompose();
  };

  // 서명 설정으로 — 데스크톱은 작성창을 그대로 두고 옮긴다. 모바일은 화면 전체 작성창이 덮고 있으므로 저장하고 닫은 뒤 옮긴다.
  // 그때 작성 화면 히스토리 항목(표식)은 설정 화면으로 바꾼다 — 닫힘이 표식을 되돌리는(history.back) 것과 이동이 엇갈리지 않고, 뒤로 가면 메일로 온다.
  const goToSignatureSettings = () => {
    // 새 창엔 앱 셸이 없다 — 설정은 새 탭으로 열고 작성은 그대로 둔다.
    if (popout) {
      window.open('/settings/mail', '_blank', 'noopener');
      return;
    }
    if (!isMobile) {
      navigate('/settings/mail');
      return;
    }
    let replace = false;
    if (liveInstanceRef.current === instanceId) {
      replace = hasLiveStateMark(MOBILE_COMPOSE_HISTORY_KEY);
      closeWithSave();
    }
    navigate('/settings/mail', { replace });
  };

  // 펜 — 본문에 서명이 있으면 빼고, 없으면 내 서명을 넣는다. 서명을 불러오지 못했으면 다시 시도를, 서명이 아직 없으면 설정을 안내한다.
  const toggleSignature = () => {
    if (signatureInBody) {
      composerRef.current?.removeSignature();
      return;
    }
    if (sig && sig.html !== '') {
      composerRef.current?.insertSignature(sig.html);
      return;
    }
    if (signature.isError) {
      // 조회 실패를 「서명 없음」으로 안내하면 서명이 있는 사람을 설정으로 헛걸음시킨다 — 다시 불러와 되면 그 자리에서 넣는다(펜을 누른 뜻).
      toast.error('서명을 불러오지 못했어요', {
        action: {
          label: '다시 시도',
          onClick: () => {
            void signature.refetch().then((r) => {
              if (liveInstanceRef.current !== instanceId) return;
              if (r.isError) {
                toast.error('서명을 불러오지 못했어요');
                return;
              }
              if (r.data && r.data.html !== '') composerRef.current?.insertSignature(r.data.html);
            });
          },
        },
      });
      return;
    }
    toast('서명이 아직 없어요', {
      description: '설정 › 메일 계정에서 서명을 만들 수 있어요',
      action: { label: '서명 설정', onClick: goToSignatureSettings },
    });
  };
  const signatureLabel = signatureInBody ? '서명 빼기' : '서명 넣기';

  // 🗑 버리기 — 임시저장을 지우고 닫는다. 쓴 것이 있었으면 「되돌리기」로 같은 내용을 새 임시저장으로 만들어 다시 연다.
  const discardDraft = () => {
    const reopen = snapshotDraft();
    const { payload } = getSnapshot();
    // 다른 곳에서 보냈거나 버린 임시저장(gone)이면 지울 것(id 가 이미 비었다)도 되살릴 것도 없다 — 조용히 닫는다.
    const worth = autosave.status !== 'gone' && (hasContent || autosave.currentDraftId() != null);
    const deleting = autosave.discard();
    // 새 창 — 지우기가 끝난 뒤 닫는다(창을 먼저 닫으면 DELETE 가 끊긴다). 「되돌리기」는 닫힌 창에서 누를 수 없어 메인 창은 버림만 알린다.
    if (popout) {
      const accountId = draft.accountId;
      const leavingId = draft.instanceId as number;
      setLeavingFor(leavingId);
      deleting.then(
        () => popout.onDone('discarded', accountId),
        () => {
          setLeavingFor((cur) => (cur === leavingId ? null : cur));
          toast.error('임시저장을 버리지 못했어요', { description: '임시보관함에 그대로 있어요' });
        },
      );
      return;
    }
    closeCompose();
    // 지우기가 끝난 뒤에 알린다 — 실패하면 임시저장이 그대로 남으므로 「되돌리기」(사본 만들기)를 내밀지 않는다.
    deleting.then(
      () => {
        if (!worth) return;
        toastDraftDiscarded(() => {
          void restoreMailDraft(qc, payload).then((r) => {
            if (r) openCompose({ ...reopen, draftId: r.id, draftVersion: r.version });
          });
        });
      },
      () => toast.error('임시저장을 버리지 못했어요', { description: '임시보관함에 그대로 있어요' }),
    );
  };

  // 충돌 「다시 불러오기」 — 내 변경은 저장하지 않고 서버의 최신 내용으로 작성창을 다시 연다.
  // 세션은 서버 내용을 받아 와 바꾸기 직전에 끝낸다 — 받지 못하면 충돌 상태 그대로 두어 계속 쓰고 ✕ 로 새 임시저장에 남길 수 있게.
  const reloadDraft = () => {
    const id = autosave.currentDraftId();
    if (id != null) void openDraft(id, { force: true, beforeOpen: autosave.end });
  };

  // 입력 칸 변경 — 화면 값을 바꾸고 자동 저장을 예약한다.
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    autosave.schedule();
  };

  const saveStatus = (
    <MailDraftSaveStatus
      status={autosave.status}
      reason={autosave.statusReason}
      onRetry={autosave.retry}
      onReload={reloadDraft}
      mobile={isMobile}
    />
  );
  // 「읽기 창으로」 를 쓸 수 없는 이유(툴팁) — 모바일 폭 / AI 전체 화면 / 메일 화면이 아닐 때(슬롯 없음).
  const paneDisabledReason = isMobile
    ? '화면이 좁아 읽기 창으로 쓸 수 없어요'
    : aiFullscreen
      ? 'AI 전체 화면에서는 읽기 창 대신 우측 하단을 씁니다'
      : slotEl == null
        ? '메일 화면이 아니면 읽기 창으로 쓸 수 없어요'
        : null;
  // 보내기 잠금 — 발송 중, AI 초안 생성 중(반쯤 찬 본문이 나가지 않게, WP-576), 첨부 업로드 중·실패(WP-574).
  const sendDisabled = send.isPending || preparingSend || aiGenerating || blockedReason != null;
  const openFilePicker = () => fileInputRef.current?.click();
  const attachmentChips = (
    <MailComposeAttachmentChips
      items={attachments.items}
      totals={attachments.totals}
      onRemove={attachments.remove}
      onRetry={attachments.retry}
      failedCount={attachments.failedCount}
      block={block}
      // 모바일은 잠금 이유를 상단 바 아래 상태 줄로 보이고, 칩은 본문 흐름 안에 다 펼친다.
      // 데스크톱 아래 고정 줄은 칩을 한 줄로 접는다(고정 줄이 커져 본문을 덮지 않게).
      showBlockLine={!isMobile}
      collapsible={!isMobile}
    />
  );

  // "AI 검토" 진입 시 호출. 본문이 직전 코칭과 같으면 캐시 재사용, 다르면 새로 코칭.
  const runCoaching = () => {
    if (coach.isPending) return;
    // 서명은 검토 대상이 아니다(WP-1517) — AI 가 서명을 고치거나 개선본에 섞지 않게 서명 블록을 뺀 본문만 보낸다.
    const { body: bodyHtml, block } = splitSignature(bodyHtmlRef.current);
    if (coach.data && lastCoachedRef.current === bodyHtml) return;
    lastCoachedRef.current = bodyHtml;
    coach.reset();
    coach.mutate({
      accountId: draft.accountId,
      bodyHtml,
      // 서명이 있으면 서명 밖 본문의 평문, 없으면 에디터 평문(getText) 그대로.
      bodyText: block == null ? bodyTextRef.current : htmlToPlainText(bodyHtml),
      inReplyToMessageId: draft.inReplyToMessageId,
    });
  };

  // 제목 변경 — 입력·AI 반영·되돌리기 모두 이 함수로 바꿔 subjectRef 가 화면과 어긋나지 않게 한다.
  const changeSubject = (v: string) => {
    subjectRef.current = v;
    setSubject(v);
    autosave.schedule();
  };

  // [초안 만들기]·[다시 시도] — 지금 받는사람·참조·제목·본문을 문맥과 되돌리기 스냅숏으로 넘기고, 결과를 본문(과 빈 제목)에 넣는다.
  const runAiDraft = async () => {
    const result = await ai.generate(
      { to: parseRecipientInput(to), cc: parseRecipientInput(cc), subject, html: bodyHtmlRef.current },
      // 다른 칸(입력·편집 영역)에 쓰고 있었는가 — 늦게 도착한 AI 초안이 그 초점을 빼앗지 않게(키보드 판정과 같은 편집 요소 기준).
      () => ({ subject: subjectRef.current, typingElsewhere: isKeyboardEditable(document.activeElement) }),
    );
    if (!result) return;
    // 같은 틱에 넣어야 useMailAiDraft 가 이 변경을 AI 본문으로 받아 둔다. 에디터를 다시 만들지 않으므로
    // 처음 본문(bodyBaselineRef)과 달라져 임시저장 대상이 된다(AI 가 채운 본문도 쓴 내용).
    // 초점은 여기서 주지 않는다 — 아직 래퍼가 inert(생성 중)라 무시된다. 요청만 걸고 렌더가 끝난 뒤 「본문 끝 초점」 효과가 준다.
    // 지금 본문의 서명 블록은 초안 뒤에 그대로 다시 붙인다(WP-1517) — 초안이 서명을 지우지 않게.
    composerRef.current?.setContent(replaceBodyKeepingSignature(bodyHtmlRef.current, result.html), { focus: false });
    changeSubject(result.subject);
    if (result.focusBody) {
      bodyFocusRef.current = { instanceId: draft?.instanceId, dropIfMinimized: true };
      setBodyFocusNonce((n) => n + 1);
    }
  };
  // [되돌리기] — 생성 직전 본문으로, 제목은 AI 가 넣은 그대로일 때만 되돌린다.
  const undoAiDraft = () => {
    const restored = ai.undo(subjectRef.current);
    if (!restored) return;
    composerRef.current?.setContent(restored.html);
    changeSubject(restored.subject);
  };

  // 보내기 — 자동 저장을 멈추고 진행 중인 저장이 끝나 id 가 정해지면 draftId 로 싣는다(서버가 보낸 뒤 그 임시저장을 지운다).
  // 기다리는 동안에도 잠가 두 번 눌러도 한 번만 나간다. 보내는 동안 작성창을 닫거나 다른 작성으로 바꿔도 결과는 이 작성에 묶어 처리한다.
  const onSend = async () => {
    if (sendLock.current) return;
    // 붙여 넣은 이미지가 아직 올라가는 중이면 보내지 않는다 — 그대로 보내면 받는 쪽에 빈 그림 자리만 남는다(WP-947).
    if (composerRef.current?.hasPendingImage()) {
      toast.error('이미지를 올리는 중이에요. 다 올라간 뒤 보내 주세요');
      return;
    }
    sendLock.current = true;
    setPreparingSend(true);
    // 실패한 채 작성창이 닫혀 있고 저장도 못 했을 때 「다시 열기」로 열 내용
    const reopen = snapshotDraft();
    // 붙여 넣은 이미지(WP-947) — 본문 src 를 cid: 로 바꾸고, 그 업로드를 첨부 id 에 함께 실어 서버가 인라인 파트로 붙이게 한다.
    // 위의 「올리는 중」 검사와 같은 순간의 본문으로 만든다 — 아래 기다리는 동안 새로 붙인 그림(아직 자리표시)이 빈 그림으로 나가지 않게.
    let bodyHtmlAtSend = bodyHtmlRef.current;
    // 서명 이미지(WP-1517)는 영구 파일이라 그대로 보낼 수 없다 — 보낼 때마다 작성창 업로드 사본을 만들고 src 를 그 경로로 바꿔,
    // 아래 붙여 넣은 이미지 경로(cid)를 그대로 탄다. 사본을 못 만들면 그림이 빠진 채 나가지 않게 보내지 않는다(임시저장은 그대로 이어진다).
    const signatureImages = signatureImageIds(bodyHtmlAtSend);
    if (signatureImages.length > 0) {
      try {
        const staged = await stageSignatureImages(signatureImages);
        bodyHtmlAtSend = replaceSignatureImageSrcs(
          bodyHtmlAtSend,
          new Map(staged.map((s) => [s.imageId, pastedImageSrc(s.uploadId)])),
        );
      } catch {
        toast.error('서명 이미지를 준비하지 못했어요');
        sendLock.current = false;
        setPreparingSend(false);
        return;
      }
    }
    const pasted = toSendablePastedImages(bodyHtmlAtSend);
    const bodyTextAtSend = bodyTextRef.current;
    const ticket = await autosave.beginSend();
    const body: MailSendRequest = {
      to: parseRecipientInput(to),
      cc: parseRecipientInput(cc),
      bcc: parseRecipientInput(bcc),
      subject,
      // 인용문은 에디터 밖에 있으므로 발송 시점에 뒤에 이어붙인다(설계 §7).
      bodyHtml: pasted.html + (draft.quote?.html ?? ''),
      bodyText: bodyTextAtSend + (draft.quote?.text ? '\n\n' + draft.quote.text : ''),
      inReplyToMessageId: draft.inReplyToMessageId,
      // WP-69 인용문 cid 이미지 — 서버가 원본 첨부를 같은 Content-ID 로 재첨부. 인용문을 지웠으면 보내지 않는다.
      inlineImages: draft.quote?.inlineImages.map(({ attachment, contentId }) => ({
        attachmentId: attachment.id,
        contentId,
      })),
      // WP-574 첨부 — 올린 파일은 업로드 id, 전달 원본은 받은 메일 첨부 id. 서버 거절(합계 초과·만료 등)은 실패 토스트로 보인다.
      ...uploadIdsWithBodyImages(attachments.items, bodyHtmlAtSend),
      inlineUploads: pasted.inlineUploads,
      draftId: ticket.draftId,
      // 작성 문맥(WP-1786) — 대기 행이 그대로 남겨, 되돌리거나 임시보관함에서 다시 열어도 전달·답장의 인용문을 원본으로 다시 만든다.
      mode: draft.mode,
      sourceMessageId: draft.sourceMessageId ?? null,
      quoteRemoved,
    };
    try {
      const queued = await send.mutateAsync({ accountId: draft.accountId, body });
      ticket.succeeded();
      closeInstance(instanceId as number);
      // 새 창은 보낸 뒤 메인 창에 알리고 닫힌다(페이지가 처리). 대기 행 id 를 실어 메인 창이 되돌릴 수 있게 한다(WP-1786).
      popout?.onDone('sent', draft.accountId, queued.draftId);
    } catch (e) {
      notifySendFailed(e, ticket.failed(), reopen);
    } finally {
      sendLock.current = false;
      setPreparingSend(false);
    }
  };

  /**
   * 보내기 실패 알림. 작성창이 그대로면(saving 없음) 서버 사유만 알린다 — 자동 저장은 훅이 다시 켰다.
   * 작성창을 닫았거나 다른 작성으로 바꿨으면 훅이 그 작성의 내용을 저장한 결과를 받아 한 토스트로 알린다 — 저장했으면 그 임시저장을 다시 열고,
   * 못 했으면 저장 안 된 내용으로 다시 연다(열자마자 다시 저장한다).
   */
  function notifySendFailed(e: unknown, saving: Promise<DraftFlushResult> | null, reopen: ComposeDraft) {
    const reason = extractApiError(e, '메일 발송에 실패했습니다');
    if (!saving) {
      toast.error(reason);
      return;
    }
    void saving.then((r) => {
      if (r.ok && r.draftId != null) {
        const id = r.draftId;
        toast.error('보내지 못해 임시보관함에 저장했어요', {
          description: reason,
          // 쓰던 작성을 다시 여는 길이라 작성 방식 기본값을 쓰지 않는다(WP-1744 — placement 없음, 새 창으로 튀지 않고 우측 하단).
          action: { label: '다시 열기', onClick: () => void openDraft(id) },
        });
      } else if (!r.ok) {
        toast.error('보내지 못했어요', {
          description: reason,
          action: {
            label: '다시 열기',
            onClick: () =>
              openCompose({ ...reopen, draftId: r.draftId ?? undefined, draftVersion: r.version ?? undefined, unsaved: true }),
          },
        });
      } else {
        // 저장할 것이 없던 빈 새 메일
        toast.error(reason);
      }
    });
  }

  const ccBccToggle = !showCcBcc && (
    <button
      type="button"
      onClick={() => setShowCcBcc(true)}
      // 터치에선 44px 높이 — 음수 세로 여백으로 줄 높이는 그대로 둔다(칸 줄 py-3 안에서 커진다).
      className="shrink-0 text-xs text-muted-foreground hover:text-foreground pointer-coarse:-my-3 pointer-coarse:min-h-11 pointer-coarse:px-1"
    >
      참조/숨은참조
    </button>
  );

  return (
    <>
      {isMobile && <MobileComposeHistory onClose={closeWithSave} />}
      <div
        data-testid="mail-compose-dock"
        // 작은 창·읽기 창은 페이지와 함께 쓰는 영역(region), 화면을 덮는 모양(모바일)만 대화상자로 알린다(aria-modal 없음 — 위 isModal 주석).
        role={isModal ? 'dialog' : 'region'}
        // 패널에 아무 role/label 도 없어 스크린리더가 새 UI 등장을 안내하지 못하던 문제 수정 —
        // 헤더 텍스트를 프로그램적 이름으로 연결 (#802).
        aria-labelledby="mail-compose-dock-title"
        // 기본값 「새 창」으로 옮기는 중(WP-1744)엔 감춘다 — 우측 하단 창이 잠깐 보였다 사라지는 깜빡임을 막는다(편집기는 그대로 만들어진다).
        className={cn(PANEL_CLASS[layout], movingToWindow && 'invisible')}
        // 떠나는 중(새 창으로 옮기는 저장·새 창을 닫기 전 저장)엔 손댈 수 없게 — 그사이 쓴 것이 저장에서 빠지지 않게.
        inert={leaving}
        aria-busy={leaving || undefined}
        {...dropProps}
      >
        <MailComposeDropOverlay active={isDragging} />
        {/* 📎 이 여는 파일 선택 — 같은 파일을 다시 고를 수 있게 고른 뒤 값을 비운다. */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          data-testid="mail-compose-file-input"
          onChange={(e) => {
            attachments.addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        {isMobile ? (
          // 모바일 상단 바 — 메일 상세 헤더와 같은 56px 규격. 보내기를 위에 둬 키보드가 올라와도 가리지 않는다.
          <div className={mobileDetailBarClass}>
            <button
              type="button"
              aria-label="닫기"
              data-testid="mail-compose-close"
              onClick={closeWithSave}
              className={mobileBackButtonClass}
            >
              <X className="h-6 w-6" />
            </button>
            {/* 제목 + 그 아래 임시저장 상태 한 줄(WP-577). 56px 바 안에 두 줄이 들어가게 제목 줄 높이를 줄인다.
                오른쪽 pr-2 — 상태 옆 동작(다시 불러오기 등)의 투명 터치 영역(좌우 8px)이 🗑 위로 넘어가 🗑 가장자리 탭을 가로채지 않게. */}
            <div className="flex min-w-0 flex-1 flex-col justify-center pr-2">
              <h2 id="mail-compose-dock-title" className="truncate text-[17px] font-semibold leading-snug">
                {composeTitle(draft)}
              </h2>
              {autosave.status !== 'idle' && <div className="flex min-w-0 leading-4">{saveStatus}</div>}
            </div>
            {/* 🗑 버리기 — 📎 왼쪽. 보내기와 사이에 📎 를 두어 잘못 누르기 어렵게 하고, 곁 동작이라 기본 글자색. */}
            <HeaderIconAction label="버리기" tone="default" onClick={discardDraft} data-testid="mail-compose-discard">
              <Trash2 />
            </HeaderIconAction>
            {/* ✒ 서명 넣기·빼기(WP-1517) — 🗑 와 📎 사이. 본문에 서명이 있으면 주 색, 없으면 기본 글자색(HeaderIconAction 에 흐린 톤이 없다). */}
            <HeaderIconAction
              label={signatureLabel}
              tone={signatureInBody ? 'primary' : 'default'}
              onClick={toggleSignature}
              disabled={signature.isPending}
              data-testid="mail-compose-signature"
            >
              <PenLine />
            </HeaderIconAction>
            {/* 📎 — 보내기 왼쪽. 하단 서식 줄은 글자 서식만 두고, 첨부는 메일 앱들처럼 상단 바에 둔다. */}
            {/* 곁 동작이라 보내기(주 색)보다 덜 눈에 띄게 기본 글자색. */}
            <HeaderIconAction label="파일 첨부" tone="default" onClick={openFilePicker} data-testid="mail-compose-attach">
              <Paperclip />
            </HeaderIconAction>
            <HeaderIconAction label="보내기" onClick={() => void onSend()} disabled={sendDisabled} data-testid="mail-compose-send">
              {send.isPending || preparingSend ? <Loader2 className="animate-spin" /> : <Send />}
            </HeaderIconAction>
          </div>
        ) : (
          // 상단 모서리는 우측 하단 작은 창(dock)만 둥글린다 — 읽기 창(pane)은 모서리 없는 패널, 새 창(fill)은 창 전체라 둥글릴 모서리가 없다.
          <div className={cn('flex items-center justify-between gap-2 bg-muted px-3 py-2', layout === 'dock' && 'rounded-t-lg')}>
            {/* 제목 + 임시저장 상태(WP-577) — 제목이 길면 제목만 말줄임하고 상태는 그대로 보인다. */}
            <div className="flex min-w-0 items-baseline gap-2">
              <span id="mail-compose-dock-title" className="truncate text-sm font-medium">
                {subject || '새 메일'}
              </span>
              {saveStatus}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {/* 새 창에는 최소화·읽기 창·새 창 단추가 없다 — 창 크기는 브라우저 창이 정한다. */}
              {!popout && (
                <>
                  {layout === 'pane' ? (
                    // ↩ 우측 하단으로(WP-1743) — 읽기 창 자리를 내리고 주차 칸(우측 하단 작은 창)으로 되돌린다. 쓰던 본문은 남는다(숨김뿐, 언마운트 금지).
                    <button
                      type="button"
                      aria-label="우측 하단으로"
                      title="우측 하단으로"
                      data-testid="mail-compose-to-dock"
                      onClick={() => setSize('min')}
                      className="rounded p-1 hover:bg-accent"
                    >
                      <Minimize2 className="h-4 w-4" />
                    </button>
                  ) : (
                    <>
                      {/* ⌄ 최소화 — 본문만 숨긴다(에디터를 다시 만들지 않는다, WP-576). 최소화 중 다시 누르면 작은 창으로. */}
                      <button
                        type="button"
                        aria-label="최소화"
                        data-testid="mail-compose-minimize"
                        onClick={() => setSize((v) => (v === 'min' ? 'dock' : 'min'))}
                        className="rounded p-1 hover:bg-accent"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      {/* ⤢ 읽기 창으로(WP-1743) — 호스트를 메일 읽기 자리 슬롯으로 옮긴다. 쓸 수 없는 이유는 툴팁(paneDisabledReason). */}
                      <button
                        type="button"
                        aria-label="읽기 창으로"
                        title={paneDisabledReason ?? '읽기 창으로'}
                        disabled={paneDisabledReason != null}
                        data-testid="mail-compose-to-pane"
                        onClick={() => setSize('pane')}
                        className="rounded p-1 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <Maximize2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  {/* ↗ 새 창으로 열기(WP-1535) — 다른 앱 화면을 보면서 쓸 수 있게 독립 창으로 옮긴다(데스크톱 전용). */}
                  <button
                    type="button"
                    aria-label="새 창으로 열기"
                    title={popoutBlockedReason ?? '새 창으로 열기'}
                    disabled={popoutBlockedReason != null}
                    data-testid="mail-compose-popout"
                    onClick={() => popOut()}
                    className="rounded p-1 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label="닫기"
                data-testid="mail-compose-close"
                // 모바일과 같은 규칙 — 묻지 않고 임시저장한 뒤 닫는다(WP-577).
                onClick={closeWithSave}
                // 새 창은 보내는 동안 닫지 않는다 — 창이 닫히면 나가던 발송 요청이 끊긴다.
                disabled={!!popout && (send.isPending || preparingSend)}
                className="rounded p-1 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* 모바일 잠금 이유 상태 줄 — 상단 바(보내기) 바로 아래. 보내기가 왜 꺼졌는지 보내기 가까이에서 알린다(데스크톱은 칩 목록 위 줄·보내기 툴팁).
            낭독은 칩 목록의 live 영역이 하므로 aria-hidden. */}
        {isMobile && block && (
          <div
            aria-hidden
            data-testid="mail-compose-send-blocked"
            className={cn(
              'shrink-0 border-b px-4 py-1.5 text-xs',
              block.tone === 'error' ? 'bg-destructive-subtle text-destructive-text' : 'bg-muted text-muted-foreground',
            )}
          >
            {block.reason}
          </div>
        )}
        {/* 모바일엔 최소화가 없다 — 데스크톱에서 최소화한 채 모바일 폭으로 줄어도 본문은 보인다.
            최소화는 숨기기만 한다(언마운트 금지) — 에디터가 다시 만들어지면 쓰던 본문·진행 중 AI 초안 반영·되돌리기 기준을 잃는다(WP-576).
            display:none 이라 숨은 동안엔 초점·단축키가 안으로 가지 않는다. */}
        <div className={cn(BODY_CLASS[layout], minimized && 'hidden')}>
          {/* 작성 회차마다 새로 그린다 — 앞 작성의 쓰던 조각·닫아 둔 후보 상태가 다음 작성으로 넘어가지 않게(WP-945). */}
          <MailRecipientInput key={draft?.instanceId} label="받는사람" mobile={isMobile} testId="mail-compose-to" value={to} onChange={edit(setTo)} inputRef={toInputRef} trailing={ccBccToggle} />
          {showCcBcc && (
            <>
              {/* 참조·숨은참조는 같은 Fragment 아래 형제라 칸 이름을 앞에 붙여 key 를 가른다 — 회차만 쓰면 중복 key 라
                  React 가 한쪽을 잘못 재사용·누락할 수 있다(WP-1594). 회차가 바뀌면 key 도 바뀌어 다시 그리는 의도(WP-945)는 그대로. */}
              <MailRecipientInput key={`cc-${draft?.instanceId}`} label="참조" mobile={isMobile} testId="mail-compose-cc" value={cc} onChange={edit(setCc)} />
              <MailRecipientInput key={`bcc-${draft?.instanceId}`} label="숨은참조" mobile={isMobile} testId="mail-compose-bcc" value={bcc} onChange={edit(setBcc)} />
            </>
          )}
          <FieldRow label="제목" mobile={isMobile} testId="mail-compose-subject" value={subject} onChange={changeSubject} maxLength={MAIL_SUBJECT_MAX} />
          {/* 작성/AI 검토 탭 */}
          <div className="flex border-b border-border text-sm" data-testid="mail-compose-tabs">
            <button
              type="button"
              className={`flex-1 py-1.5 font-medium pointer-coarse:min-h-11 ${tab === 'compose' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}
              onClick={() => setTab('compose')}
            >
              작성
            </button>
            <button
              type="button"
              data-testid="mail-review-tab"
              // 코칭 payload 에는 인용문이 실리지 않으므로(§6) 본문이 비어 있으면 검토 대상이 없다
              disabled={!hasBody || aiGenerating}
              className={`flex-1 py-1.5 font-medium pointer-coarse:min-h-11 disabled:opacity-50 ${tab === 'review' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}
              onClick={() => {
                setTab('review');
                runCoaching();
              }}
            >
              {/* 탭은 「작성」 탭과 글자 모양을 공유 — AiLabel 대신 아이콘만 AI 색(§7.2 아이콘 1차, 색 보조). */}
              <span className="inline-flex items-center justify-center gap-1">
                <AiIcon className={cn('size-3', tab !== 'review' && 'text-ai-accent')} />
                AI 검토
              </span>
            </button>
          </div>

          {/* 본문(작성 탭) — review 일 때 숨김(언마운트 금지). 읽기 창·새 창은 에디터가 남은 높이를 채우도록 세로로 늘린다. */}
          <div className={cn(fillsHeight && 'flex flex-1 flex-col', tab === 'review' && 'hidden')}>
            {/* AI 초안(WP-576) — 제목 줄 아래·본문 바로 위. 패널이 열려 있으면 패널, 끝난 뒤 손대지 않았으면 얇은 줄. */}
            {/* 실패 패널은 계정 AI 가 방금 꺼져 진입점이 사라져도(계정 목록 재조회) 문구를 읽고 닫을 수 있게 남긴다. */}
            {draft.mode === 'new' && ai.phase !== 'closed' && (aiDraftEnabled || ai.phase === 'error') && (
              <div className="mb-2">
                <AiDraftPanel
                  phase={ai.phase}
                  instruction={ai.instruction}
                  onInstructionChange={ai.setInstruction}
                  hasBody={hasBody}
                  error={ai.error}
                  onGenerate={runAiDraft}
                  onCancel={ai.close}
                  onStop={ai.stop}
                  touch={isMobile}
                />
              </div>
            )}
            {aiDraftEnabled && ai.phase === 'closed' && ai.filled && (
              <div className="mb-1.5">
                <AiDraftBar onRewrite={ai.open} onUndo={undoAiDraft} />
              </div>
            )}
            {/* 생성 중 본문은 손댈 수 없게(inert) 흐리게 — 빈 본문이면 글줄 스켈레톤을 겹친다. */}
            <div
              inert={aiGenerating}
              aria-busy={aiGenerating || undefined}
              className={cn(fillsHeight && 'flex flex-1 flex-col', aiGenerating && 'opacity-50 transition-opacity')}
            >
              <MailComposer
                key={`composer-${draft.instanceId}`}
                ref={composerRef}
                layout={editorLayout}
                initialHtml={composeInitialHtml}
                imageUpload={uploadPastedImage}
                onChange={(html, text, initial, info) => {
                  bodyHtmlRef.current = html;
                  bodyTextRef.current = text;
                  setSignatureInBody(info.hasSignature);
                  // 붙여 넣은 그림만 있는 본문도 쓴 내용이다(WP-947) — 비었다고 보면 AI 초안 칩이 그림을 덮고, 초안이 그림을 갈아 끼운다.
                  // 서명은 쓴 내용이 아니다(WP-1517) — 서명만 있는 새 메일에도 AI 초안 칩이 보이고 검토 탭은 꺼진다.
                  setHasBody(!info.bodyEmpty);
                  if (initial) {
                    bodyBaselineRef.current = html;
                    setComposerReadyFor(draft.instanceId);
                  }
                  setBodyEdited(html !== bodyBaselineRef.current);
                  ai.noteBodyChange(html);
                  // 에디터가 처음 채운 본문은 쓴 내용이 아니다 — 그 뒤 바뀔 때만 자동 저장을 예약한다.
                  if (!initial) autosave.schedule();
                }}
                toolbarEnd={
                  aiDraftEnabled && (
                    <AiDraftToolbarButton
                      touch={isMobile}
                      // 패널이나 「AI 초안이에요」 줄이 이미 AI 표식을 보이고 있으면 버튼엔 표식을 빼고 기능만(디자인 시스템 §7.2).
                      marked={ai.phase === 'closed' && !ai.filled}
                      expanded={ai.phase !== 'closed'}
                      onClick={ai.phase === 'closed' ? ai.open : ai.close}
                    />
                  )
                }
                bodyOverlay={
                  aiDraftEnabled &&
                  (aiGenerating && !hasBody ? (
                    <AiDraftSkeleton />
                  ) : ai.phase === 'closed' && !hasBody && !ai.filled ? (
                    <div className="flex justify-end">
                      <AiDraftChip onClick={ai.open} />
                    </div>
                  ) : null)
                }
              />
            </div>
            {/* 인용문 — 에디터 밖(읽기 전용). AI 개선본 교체 대상이 아니므로 원문이 보존된다. */}
            {draft.quote && (
              <MailQuoteBlock
                key={`quote-${draft.instanceId}`}
                quoteHtml={draft.quote.html}
                meta={draft.quote.meta}
                variant={draft.quote.variant}
                onRemove={() => {
                  clearQuote();
                  setQuoteRemoved(true);
                  autosave.schedule();
                }}
                inlineImages={draft.quote.inlineImages}
              />
            )}
          </div>

          {/* 첨부 칩(모바일) — 본문(·인용문) 아래 흐름 안. 본문 영역 아래 여백(BODY_CLASS)이 하단 서식 줄 높이만큼 있어 마지막 줄이 가리지 않는다.
              데스크톱은 아래 고정 줄에서 보내기와 함께 보인다. AI 검토 탭에서도 보여 무엇이 함께 나가는지 놓치지 않게 한다. */}
          {isMobile && attachmentChips}

          {/* 코칭 패널(검토 탭) — AI 생성물이므로 AiContent 아우라로 감쌈 */}
          {tab === 'review' && (
            <AiContent label="AI 검토" data-testid="mail-coaching-panel">
            <div className="flex flex-col gap-2 text-sm">
              {coach.isPending && (
                <p className="text-muted-foreground" data-testid="mail-coaching-loading">
                  AI가 초안을 검토하는 중…
                </p>
              )}
              {coach.isError && (
                // 503(AI off·비서 미설정) 등 서버가 친화적 메시지를 내려주면 그 메시지를 우선 표시(오류 코드 문자열은 보이지 않는다).
                // 본문이 없으면 일반 재시도 안내로 폴백.
                <p className="text-destructive" data-testid="mail-coaching-error">
                  {extractApiError(coach.error, 'AI 검토에 실패했어요. 다시 시도해주세요.')}
                </p>
              )}
              {coach.data && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">전체 코칭</span>
                    {coach.data.notes.length === 0 ? (
                      <p className="text-muted-foreground" data-testid="mail-coaching-clean">
                        특별히 고칠 곳이 없어요. 보내셔도 좋아요.
                      </p>
                    ) : (
                      coach.data.notes.map((n: CoachingNote, i) => (
                        <div key={i} className="flex gap-2" data-testid="mail-coaching-note">
                          <span className="flex-none rounded bg-muted px-1.5 text-xs font-bold text-muted-foreground">
                            {dimensionLabel(n.dimension)}
                          </span>
                          <span className="text-foreground">{n.message}</span>
                        </div>
                      ))
                    )}
                  </div>
                  {improvedPreviewHtml && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase text-muted-foreground">다듬은 개선본</span>
                      {/* LLM 생성 HTML 은 공용 격리 iframe(SandboxedHtmlFrame, sandbox="")으로 렌더해 XSS 방지. */}
                      <SandboxedHtmlFrame
                        data-testid="mail-coaching-improved"
                        title="다듬은 개선본"
                        html={improvedPreviewHtml}
                        // 에디터 입력칸과 같은 테두리·배경.
                        className="min-h-[8rem] w-full rounded-md border border-input bg-background"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          data-testid="mail-coaching-apply"
                          className="rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
                          onClick={() => {
                            // 개선본 교체 → 본문이 바뀌므로 코칭 결과는 stale. reset 하고 다음 검토 진입 시 재실행.
                            // 개선본은 서명을 뺀 본문으로 만들었으므로 지금 서명 블록을 끝에 다시 붙인다(WP-1517).
                            composerRef.current?.setContent(replaceBodyKeepingSignature(bodyHtmlRef.current, coach.data!.improvedBodyHtml));
                            coach.reset();
                            lastCoachedRef.current = null;
                            setTab('compose');
                          }}
                        >
                          개선본으로 교체
                        </button>
                        <button
                          type="button"
                          data-testid="mail-coaching-keep"
                          className="rounded border border-border px-3 py-1 text-xs font-medium"
                          onClick={() => setTab('compose')}
                        >
                          그대로 두기
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            </AiContent>
          )}

          {/* 아래 고정 줄(데스크톱) — 첨부 칩 + 📎·보내기. 작은 창·읽기 창 모두 본문(긴 전달 인용 등)이 스크롤돼도 창 아래에 남는다.
              본문 영역 패딩(p-3) 아래까지 덮어 그 틈으로 스크롤되는 글이 비치지 않게 하고, 위 경계선으로 스크롤되는 본문과 나눈다. 모바일은 보내기가 상단 바에 있다. */}
          {!isMobile && (
            <div
              data-testid="mail-compose-footer"
              // -bottom-3 — sticky 는 스크롤 영역 padding(p-3) 안쪽 끝에 붙으므로 그만큼 내려 창 아래끝에 맞춘다
              // (bottom-0 이면 12px 떠서 본문과 겹치고 아래 틈으로 뒤 글이 비쳤다).
              className="sticky -bottom-3 z-10 -mx-3 -mb-3 flex flex-col gap-2 border-t bg-background px-3 pt-2 pb-3"
            >
              {attachmentChips}
              <div className="flex items-center justify-end gap-1">
                {/* 🗑 버리기(WP-577) — 줄 왼쪽 끝. 보내기와 멀리 두어 잘못 누르기 어렵게 한다. */}
                <button
                  type="button"
                  aria-label="버리기"
                  title="버리기"
                  data-testid="mail-compose-discard"
                  onClick={discardDraft}
                  className="mr-auto flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Trash2 className="size-4" />
                </button>
                {/* ✒ 서명 넣기·빼기(WP-1517) — 📎 바로 왼쪽. 본문에 서명이 있으면 주 색, 없으면 흐리게. */}
                <button
                  type="button"
                  aria-label={signatureLabel}
                  title={signatureLabel}
                  data-testid="mail-compose-signature"
                  onClick={toggleSignature}
                  disabled={signature.isPending}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50',
                    signatureInBody ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <PenLine className="size-4" />
                </button>
                {/* 📎 — 보내기 바로 옆(Gmail 처럼 보내기와 한 묶음). 보내기가 오른쪽 끝이라 그 왼쪽에 둔다. */}
                <button
                  type="button"
                  aria-label="파일 첨부"
                  title="파일 첨부"
                  data-testid="mail-compose-attach"
                  onClick={openFilePicker}
                  className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Paperclip className="size-4" />
                </button>
                <button
                  type="button"
                  data-testid="mail-compose-send"
                  onClick={() => void onSend()}
                  disabled={sendDisabled}
                  title={blockedReason ?? undefined}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {send.isPending || preparingSend ? '전송 중…' : '보내기'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
});

/** 코칭 차원 → 한글 짧은 라벨. */
function dimensionLabel(d: CoachingNote['dimension']): string {
  if (d === 'TONE') return '톤'
  if (d === 'CLARITY') return '명료'
  return '완결'
}
