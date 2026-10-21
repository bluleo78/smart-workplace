// 메일 작성창. 보내기 = useSendMail. MailComposeProvider 의 draft 가 있으면 렌더, 없으면 null.
// - 데스크톱: Gmail식 우하단 작은 창. 최소화/크게 보기(WP-575)/닫기.
// - 모바일: 다른 메일 앱처럼 처음부터 화면 전체 작성 화면(WP-583). 상단 바 [✕] 제목 … [📎 파일 첨부] [➤ 보내기].
// - 첨부(WP-574): 📎(데스크톱은 보내기 옆, 모바일은 상단 바)·창 위로 끌어다 놓기 → 바로 올리고 본문 아래 칩으로 보인다.
// - 임시저장(WP-577): 쓰는 동안 1.5초마다 자동 저장하고 상태를 제목 옆(모바일은 제목 아래)에 보인다. ✕·뒤로가기는 묻지 않고
//   남은 저장을 마친 뒤 닫는다. 버리기(🗑)는 임시저장을 지우고 「되돌리기」 토스트를 띄운다.

import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Maximize2, Minimize2, Minus, Paperclip, Send, Sparkles, Trash2, X } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useAssistant } from '@/components/ai/AIAssistantContext';
import { AiContent } from '@/components/ai/AiContent';
import { inertPageArea } from '@/components/ai/aiPanelSurface';
import { AI_SIDE_CENTER_CLASS, AI_SIDE_OVERLAY_CLASS } from '@/components/ai/useAiPanelAwareDialog';
import { mobileBackButtonClass, mobileDetailBarClass } from '@/components/mobile/headerClass';
import { HeaderIconAction } from '@/components/mobile/HeaderIconAction';
import { isKeyboardEditable } from '@/components/mobile/useVisualViewport';
import { useMailAccounts } from '@/hooks/queries/useMailAccounts';
import { restoreMailDraft, toastDraftDiscarded, useOpenMailDraft } from '@/hooks/queries/useMailDrafts';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import { useComposerFileDrop } from '@/hooks/useComposerFileDrop';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useMailComposeAttachments } from '@/hooks/useMailComposeAttachments';
import { useMailDarkHtml } from '@/hooks/useMailDarkHtml';
import { type DraftFlushResult, type DraftSnapshot, hasUnsavedDraft, useMailDraftAutosave } from '@/hooks/useMailDraftAutosave';
import { useSheetHistory } from '@/hooks/useSheetHistory';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { extractApiError } from '@/lib/api-error';
import { withComposerPreviewStyle } from '@/lib/composerPreviewHtml';
import { isImeComposing } from '@/lib/imeKey';
import { type ComposeAttachment, quoteInlineBytes, sendAttachmentIds } from '@/lib/mailComposeAttachments';
import { buildDraftSavePayload } from '@/lib/mailDraftCompose';
import { parseRecipientInput } from '@/lib/mailRecipients';
import { cn } from '@/lib/utils';

import { useCoachDraft, useSendMail } from '../../hooks/queries/useMailMessages';
import type { CoachingNote, MailSendRequest } from '../../types/mailMessage';
import { SandboxedHtmlFrame } from '../SandboxedHtmlFrame';
import { AiDraftBar, AiDraftChip, AiDraftPanel, AiDraftSkeleton, AiDraftToolbarButton } from './MailAiDraft';
import { MailComposeAttachmentChips } from './MailComposeAttachmentChips';
import { type ComposeDraft, useMailCompose } from './MailComposeContext';
import { MailComposeDropOverlay } from './MailComposeDropOverlay';
import { MailComposer, type MailComposerHandle, type MailComposerLayout } from './MailComposer';
import { MailDraftSaveStatus } from './MailDraftSaveStatus';
import { MailQuoteBlock } from './MailQuoteBlock';
import { useMailAiDraft } from './useMailAiDraft';

