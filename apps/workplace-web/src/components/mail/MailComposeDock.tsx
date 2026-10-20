// 메일 작성창. 보내기 = useSendMail. MailComposeProvider 의 draft 가 있으면 렌더, 없으면 null.
// - 데스크톱: Gmail식 우하단 작은 창. 최소화/크게 보기(WP-575)/닫기.
// - 모바일: 다른 메일 앱처럼 처음부터 화면 전체 작성 화면(WP-583). 상단 바 [✕] 제목 … [➤ 보내기].

import axios from 'axios';
import { Loader2, Maximize2, Minimize2, Minus, Send, Sparkles, X } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { useAssistant } from '@/components/ai/AIAssistantContext';
import { AiContent } from '@/components/ai/AiContent';
import { inertPageArea } from '@/components/ai/aiPanelSurface';
import { AI_SIDE_CENTER_CLASS, AI_SIDE_OVERLAY_CLASS } from '@/components/ai/useAiPanelAwareDialog';
import { mobileBackButtonClass, mobileDetailBarClass, mobileDetailTitleClass } from '@/components/mobile/headerClass';
import { HeaderIconAction } from '@/components/mobile/HeaderIconAction';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useMailDarkHtml } from '@/hooks/useMailDarkHtml';
import { useSheetHistory } from '@/hooks/useSheetHistory';
import { withComposerPreviewStyle } from '@/lib/composerPreviewHtml';
import { isImeComposing } from '@/lib/imeKey';
import { cn } from '@/lib/utils';

import { useCoachDraft, useSendMail } from '../../hooks/queries/useMailMessages';
import type { CoachingNote } from '../../types/mailMessage';
import { SandboxedHtmlFrame } from '../SandboxedHtmlFrame';
import { type ComposeDraft, useMailCompose } from './MailComposeContext';
import { MailComposer, type MailComposerHandle, type MailComposerLayout } from './MailComposer';
import { MailQuoteBlock } from './MailQuoteBlock';

/** 주소 문자열("a@x, b@y")을 배열로 파싱. */
function parseAddresses(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

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
  mobile: 'flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 pb-[calc(3.5rem+env(safe-area-inset-bottom))]',
  fill: 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3',
  dock: 'flex max-h-[min(75vh,calc(100vh-3rem))] flex-col gap-2 overflow-y-auto p-3',
};

/** 모바일 상단 바 제목 — 전달(인용문이 전달용) / 회신(답장 대상 있음) / 새 메일. */
function composeTitle(draft: ComposeDraft): string {
  if (draft.quote?.variant === 'forward') return '전달';
  if (draft.inReplyToMessageId != null) return '회신';
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
}: {
  label: string;
  mobile: boolean;
  testId: string;
  value: string;
  onChange: (v: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  trailing?: ReactNode;
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
        placeholder={mobile ? undefined : label}
        className={cn('min-w-0 flex-1 bg-transparent outline-none', mobile ? 'text-[15px]' : 'text-sm')}
      />
      {trailing}
    </div>
  );
}

/**
 * 모바일 작성 화면은 페이지처럼 보이므로 시스템 back 이 작성 화면을 닫게 히스토리 항목 하나에 묶는다(WP-222 공용 훅).
 * 쓴 내용이 있으면 back 으로 바로 닫지 않고 버림 확인을 띄운다(✕ 와 같은 규칙) — 임시저장(WP-577)이 오면 자동 저장으로 바뀐다.
 * 열려 있을 때만 마운트한다 — 훅이 위치(useLocation)를 구독하므로, 작성창 본체에 두면 모든 페이지 이동마다 작성창이 다시 렌더된다.
 */