/**
 * 작성창 껍데기 — 모바일 화면 전체 / 데스크톱 가운데 큰 창 / 데스크톱 우하단 작은 창. 에디터 배치(MailComposerLayout)와 같은 축.
 * - mobile: 탭바도 덮는다. 가상 키보드가 열리면 보이는 영역(--vv-top ~ 아래 --kb-inset)만 차지해 상단 바(보내기)와
 *   하단 서식 버튼이 모두 키보드 밖에 남는다(WP-154 — iOS 는 키보드가 열리며 보이는 영역이 아래로 밀리기도 한다).
 * - fill·dock 은 데스크톱 셸 전용이라 키보드 변수(--vvh·--kb-inset — 모바일 셸만 쓴다)에 기대지 않는다.
 * - fill: 다른 다이얼로그(useAiPanelAwareDialog)처럼 AI 와 함께 쓴다 — 같은 z-50 이라 AI 칩(z-[70])이 위에 남고,
 *   AI 옆 패널이 열려 있으면(--ai-side-width) 패널을 뺀 페이지 영역 가운데에 놓인다. 그 위에 여는 링크 창은 나중 포털이라 위에 뜬다.
 *   tabIndex=-1 이라 창 안 빈 곳을 눌러도 초점이 창에 남아 Esc 가 먹는다 — 그 초점 테두리는 숨긴다.
 *   (fill 은 데스크톱 전용이라 공용 클래스의 lg: 접두는 늘 적용된다.)
 */
const PANEL_CLASS: Record<MailComposerLayout, string> = {
  mobile: 'fixed inset-x-0 top-[var(--vv-top,0px)] bottom-[var(--kb-inset,0px)] z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]',
  fill: `${AI_SIDE_CENTER_CLASS} fixed top-1/2 z-50 flex h-[min(85vh,calc(100vh-2rem))] w-[min(960px,92vw,calc(100%-var(--ai-side-width,0px)-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-background shadow-2xl outline-none`,
  dock: 'fixed bottom-0 right-4 z-50 flex w-[32rem] max-w-[calc(100vw-2rem)] flex-col rounded-t-lg border border-b-0 bg-background shadow-2xl',
};

/** 본문 영역 — 모바일은 하단 고정 서식 버튼(44px+여백+홈 인디케이터 안전영역)만큼 아래 여백, 크게 보기는 남은 높이를 채움, 작은 창은 화면 높이 안으로 제한. */
const BODY_CLASS: Record<MailComposerLayout, string> = {
  // 모바일 아래 여백은 서식 줄 높이(3.5rem)에 0.5rem 을 더해 마지막 첨부 칩과 서식 줄 사이를 띄운다.
  mobile: 'flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 pb-[calc(4rem+env(safe-area-inset-bottom))]',
  fill: 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3',
  dock: 'flex max-h-[min(75vh,calc(100vh-3rem))] flex-col gap-2 overflow-y-auto p-3',
};

/** 모바일 상단 바 제목 — 전달(인용문이 전달용) / 회신(답장 대상 있음) / 새 메일. */
function composeTitle(draft: ComposeDraft): string {
  if (draft.mode === 'forward') return '전달';
  if (draft.mode === 'reply') return '회신';
  return '새 메일';
}

/**
 * 받는사람·참조·제목 한 줄. 모바일은 칸 앞에 이름표를 붙이고(빈 새 메일에서도 칸이 구분되게, WP-583),
 * 데스크톱은 작은 창 공간을 아끼려 자리표시자만 쓴다.
 */
function FieldRow({
  label,
  mobile,
  testId,
  value,
  onChange,
  inputRef,
  trailing,
  maxLength,
}: {
  label: string;
  mobile: boolean;
  testId: string;
  value: string;
  onChange: (v: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  trailing?: ReactNode;
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
        ref={inputRef}
        id={testId}
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        placeholder={mobile ? undefined : label}
        className={cn('min-w-0 flex-1 bg-transparent outline-none', mobile ? 'text-[15px]' : 'text-sm')}
      />
      {trailing}
    </div>
  );
}

/** 제목 길이 상한 — 서버 MailComposeLimits.MAX_SUBJECT_LENGTH(임시저장·발송 공통)와 같은 값. */
const MAIL_SUBJECT_MAX = 500;

/** 버림 확인이 없어졌으므로(WP-577 — back 은 자동 저장 후 닫기) 막힌 back 처리가 쓰이지 않는다. */
const noop = () => {};

/**
 * 모바일 작성 화면은 페이지처럼 보이므로 시스템 back 이 작성 화면을 닫게 히스토리 항목 하나에 묶는다(WP-222 공용 훅).
 * back 은 ✕ 와 같이 묻지 않고 남은 임시저장을 마친 뒤 닫는다(WP-577) — 그래서 hasContent 를 늘 false 로 넘겨 막지 않는다.
 * 열려 있을 때만 마운트한다 — 훅이 위치(useLocation)를 구독하므로, 작성창 본체에 두면 모든 페이지 이동마다 작성창이 다시 렌더된다.
 */
function MobileComposeHistory({ onClose }: { onClose: () => void }) {
  useSheetHistory({ historyKey: 'mailCompose', open: true, hasContent: false, onClose, onBlockedBack: noop });
  return null;
}

/**
 * 작성창 — AI 컨텍스트에서 "전체 화면인가" 하나만 읽어 본체에 넘긴다.
 * 컨텍스트는 옆 패널 폭(드래그 중 매 프레임)·프롬프트 등으로 자주 바뀌므로, 본체(에디터·코칭 미리보기)는 memo 로 그 값이 바뀔 때만 다시 그린다.
 */
export function MailComposeDock() {
  const aiFullscreen = useAssistant().mode === 'fullscreen';
  return <MailComposeDockBody aiFullscreen={aiFullscreen} />;
}

/** 작성창 본체. draft 없으면 렌더 안 함. */
const MailComposeDockBody = memo(function MailComposeDockBody({ aiFullscreen }: { aiFullscreen: boolean }) {
  const { draft, openCompose, closeCompose, closeInstance, clearQuote, bindDraftId, setComposeHandlers } = useMailCompose();
  const send = useSendMail();
  const qc = useQueryClient();
  const openDraft = useOpenMailDraft();

  const composerRef = useRef<MailComposerHandle>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const coach = useCoachDraft();
  const [tab, setTab] = useState<'compose' | 'review'>('compose');
  const [hasBody, setHasBody] = useState(false);
  // 마지막으로 코칭한 본문 HTML — 본문이 바뀌면(편집/개선본 교체) 재검토를 트리거하기 위한 stale 가드.
  // 평문이 아니라 HTML 로 비교한다(WP-404) — AI 입력이 HTML 이라, 굵게·빈 줄만 바꿔도 다시 검토해야 교체 때 그 서식이 남는다.
  const lastCoachedRef = useRef<string | null>(null);

  const isMobile = useIsMobile();
  // 새 메일 AI 초안(WP-576) — 새 메일에서만, 회신 AI 초안 버튼과 같은 조건(쓸 수 있는 비서 + 이 계정 AI 사용)일 때.
  const aiAvailable = useAiAvailable();
  const { data: accounts } = useMailAccounts();
  const accountAiEnabled = accounts?.find((a) => a.id === draft?.accountId)?.aiEnabled ?? false;
  const aiDraftEnabled = draft?.mode === 'new' && aiAvailable && accountAiEnabled;
  const ai = useMailAiDraft(draft?.accountId);
  const aiGenerating = ai.phase === 'generating';
  // AI 초안을 넣은 뒤 본문 초점 요청(회차) — 생성 중 inert 가 풀린 렌더 뒤에 처리한다. 처리한 회차는 ref 로 기억한다.
  const [aiFocusRequest, setAiFocusRequest] = useState(0);
  const aiFocusDoneRef = useRef(0);
  // 데스크톱 창 크기 — 작은 창 / 최소화 / 크게 보기(WP-575). 하나의 상태라 최소화와 크게 보기가 동시에 걸리지 않는다.
  // 새 작성마다 작은 창으로 시작한다("항상 크게" 설정 없음). 모바일은 항상 화면 전체라 이 값을 쓰지 않는다.
  const [size, setSize] = useState<'dock' | 'min' | 'fill'>('dock');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState('');
  // 지금 제목 — 늦게 도착한 AI 초안이 "응답 때의 제목"으로 판정하도록(생성 중 쓴 제목을 덮지 않게, WP-576) 화면 값과 함께 갱신한다.
  const subjectRef = useRef('');
  // 본문은 ref 로 보관(매 키 입력마다 리렌더 방지).
  const bodyHtmlRef = useRef('');
  const bodyTextRef = useRef('');
  // 본문을 사용자가 고쳤는지 — 처음 채워진 본문(AI 답장 초안 등)과 비교한다. 기준은 에디터가 만들어질 때의 HTML.
  const bodyBaselineRef = useRef('');
  const [bodyEdited, setBodyEdited] = useState(false);
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

  // AI 전체화면은 페이지(main) 안에 그려져 크게 보기의 inert·배경에 함께 가려지므로, 그동안은 작은 창으로 보인다.
  // AI 를 닫거나 옆 패널로 돌리면 다시 크게 보기로 돌아온다(크기 상태는 그대로). 그동안 크게 보기 버튼은 끈다.
  const layout: MailComposerLayout = isMobile
    ? 'mobile'
    : size === 'fill' && !aiFullscreen
      ? 'fill'
      : 'dock';
  const isExpanded = layout === 'fill';
  // 모바일 화면 전체·데스크톱 크게 보기는 화면을 덮는 대화상자다 — 그동안 뒤 페이지를 inert 로 만들어
  // Tab·보조기기가 가려진 페이지로 새지 않게 한다(useAiPanelAwareDialog 와 같은 공용 처리 — AI 표면은 그대로 쓸 수 있다).
  // aria-modal 은 달지 않는다 — 보조기기가 대화상자 밖의 AI 까지 무시하게 되므로(useAiPanelAwareDialog 와 같은 이유).
  const isModal = !!draft && (isMobile || isExpanded);
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
      attachments: attachments.items,
    }),
    // 「다시 열기」로 연 저장 안 된 내용은 처음 값과 같아도 저장 대상이다(새 메일도 POST 한다).
    empty: !hasContent && !draft?.unsaved,
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
    if (!draft) return;
    setSize('dock');
    setTo(draft.to.join(', '));
    setCc(draft.cc.join(', '));
    setBcc(draft.bcc.join(', '));
    setShowCcBcc(draft.cc.length > 0 || draft.bcc.length > 0);
    setSubject(draft.subject);
    subjectRef.current = draft.subject;
    bodyHtmlRef.current = draft.initialHtml;
    bodyTextRef.current = '';
    // 새 draft 진입 시 탭/코칭 결과 초기화.
    setTab('compose');
    coach.reset();
    lastCoachedRef.current = null;
    setHasBody(false);
    setBodyEdited(false);
    // 임시보관함에서 연 작성은 지웠던 인용문 상태를 이어받는다 — 다음 저장이 quoteRemoved 를 false 로 되돌려 인용문이 되살아나지 않게.
    setQuoteRemoved(!!draft.quoteRemoved);
    // 본문 리치텍스트 에디터가 자동으로 포커스를 가져가 수신자→제목→본문 순서를 건너뛰던
    // 문제 수정 — 패널이 열리면 "받는사람"으로 초점을 명시적으로 이동 (#802).
    toInputRef.current?.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.instanceId]);

  // 개선본 미리보기 문서(WP-404) — 에디터와 같은 문단·글자 규칙을 입히고, 다크 테마면 받은 메일 본문처럼 테마색으로 바꾼다.
  // 그래야 미리보기에서 본 모습이 "개선본으로 교체" 후 에디터 모습과 같다.
  const improvedHtml = coach.data?.improvedBodyHtml;
  const styledImprovedHtml = useMemo(
    () => (improvedHtml ? withComposerPreviewStyle(improvedHtml) : null),
    [improvedHtml],
  );
  const improvedPreviewHtml = useMailDarkHtml(styledImprovedHtml);

  // AI 초안을 넣은 뒤 본문 끝에 초점(WP-576) — 렌더가 끝나 생성 중 inert 가 풀린 다음에 준다(그 전엔 focus 가 무시된다).
  // 최소화로 숨어 있으면 옮기지 않는다 — 숨은 에디터는 초점을 받지 못하고, 페이지에서 하던 일을 빼앗지 않게. 요청은 처리한 것으로 친다.
  const minimized = size === 'min' && !isMobile;
  useEffect(() => {
    if (aiGenerating || aiFocusRequest === aiFocusDoneRef.current) return;
    aiFocusDoneRef.current = aiFocusRequest;
    if (!minimized) composerRef.current?.focusEnd();
  }, [aiFocusRequest, aiGenerating, minimized]);

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
  const closeWithSave = () => {
    saveAndNotify();
    closeCompose();
  };

  // 🗑 버리기 — 임시저장을 지우고 닫는다. 쓴 것이 있었으면 「되돌리기」로 같은 내용을 새 임시저장으로 만들어 다시 연다.
  const discardDraft = () => {
    const reopen = snapshotDraft();
    const { payload } = getSnapshot();
    // 다른 곳에서 보냈거나 버린 임시저장(gone)이면 지울 것(id 가 이미 비었다)도 되살릴 것도 없다 — 조용히 닫는다.
    const worth = autosave.status !== 'gone' && (hasContent || autosave.currentDraftId() != null);
    const deleting = autosave.discard();
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
  const expandLabel = isExpanded ? '작게 보기' : '크게 보기';
  // 올리는 중이거나 실패한 첨부가 있으면 보내지 않는다 — 빠진 채 나가지 않게. 이유는 칩 목록 위 한 줄(모바일 포함)과 데스크톱 보내기 툴팁으로 알린다.
  const { block } = attachments;
  const blockedReason = block?.reason ?? null;
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
    if (coach.data && lastCoachedRef.current === bodyHtmlRef.current) return;
    lastCoachedRef.current = bodyHtmlRef.current;
    coach.reset();
    coach.mutate({
      accountId: draft.accountId,
      bodyHtml: bodyHtmlRef.current,
      bodyText: bodyTextRef.current,
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
    // 초점은 여기서 주지 않는다 — 아직 래퍼가 inert(생성 중)라 무시된다. 렌더가 끝난 뒤 초점 effect(aiFocusRequest)가 준다.
    composerRef.current?.setContent(result.html, { focus: false });
    changeSubject(result.subject);
    if (result.focusBody) setAiFocusRequest((n) => n + 1);
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
    sendLock.current = true;
    setPreparingSend(true);
    const instanceId = draft.instanceId as number;
    // 실패한 채 작성창이 닫혀 있고 저장도 못 했을 때 「다시 열기」로 열 내용
    const reopen = snapshotDraft();
    const ticket = await autosave.beginSend();
    const body: MailSendRequest = {
      to: parseRecipientInput(to),
      cc: parseRecipientInput(cc),
      bcc: parseRecipientInput(bcc),
      subject,
      // 인용문은 에디터 밖에 있으므로 발송 시점에 뒤에 이어붙인다(설계 §7).
      bodyHtml: bodyHtmlRef.current + (draft.quote?.html ?? ''),
      bodyText: bodyTextRef.current + (draft.quote?.text ? '\n\n' + draft.quote.text : ''),
      inReplyToMessageId: draft.inReplyToMessageId,
      // WP-69 인용문 cid 이미지 — 서버가 원본 첨부를 같은 Content-ID 로 재첨부. 인용문을 지웠으면 보내지 않는다.
      inlineImages: draft.quote?.inlineImages.map(({ attachment, contentId }) => ({
        attachmentId: attachment.id,
        contentId,
      })),
      // WP-574 첨부 — 올린 파일은 업로드 id, 전달 원본은 받은 메일 첨부 id. 서버 거절(합계 초과·만료 등)은 실패 토스트로 보인다.
      ...sendAttachmentIds(attachments.items),
      draftId: ticket.draftId,
    };
    try {
      await send.mutateAsync({ accountId: draft.accountId, body });
      ticket.succeeded();
      closeInstance(instanceId);
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
      {/* 크게 보기 배경 — 누르면 닫지 않고 작은 창으로 돌아간다(쓰던 내용을 실수로 잃지 않게). */}
      {isExpanded && (
        <div
          data-testid="mail-compose-backdrop"
          aria-hidden
          className={AI_SIDE_OVERLAY_CLASS}
          onClick={() => setSize('dock')}
        />
      )}
      <div
        data-testid="mail-compose-dock"
        // 작은 창은 페이지와 함께 쓰는 영역(region), 화면을 덮는 모양(모바일·크게 보기)은 대화상자로 알린다(aria-modal 없음 — 위 isModal 주석).
        role={isModal ? 'dialog' : 'region'}
        // 패널에 아무 role/label 도 없어 스크린리더가 새 UI 등장을 안내하지 못하던 문제 수정 —
        // 헤더 텍스트를 프로그램적 이름으로 연결 (#802).
        aria-labelledby="mail-compose-dock-title"
        tabIndex={isExpanded ? -1 : undefined}
        className={PANEL_CLASS[layout]}
        {...dropProps}
        onKeyDown={(e) => {
          // 크게 보기 중 Esc → 작은 창으로. 링크 삽입 창(포털)의 Esc 는 React 트리로 여기까지 올라오므로
          // 실제 DOM 이 작성창 안일 때만 처리해 링크 창만 닫히게 한다. 한글 조합 중 Esc 는 조합 취소라 건드리지 않는다.
          if (!isExpanded || e.key !== 'Escape' || isImeComposing(e.nativeEvent)) return;
          if (!e.currentTarget.contains(e.target as Node)) return;
          e.preventDefault();
          setSize('dock');
        }}
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
          <div className="flex items-center justify-between gap-2 rounded-t-lg bg-muted px-3 py-2">
            {/* 제목 + 임시저장 상태(WP-577) — 제목이 길면 제목만 말줄임하고 상태는 그대로 보인다. */}
            <div className="flex min-w-0 items-baseline gap-2">
              <span id="mail-compose-dock-title" className="truncate text-sm font-medium">
                {subject || '새 메일'}
              </span>
              {saveStatus}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label="최소화"
                data-testid="mail-compose-minimize"
                // 크게 보기 중 최소화 → 최소화 상태로, 최소화 중 다시 누르면 작은 창으로.
                onClick={() => setSize((v) => (v === 'min' ? 'dock' : 'min'))}
                className="rounded p-1 hover:bg-accent"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={expandLabel}
                title={aiFullscreen ? 'AI 전체 화면에서는 크게 볼 수 없어요' : expandLabel}
                disabled={aiFullscreen}
                data-testid="mail-compose-expand"
                onClick={() => setSize(isExpanded ? 'dock' : 'fill')}
                className="rounded p-1 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                aria-label="닫기"
                data-testid="mail-compose-close"
                // 모바일과 같은 규칙 — 묻지 않고 임시저장한 뒤 닫는다(WP-577).
                onClick={closeWithSave}
                className="rounded p-1 hover:bg-accent"
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
          <FieldRow label="받는사람" mobile={isMobile} testId="mail-compose-to" value={to} onChange={edit(setTo)} inputRef={toInputRef} trailing={ccBccToggle} />
          {showCcBcc && (
            <>
              <FieldRow label="참조" mobile={isMobile} testId="mail-compose-cc" value={cc} onChange={edit(setCc)} />
              <FieldRow label="숨은참조" mobile={isMobile} testId="mail-compose-bcc" value={bcc} onChange={edit(setBcc)} />
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
              {/* 장식 기호 → lucide 아이콘으로 교체 */}
              <span className="inline-flex items-center justify-center gap-1">
                <Sparkles className="h-3 w-3" />
                AI 검토
              </span>
            </button>
          </div>

          {/* 본문(작성 탭) — review 일 때 숨김(언마운트 금지). 크게 보기는 에디터가 남은 높이를 채우도록 세로로 늘린다. */}
          <div className={cn(isExpanded && 'flex flex-1 flex-col', tab === 'review' && 'hidden')}>
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
              className={cn(isExpanded && 'flex flex-1 flex-col', aiGenerating && 'opacity-50 transition-opacity')}
            >
              <MailComposer
                key={`composer-${draft.instanceId}`}
                ref={composerRef}
                layout={layout}
                initialHtml={draft.initialHtml}
                onChange={(html, text, initial) => {
                  bodyHtmlRef.current = html;
                  bodyTextRef.current = text;
                  setHasBody(text.trim().length > 0);
                  if (initial) bodyBaselineRef.current = html;
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
                            composerRef.current?.setContent(coach.data!.improvedBodyHtml);
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

          {/* 아래 고정 줄(데스크톱) — 첨부 칩 + 📎·보내기. 작은 창·크게 보기 모두 본문(긴 전달 인용 등)이 스크롤돼도 창 아래에 남는다.
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