function MobileComposeHistory({
  hasContent,
  onClose,
  onBlockedBack,
}: {
  hasContent: boolean;
  onClose: () => void;
  onBlockedBack: () => void;
}) {
  useSheetHistory({ historyKey: 'mailCompose', open: true, hasContent, onClose, onBlockedBack });
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
  const { draft, closeCompose, clearQuote } = useMailCompose();
  const send = useSendMail(draft?.accountId);

  const composerRef = useRef<MailComposerHandle>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const coach = useCoachDraft();
  const [tab, setTab] = useState<'compose' | 'review'>('compose');
  const [hasBody, setHasBody] = useState(false);
  // 마지막으로 코칭한 본문 HTML — 본문이 바뀌면(편집/개선본 교체) 재검토를 트리거하기 위한 stale 가드.
  // 평문이 아니라 HTML 로 비교한다(WP-404) — AI 입력이 HTML 이라, 굵게·빈 줄만 바꿔도 다시 검토해야 교체 때 그 서식이 남는다.
  const lastCoachedRef = useRef<string | null>(null);

  const isMobile = useIsMobile();
  // 데스크톱 창 크기 — 작은 창 / 최소화 / 크게 보기(WP-575). 하나의 상태라 최소화와 크게 보기가 동시에 걸리지 않는다.
  // 새 작성마다 작은 창으로 시작한다("항상 크게" 설정 없음). 모바일은 항상 화면 전체라 이 값을 쓰지 않는다.
  const [size, setSize] = useState<'dock' | 'min' | 'fill'>('dock');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState('');
  // 본문은 ref 로 보관(매 키 입력마다 리렌더 방지).
  const bodyHtmlRef = useRef('');
  const bodyTextRef = useRef('');
  // 본문을 사용자가 고쳤는지 — 처음 채워진 본문(AI 답장 초안 등)과 비교한다. 기준은 에디터가 만들어질 때의 HTML.
  const bodyBaselineRef = useRef('');
  const [bodyEdited, setBodyEdited] = useState(false);
  // 인용문을 지웠는지 — 기밀 문단을 빼고 회신하는 것도 쓴 내용으로 본다.
  const [quoteRemoved, setQuoteRemoved] = useState(false);

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
  // 버림 확인창(✕·모바일 시스템 back 에서 쓴 내용이 있을 때).
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // 새 draft 가 열릴 때마다 폼 초기화. 인용문 제거(clearQuote)도 draft 객체를 바꾸지만 같은 작성이므로
  // instanceId 로만 판단한다 — 안 그러면 지우는 순간 받는사람·제목·크기가 처음 값으로 돌아가고 본문 ref 가 화면과 어긋난다.
  useEffect(() => {
    if (!draft) return;
    setSize('dock');
    setConfirmDiscard(false);
    setTo(draft.to.join(', '));
    setCc(draft.cc.join(', '));
    setBcc(draft.bcc.join(', '));
    setShowCcBcc(draft.cc.length > 0 || draft.bcc.length > 0);
    setSubject(draft.subject);
    bodyHtmlRef.current = draft.initialHtml;
    bodyTextRef.current = '';
    // 새 draft 진입 시 탭/코칭 결과 초기화.
    setTab('compose');
    coach.reset();
    lastCoachedRef.current = null;
    setHasBody(false);
    setBodyEdited(false);
    setQuoteRemoved(false);
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

  if (!draft) return null;

  // 사용자가 쓴 내용이 있는가 — 본문·받는사람·참조·숨은참조·제목·인용문 중 하나라도 처음 채워진 값에서 바뀌었다.
  const hasContent =
    bodyEdited ||
    quoteRemoved ||
    to !== draft.to.join(', ') ||
    cc !== draft.cc.join(', ') ||
    bcc !== draft.bcc.join(', ') ||
    subject !== draft.subject;
  // ✕·모바일 back 공통 — 쓴 내용이 있으면 버릴지 묻고, 없으면 바로 닫는다.
  const requestClose = () => (hasContent ? setConfirmDiscard(true) : closeCompose());
  const expandLabel = isExpanded ? '작게 보기' : '크게 보기';

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

  const onSend = () => {
    send.mutate(
      {
        to: parseAddresses(to),
        cc: parseAddresses(cc),
        bcc: parseAddresses(bcc),
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
      },
      { onSuccess: () => closeCompose() },
    );
  };

  const ccBccToggle = !showCcBcc && (
    <button
      type="button"
      onClick={() => setShowCcBcc(true)}
      className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
    >
      참조/숨은참조
    </button>
  );

  return (
    <>
      {isMobile && (
        <MobileComposeHistory hasContent={hasContent} onClose={closeCompose} onBlockedBack={() => setConfirmDiscard(true)} />
      )}
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent data-testid="mail-compose-discard-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>작성 중인 메일을 버릴까요?</AlertDialogTitle>
            <AlertDialogDescription>입력한 받는사람·제목·본문이 사라집니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="mail-compose-discard-keep">계속 작성</AlertDialogCancel>
            <AlertDialogAction variant="destructive" data-testid="mail-compose-discard-confirm" onClick={closeCompose}>
              버리기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
        onKeyDown={(e) => {
          // 크게 보기 중 Esc → 작은 창으로. 링크 삽입 창(포털)의 Esc 는 React 트리로 여기까지 올라오므로
          // 실제 DOM 이 작성창 안일 때만 처리해 링크 창만 닫히게 한다. 한글 조합 중 Esc 는 조합 취소라 건드리지 않는다.
          if (!isExpanded || e.key !== 'Escape' || isImeComposing(e.nativeEvent)) return;
          if (!e.currentTarget.contains(e.target as Node)) return;
          e.preventDefault();
          setSize('dock');
        }}
      >
        {isMobile ? (
          // 모바일 상단 바 — 메일 상세 헤더와 같은 56px 규격. 보내기를 위에 둬 키보드가 올라와도 가리지 않는다.
          <div className={mobileDetailBarClass}>
            <button
              type="button"
              aria-label="닫기"
              data-testid="mail-compose-close"
              onClick={requestClose}
              className={mobileBackButtonClass}
            >
              <X className="h-6 w-6" />
            </button>
            <h2 id="mail-compose-dock-title" className={mobileDetailTitleClass}>
              {composeTitle(draft)}
            </h2>
            <HeaderIconAction label="보내기" onClick={onSend} disabled={send.isPending} data-testid="mail-compose-send">
              {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            </HeaderIconAction>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-t-lg bg-muted px-3 py-2">
            <span id="mail-compose-dock-title" className="truncate text-sm font-medium">
              {subject || '새 메일'}
            </span>
            <div className="flex items-center gap-1">
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
                // 모바일과 같은 규칙 — 쓴 내용이 있으면 버릴지 묻는다.
                onClick={requestClose}
                className="rounded p-1 hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* 모바일엔 최소화가 없다 — 데스크톱에서 최소화한 채 모바일 폭으로 줄어도 본문은 보인다. */}
        {(size !== 'min' || isMobile) && (
          <div className={BODY_CLASS[layout]}>
            <FieldRow label="받는사람" mobile={isMobile} testId="mail-compose-to" value={to} onChange={setTo} inputRef={toInputRef} trailing={ccBccToggle} />
            {showCcBcc && (
              <>
                <FieldRow label="참조" mobile={isMobile} testId="mail-compose-cc" value={cc} onChange={setCc} />
                <FieldRow label="숨은참조" mobile={isMobile} testId="mail-compose-bcc" value={bcc} onChange={setBcc} />
              </>
            )}
            <FieldRow label="제목" mobile={isMobile} testId="mail-compose-subject" value={subject} onChange={setSubject} />
            {/* 작성/AI 검토 탭 */}
            <div className="flex border-b border-border text-sm" data-testid="mail-compose-tabs">
              <button
                type="button"
                className={`flex-1 py-1.5 font-medium ${tab === 'compose' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}
                onClick={() => setTab('compose')}
              >
                작성
              </button>
              <button
                type="button"
                data-testid="mail-review-tab"
                // 코칭 payload 에는 인용문이 실리지 않으므로(§6) 본문이 비어 있으면 검토 대상이 없다
                disabled={!hasBody}
                className={`flex-1 py-1.5 font-medium disabled:opacity-50 ${tab === 'review' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}
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
                }}
              />
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
                  }}
                  inlineImages={draft.quote.inlineImages}
                />
              )}
            </div>

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
                  // 503(AI off·비서 미설정) 등 서버가 친화적 메시지를 내려주면 그 메시지를 우선 표시.
                  // Axios 에러가 아니거나 response.data.message 가 없으면 일반 재시도 안내로 폴백.
                  <p className="text-destructive" data-testid="mail-coaching-error">
                    {axios.isAxiosError(coach.error) &&
                    typeof (coach.error.response?.data as { message?: string })?.message === 'string' &&
                    (coach.error.response!.data as { message: string }).message
                      ? (coach.error.response!.data as { message: string }).message
                      : 'AI 검토에 실패했어요. 다시 시도해주세요.'}
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

            {/* 액션 — 모바일은 보내기가 상단 바에 있다. 크게 보기는 본문이 길어 스크롤돼도 보내기가 창 아래에 남는다. */}
            {!isMobile && (
              <div className={cn('flex justify-end pt-1', isExpanded && 'sticky bottom-0 bg-background')}>
                <button
                  type="button"
                  data-testid="mail-compose-send"
                  onClick={onSend}
                  disabled={send.isPending}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {send.isPending ? '전송 중…' : '보내기'}
                </button>
              </div>
            )}
          </div>
        )}
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
