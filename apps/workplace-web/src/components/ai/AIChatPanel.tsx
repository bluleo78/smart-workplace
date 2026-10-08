// src/components/ai/AIChatPanel.tsx
// AI 어시스턴트 공유 채팅 본문 — 세션 스위처 헤더 + 메시지 이력 + 입력바.
// side(AISidePanel) / fullscreen(AIFullscreen) 모두 재사용. 컨테이너(폭/포지션)는 호출측 책임.
import { ArrowUp, ChevronDown, CircleAlert, Loader2, MessageSquare, Plus, Sparkles, Square } from 'lucide-react';
import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { ActionResultLine } from '@/components/ai/ActionResultLine';
import { AiLabel } from '@/components/ai/AiLabel';
import { AISessionItems } from '@/components/ai/AISessionList';
import { AiStatusDot } from '@/components/ai/AiStatusDot';
import { DeleteSessionDialog } from '@/components/ai/DeleteSessionDialog';
import { HomeMessageImage } from '@/components/ai/HomeMessageImage';
import { MarkdownMessage } from '@/components/ai/MarkdownMessage';
import { useAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext';
import { ScreenContextChip } from '@/components/ai/ScreenContextChip';
import { ToolStepList } from '@/components/ai/ToolStepList';
import { ChatAttachmentViewerHost } from '@/components/chat/ChatAttachmentViewer';
import { ComposerAttachmentChips } from '@/components/chat/ComposerAttachmentChips';
import { ComposerAttachMenu } from '@/components/chat/ComposerAttachMenu';
import { ComposerDropOverlay } from '@/components/chat/ComposerDropOverlay';
import { MessageAttachmentList } from '@/components/chat/MessageAttachmentList';
import { getChatWidget } from '@/components/home/widgets/chatWidgetRegistry';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { homeChatAttachmentItem } from '@/components/viewer/viewerItems';
import type { AssistantChat } from '@/hooks/useAssistantChat';
import { useComposerFileDrop } from '@/hooks/useComposerFileDrop';
import { useHomeChatAttachments } from '@/hooks/useHomeChatAttachments';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useStickToBottom } from '@/hooks/useStickToBottom';
import { sessionListLabel } from '@/lib/ai/aiActivity';
import { contextIdentity } from '@/lib/aiScreenContext/common';
import { visibleSteps } from '@/lib/aiToolLabels';
import { sliceRange } from '@/lib/chatBlocks';
import { filesFromPaste } from '@/lib/clipboardFiles';
import { countSessionAttachments } from '@/lib/homeChatAttachments';
import { keepFocusProps } from '@/lib/keepFocus';
import { isSubmitEnter } from '@/lib/submitEnter';
import { cn } from '@/lib/utils';
import type { MessageTurn } from '@/types/home';

// 사용자 말풍선 — whitespace-pre-wrap 로 공백/개행 보존 + [overflow-wrap:anywhere] 로 URL·토큰 등 무공백 긴 문자열도
// 강제 줄바꿈해 말풍선이 폭 상한을 넘어 가로 오버플로하지 않도록 한다(#202).
const USER_BUBBLE = 'whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl bg-ai-accent px-3 py-1.5 text-sm text-ai-accent-foreground';

interface Props extends AssistantChat {
  /** 헤더 세션 스위처 표시 여부(기본 true). 풀스크린은 좌측 목록이 대신하므로 false. */
  showSessionSwitcher?: boolean;
  /** 마운트 시 입력에 포커스(패널 열림과 함께 호출). */
  autoFocus?: boolean;
  /** WP-190: 상한 안내의 [대화 목록 보기] — 사이드 패널은 헤더 드롭다운을 직접 연다, 풀스크린은 목록이 늘 보여 생략. */
  onShowSessions?: () => void;
}

/** WP-190: 중단된 답변 아래 라벨 — 시간 초과는 라이브 종결에서만 온다(저장된 STOPPED 는 다시 열면 "중단됨"). */
const INTERRUPTED_LABEL: Record<NonNullable<MessageTurn['interrupted']>, string> = {
  stopped: '중단됨',
  failed: '오류로 중단됨',
  timeout: '시간 초과로 중단됨',
};

const BUSY_NOTICE_ID = 'chat-busy-notice';
const LIMIT_NOTICE_ID = 'chat-limit-notice';
/** 메인 AI 채팅 첨부 뷰어 열림 router state 키(WP-279) — AI 채팅은 모든 화면 위에 떠 있어 ?preview(드라이브·이슈·메일 호스트 쿼리)를 쓰지 않는다. */
const HOME_CHAT_PREVIEW_KEY = 'homeChatPreview';

/** AI 어시스턴트 채팅 본문(controlled). 컨테이너에 맞춰 h-full 로 채운다. */
export function AIChatPanel({
  turns,
  pending,
  onSubmit,
  onStop,
  sessions,
  currentSessionId,
  newSessionNonce,
  attachmentResetNonce,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  otherActivity,
  sessionStatus,
  isGenerating,
  sendBlocked,
  busyElsewhere,
  reconnected,
  limit,
  atLimit,
  pendingActions,
  onConfirmActionItem,
  onConfirmAllActionItems,
  onDismissActionItem,
  onRequestProposalFix,
  showSessionSwitcher = true,
  autoFocus = false,
  onShowSessions,
}: Props) {
  const current = sessions.find((s) => s.id === currentSessionId);
  const [input, setInput] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // 모바일 입력 영역 분기(플레이스홀더·포커스 링·원형 전송 버튼) — 데스크톱 DOM 은 그대로.
  const isMobile = useIsMobile();
  // 세션 스위처 드롭다운 open 상태(#451) — 세션 항목이 DropdownMenuItem 이 아닌 일반 button 이라
  // Radix 자동 닫힘이 동작하지 않으므로, controlled 로 두고 선택 직후 명시적으로 닫는다.
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // WP-190: [대화 목록 보기] — 헤더 스위처가 있으면 그 드롭다운을, 없으면(모바일 시트) 호출측이 넘긴 동작을 쓴다.
  const showSessions = showSessionSwitcher ? () => setSessionMenuOpen(true) : onShowSessions;

  // 자동 하단 스크롤(#452) — 전송/스트리밍 델타/도구 단계/확인 카드 변화를 depKey 로 묶어,
  // 사용자가 하단 근처를 보고 있을 때만 새 내용으로 따라 내려간다(useStickToBottom 정책).
  // resetKey=currentSessionId — 세션 전환은 의도적 전환이므로 위로 올려둔 상태여도
  // 무조건 최신 메시지(하단)로 내려가게 한다(#455).
  const last = turns[turns.length - 1];
  // #843: 카드가 실패로 바뀌면 사유 줄만큼 높이가 늘어나므로 phase 도 depKey 에 포함한다.
  const cardDep = pendingActions.map((c) => c.phase).join(',');
  const scrollDep = `${turns.length}:${last?.content.length ?? 0}:${last?.role === 'action' ? 0 : (last?.steps?.length ?? 0)}:${cardDep}`;
  // #843: 한 카드라도 전송 중이면 카드 전체 버튼을 잠근다(중복 클릭·"모두 승인" 동시 실행 방지).
  const cardsBusy = pendingActions.some((c) => c.phase === 'submitting');
  const pendingCount = pendingActions.filter((c) => c.phase === 'pending').length;
  const scrollRef = useStickToBottom(scrollDep, currentSessionId);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // '새 대화' 전이 시 미전송 입력 초안을 비운다(#204). side·fullscreen 의 '새 대화' 버튼은
  // 서로 다른 위치(헤더 스위처 / 풀스크린 좌측 목록)에 있지만, 둘 다 onNewSession 을 거쳐
  // newSessionNonce 를 증가시키므로 이 패널 공통 effect 하나로 양쪽이 함께 초기화된다.
  // nonce 는 newSession() 에서만 증가하므로 세션 선택(restore)·전송(submit) 시엔 초안이 보존된다.
  useEffect(() => {
    if (newSessionNonce > 0) setInput('');
  }, [newSessionNonce]);

  // WP-54: 현재 화면 컨텍스트 + 칩 × 상태. × 는 그 시점 화면 정체성(contextIdentity)을 기억해 다음 1회 전송만 뺀다.
  // 정체성은 건수·facts 같은 휘발 값을 제외하므로, 같은 화면에서 목록 건수가 바뀌어도 × 가 유지된다.
  const screenContext = useAiScreenContext();
  // store 는 내용이 바뀔 때만 새 참조를 주므로 참조 기준 메모로 매 렌더 직렬화를 피한다.
  const screenIdentity = useMemo(() => contextIdentity(screenContext), [screenContext]);
  const [suppressedIdentity, setSuppressedIdentity] = useState<string | null>(null);
  // 다른 화면으로 바뀌면 × 상태를 해제 — A 에서 × → B → 다시 A 로 와도 칩이 복원되게.
  // effect 대신 렌더 중 조정("prop 변화 시 state 조정" 패턴)이라 칩이 한 프레임 깜빡이지 않는다.
  const [prevIdentity, setPrevIdentity] = useState<string | null>(screenIdentity);
  if (prevIdentity !== screenIdentity) {
    setPrevIdentity(screenIdentity);
    setSuppressedIdentity(null);
  }
  const contextActive = screenContext != null && suppressedIdentity !== screenIdentity;

  // WP-234: 첨부 초안 — 개수 상한(메시지 10·세션 30)·이미지 축소·25MB·로컬 미리보기는 훅이 맡는다.
  const sessionAttachmentCount = useMemo(() => countSessionAttachments(turns), [turns]);
  const attach = useHomeChatAttachments({ sessionAttachmentCount, resetNonce: attachmentResetNonce });
  // 입력창 영역 파일 드롭 → 사전 업로드(WP-235 부품 재사용).
  const { isDragging, dropProps } = useComposerFileDrop((files) => void attach.addFiles(files));
  // 보낼 수 있는지 — 글이나 첨부가 있어야 하고, 업로드 중이면 막는다(늦게 끝난 파일이 빠진 채 나가지 않게).
  const canSend = (input.trim().length > 0 || attach.pending.length > 0) && !attach.uploading;

  // 입력창 위 안내 — 다른 창에서 답변 중(WP-266)이 상한(WP-190)보다 우선. 보내기 버튼의 aria-describedby 도 같은 안내를 가리킨다.
  const notice = busyElsewhere
    ? {
      id: BUSY_NOTICE_ID,
      testId: 'chat-busy-elsewhere',
      text: `${isMobile ? '다른 창에서 답변 중이에요.' : '이 대화는 다른 창에서 답변 중이에요.'} 끝나면 보낼 수 있어요.`,
    }
    : atLimit
      ? { id: LIMIT_NOTICE_ID, testId: 'chat-limit-notice', text: `다른 대화 ${limit}개가 답변 중이에요. 하나가 끝나면 보낼 수 있어요.` }
      : null;

  const submit = () => {
    const query = input.trim();
    // Enter 는 버튼 disabled 를 거치지 않으므로 같은 판정을 여기서도 한다. WP-190: 상한·응답 전 ■ 대기면 전송만 막는다.
    if (pending || !canSend || sendBlocked) return;
    const ctx = contextActive ? screenContext : undefined;
    const attachments = attach.snapshot();
    setSuppressedIdentity(null); // 1회 제외는 이번 전송으로 소진 — 다음 전송부터 다시 포함.
    setInput('');
    void onSubmit(query, ctx, attachments).then((accepted) => {
      // 서버가 받아들였을 때만 보낸 파일을 초안에서 뺀다(WP-234) — 거절(400)이면 칩을 남겨 사유 토스트를 보고 고칠 수 있게.
      if (accepted) {
        attach.commitSent(attachments);
        return;
      }
      // 거절(400·409·429 등) — 턴에 넘겼던 미리보기를 초안으로 돌려받는다(시트가 닫혀 초안이 없으면 해제).
      attach.releaseRejected(attachments);
      // 지운 질문도 되돌린다 — 칩과 함께 그대로 다시 보낼 수 있게. 그 사이 새로 쓴 글은 덮지 않는다(비어 있을 때만, WP-190·WP-234).
      setInput((prev) => prev || query);
    });
  };

  return (
    <div data-testid="chat-panel" className="flex h-full min-h-0 flex-col">
      {/* 대화 삭제 확인 — pendingDeleteId 설정 시 열림. */}
      <DeleteSessionDialog
        sessionId={pendingDeleteId}
        onConfirm={(id) => {
          onDeleteSession(id);
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
        isGenerating={isGenerating}
      />

      {/* 헤더 — 좌: 대화 선택 드롭다운 / 우: ＋새 대화.
          긴 제목은 말줄임으로 줄고 「새 대화」는 한 줄을 지킨다(WP-261) — 트리거 min-w-0 로 줄어들 수 있게 하고 버튼은 shrink-0·nowrap. */}
      {showSessionSwitcher && (
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
          <DropdownMenu open={sessionMenuOpen} onOpenChange={setSessionMenuOpen}>
            <DropdownMenuTrigger
              className="relative flex min-w-0 items-center gap-1.5 rounded px-2 py-1 text-sm font-medium hover:bg-muted"
              data-testid="chat-session-switcher"
              aria-label={sessionListLabel(current?.title ?? '대화 선택', otherActivity)}
            >
              <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="max-w-[16rem] min-w-0 truncate" data-testid="chat-session-title">
                {current?.title ?? '대화 선택'}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              {/* WP-190: 다른 대화가 답변 중이거나 새 답변이 있으면 우상단 점(AiSparkle 완료 점과 같은 모양). */}
              {otherActivity !== 'idle' && (
                <AiStatusDot data-testid="chat-session-switcher-dot" className="right-0.5 top-0.5" />
              )}
            </DropdownMenuTrigger>
            {/* WP-54: body 포털이라 DOM 상 패널 밖이지만, React 이벤트가 패널 루트로 전파돼 AI 표면으로 판별된다
                (aiPanelSurface.markAiPanelEvent) — 열린 엔티티 다이얼로그가 닫히지 않음. 패널 트리 밖에서 렌더하면 안 된다. */}
            <DropdownMenuContent align="start" className="z-[80] w-72">
              <AISessionItems
                sessions={sessions}
                currentSessionId={currentSessionId}
                statusOf={sessionStatus}
                onSelect={(id) => {
                  onSelectSession(id);
                  setSessionMenuOpen(false); // 선택 후 드롭다운 닫기(#451)
                }}
                onDelete={setPendingDeleteId}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            data-testid="chat-new-session"
            onClick={onNewSession}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-4 w-4" /> 새 대화
          </button>
        </div>
      )}

      <div ref={scrollRef} data-testid="chat-scroll" className="flex-1 overflow-auto p-3">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Sparkles className="h-9 w-9 text-muted-foreground/60" />
            <p className="text-base font-medium text-foreground">AI 어시스턴트에게 물어보세요</p>
            <p className="text-sm text-muted-foreground">무엇이든 질문해 보세요</p>
          </div>
        ) : (
          // WP-279: 사용자 턴 첨부 썸네일·카드 → 통합 뷰어. 사이드 패널·전체화면·모바일 시트가 같은 키를 읽어도 누른 패널의 호스트만 묶음을 든다.
          <ChatAttachmentViewerHost historyKey={HOME_CHAT_PREVIEW_KEY}>
            <ul className="space-y-2">
              {turns.map((t, i) => (
                <Fragment key={i}>
                  {/* #843: 확인카드 처리 결과 — 말풍선이 아닌 한 줄 시스템 기록. */}
                  {t.role === 'action' ? (
                    <li data-testid="chat-turn" className="flex">
                      <ActionResultLine outcome={t.outcome} content={t.content} />
                    </li>
                  ) :
                  // 빈 어시스턴트 턴은 아직 첫 토큰을 받지 않은 상태 — 3-dot 이 대신 렌더되므로 skip.
                  // 단, 위젯이 있으면(show_* 단독 응답) content 가 비어도 위젯을 렌더해야 하므로 skip 안 함(#431).
                  t.role === 'assistant' && t.content === '' && !t.widgets?.length && !t.contentBlocks?.length && !visibleSteps(t.steps ?? []).length ? null : (
                  <li
                    data-testid="chat-turn"
                    className={cn('flex', t.role === 'assistant' ? 'justify-start' : 'justify-end')}
                  >
                    {t.role === 'assistant' ? (
                      t.contentBlocks?.length ? (
                        // #463: 라이브 인터리브 — 블록 도착순으로 text↔widget↔도구 그룹(WP-157) 렌더.
                        <div className="flex w-full max-w-[92%] flex-col gap-2" data-testid="chat-widgets">
                          {t.contentBlocks.map((b, bi, blocks) => {
                            if (b.kind === 'tools') {
                              // WP-157: 도구 그룹 = steps[stepStart ~ 다음 tools 블록의 stepStart). result 이벤트는 steps 만
                              // 갱신하므로 상태 전이(실행 중→✓)가 그대로 반영된다. 표시할 단계가 없으면 ToolStepList 가 null.
                              const [from, to] = sliceRange(blocks, bi);
                              return (
                                <div key={bi} className="self-start" data-testid="chat-block-tools">
                                  <ToolStepList steps={(t.steps ?? []).slice(from, to)} />
                                </div>
                              );
                            }
                            if (b.kind === 'text') {
                              // 이 텍스트 블록의 범위 = textStart ~ 다음 text 블록의 textStart(없으면 끝까지).
                              // 위젯·도구 블록은 오프셋 공간이 달라 범위 계산에서 제외 → 사이 텍스트도 정확 분리.
                              const [from, to] = sliceRange(blocks, bi);
                              const text = t.content.slice(from, to);
                              if (!text.trim()) return null;
                              return (
                                <div key={bi} className="self-start rounded-2xl bg-muted px-3 py-1.5 text-foreground" data-testid="chat-block">
                                  <MarkdownMessage>{text}</MarkdownMessage>
                                </div>
                              );
                            }
                            const Widget = getChatWidget(b.widget.type);
                            if (!Widget) return null;
                            return (
                              <div key={bi} data-testid="chat-block">
                                <Suspense fallback={<Skeleton className="h-24 w-full" />}>
                                  <Widget params={b.widget.params} />
                                </Suspense>
                              </div>
                            );
                          })}
                        </div>
                      ) : t.widgets?.length ? (
                        // #431: 히스토리/위젯-only 폴백(기존 2-섹션). contentBlocks 없을 때 사용.
                        <div className="flex w-full max-w-[92%] flex-col gap-2" data-testid="chat-widgets">
                          {/* 도구 호출 단계 인라인 표시 — 위젯 위에 렌더. 표시 가능 step 이 있을 때만. */}
                          {t.steps && visibleSteps(t.steps).length > 0 && <ToolStepList steps={t.steps} />}
                          {t.content && (
                            <div className="self-start rounded-2xl bg-muted px-3 py-1.5 text-foreground">
                              <MarkdownMessage>{t.content}</MarkdownMessage>
                            </div>
                          )}
                          {t.widgets.map((w, wi) => {
                            const Widget = getChatWidget(w.type);
                            if (!Widget) return null; // 미등록 위젯 타입은 skip.
                            return (
                              <Suspense key={wi} fallback={<Skeleton className="h-24 w-full" />}>
                                <Widget params={w.params} />
                              </Suspense>
                            );
                          })}
                        </div>
                      ) : (
                        // #356: AI 응답은 마크다운 렌더(## ** 표 등 원시 기호 노출 방지).
                        // AI 답변 블록 — AiLabel(✨ AI)로 AI 생성임을 명시(패널 자체가 AI 맥락이라 아우라 컨테이너는 생략).
                        // 폭 제약(max-w-[80%])·min-w-0 은 래퍼가 담당 — flex 아이템 기본 min-width:auto 로 무공백 긴 토큰이
                        // 80% 를 넘겨 가로 오버플로하던 회귀(#202) 방지. 내부 말풍선은 래퍼 폭을 채운다.
                        <div className="flex min-w-0 max-w-[80%] flex-col gap-0.5">
                          <AiLabel>AI</AiLabel>
                          <div className="min-w-0 rounded-2xl bg-muted px-3 py-1.5 text-foreground">
                            {/* 도구 호출 단계 인라인 표시 — 본문 위에 렌더. 표시 가능 step 이 있을 때만. */}
                            {t.steps && visibleSteps(t.steps).length > 0 && <ToolStepList steps={t.steps} />}
                            <MarkdownMessage>{t.content}</MarkdownMessage>
                          </div>
                        </div>
                      )
                    ) : t.attachments?.length ? (
                      // WP-234: 첨부가 있는 사용자 턴 — 시안 5 대로 본문 말풍선을 위에, 첨부(썸네일·문서 카드)를 그 아래에 오른쪽 정렬로 쌓는다.
                      // 첨부만 보낸 턴은 본문 말풍선 없이 첨부만. 폭 제약은 래퍼가(min-w-0 로 긴 파일명도 넘치지 않게).
                      <div className="flex min-w-0 max-w-[80%] flex-col items-end gap-1" data-testid="chat-turn-attachments">
                        {t.content && (
                          <span className={cn('max-w-full', USER_BUBBLE)} data-testid="chat-user-bubble">
                            {t.content}
                          </span>
                        )}
                        <MessageAttachmentList
                          attachments={t.attachments}
                          className="max-w-full items-end"
                          // 새 대화 첫 메시지는 응답이 끝나 세션이 정해지기 전까지 원본 경로가 없어 열지 않는다(썸네일은 로컬 미리보기로 보임).
                          // 메인 AI 채팅은 드라이브 링크를 받지 않아 driveLinks·toDriveLinkItem 을 넘기지 않는다.
                          toItem={currentSessionId ? (a) => homeChatAttachmentItem(currentSessionId, i, a) : undefined}
                          renderImage={(a, onOpen) => <HomeMessageImage sessionId={currentSessionId} attachment={a} onOpen={onOpen} />}
                        />
                      </div>
                    ) : (
                      <span className={cn('max-w-[80%]', USER_BUBBLE)} data-testid="chat-user-bubble">
                        {t.content}
                      </span>
                    )}
                  </li>
                  )}
                  {/* WP-190: 정지·오류로 끝난 답변 — 본문 아래 작은 muted 글씨. 라이브 정지·복원(STOPPED/FAILED) 공통. */}
                  {t.role === 'assistant' && t.interrupted && (
                    <li data-testid="chat-interrupted" className="-mt-1 pl-1 text-xs text-muted-foreground">
                      {INTERRUPTED_LABEL[t.interrupted]}
                    </li>
                  )}
                </Fragment>
              ))}
              {/* #351: 일괄 확인 카드 — 항목별 승인/거부.
                  #843: 항목은 제자리에서 상태만 바뀐다 — 전송 중(스피너·잠금) / 실패(사유 인라인 + AI에게 수정 요청·닫기).
                  성공한 항목은 사라지고 결과는 위 대화 이력에 결과 줄로 남는다. 좁은 패널(≈380px)에서 긴 요약·사유와 버튼이
                  부딪치지 않도록 항목 내부를 세로로 쌓는다. */}
              {pendingActions.length > 0 && (
                <li className="flex justify-start" data-testid="pending-action-card">
                  <div className="max-w-[85%] rounded-2xl border bg-card p-3 text-sm">
                    <p className="font-medium text-foreground">확인이 필요해요</p>
                    <ul className="mt-2 space-y-3">
                      {pendingActions.map((card) => (
                        <li
                          key={card.id}
                          className="flex flex-col gap-1.5"
                          data-testid="pending-action-item"
                          data-phase={card.phase}
                          aria-busy={card.phase === 'submitting'}
                        >
                          <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{card.summary}</span>
                          {card.phase === 'failed' && (
                            // 인라인 에러(디자인시스템 06 §C-1 은 text-sm — 카드 밀도상 text-xs 로 한 단계 낮춤).
                            <p
                              role="alert"
                              className="flex items-start gap-1 text-xs text-destructive [overflow-wrap:anywhere]"
                              data-testid="pending-action-error"
                            >
                              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                              <span className="min-w-0">{card.error}</span>
                            </p>
                          )}
                          {/* 버튼 한 쌍 — 실패 카드는 같은 파라미터 재시도(반드시 재실패) 대신 AI 수정 요청·닫기로 바뀐다.
                              패널 전체가 AI 대화 영역이라 AI 마커(Sparkles)는 중첩하지 않는다. */}
                          <span className="flex flex-wrap justify-end gap-1">
                            <Button
                              size="sm"
                              className="bg-ai-accent text-ai-accent-foreground"
                              disabled={cardsBusy || (card.phase === 'failed' && pending)}
                              onClick={() =>
                                card.phase === 'failed' ? onRequestProposalFix(card) : onConfirmActionItem(card)
                              }
                            >
                              {card.phase === 'submitting' && <Loader2 className="animate-spin" />}
                              {card.phase === 'failed' ? 'AI에게 수정 요청' : '승인'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={cardsBusy}
                              onClick={() => onDismissActionItem(card)}
                            >
                              {card.phase === 'failed' ? '닫기' : '거부'}
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {pendingCount > 1 && (
                      <Button
                        size="sm"
                        className="mt-3 bg-ai-accent text-ai-accent-foreground"
                        disabled={cardsBusy}
                        onClick={onConfirmAllActionItems}
                        data-testid="pending-action-approve-all"
                      >
                        모두 승인
                      </Button>
                    )}
                  </div>
                </li>
              )}
              {/* WP-265: 생성 도중 연결이 다시 이어졌다 — 받은 부분은 그대로 두고, 끝나면 서버에 저장된 전체 답변으로 바뀐다. */}
              {pending && reconnected && turns[turns.length - 1]?.content !== '' && (
                <li
                  data-testid="chat-reconnected"
                  role="status"
                  className="-mt-1 flex items-center gap-1.5 pl-1 text-xs text-muted-foreground"
                >
                  <Loader2 aria-hidden className="size-3 animate-spin" />
                  <span className="min-w-0">연결이 다시 이어졌어요 · 답변이 끝나면 전체를 불러와요</span>
                </li>
              )}
              {/* 3-dot 로딩 — pending 이고 아직 첫 토큰이 오지 않은 경우에만 표시.
                  첫 토큰 도착 후엔 assistant 말풍선 자체가 점진적으로 채워지므로 중복 표시 방지(#332). */}
              {pending && turns[turns.length - 1]?.content === '' && (
                <li className="flex justify-start" data-testid="chat-pending">
                  {/* 응답 작성 중 — assistant 말풍선과 동일한 정렬·형태(좌측·bg-muted·rounded-2xl)에
                      타이핑 dot 모션을 둬, 완료된 짧은 메시지가 아니라 '진행 중' 상태로 읽히게 한다(#207). */}
                  <span
                    className="flex items-center gap-1 rounded-2xl bg-muted px-3 py-2.5"
                    role="status"
                    aria-label="AI가 응답을 작성 중입니다"
                  >
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
                  </span>
                </li>
              )}
            </ul>
          </ChatAttachmentViewerHost>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        // WP-234: 입력창 영역 전체가 파일 드롭 영역 — 오버레이 기준점이 되도록 relative.
        className="relative border-t p-2"
        data-testid="ai-composer"
        {...dropProps}
      >
        {isDragging && <ComposerDropOverlay />}
        {/* WP-190·266: 상한·다른 창 답변 중이면 미리 알린다 — 입력은 가능, 전송만 막힌다(sendBlocked). */}
        {/* 라이브 리전은 항상 마운트해 둬야 상한 안내가 나타날 때 스크린리더가 읽는다(조건부 마운트는 낭독 누락). */}
        <div role="status" aria-live="polite">
          {notice && (
            <div
              id={notice.id}
              data-testid={notice.testId}
              className="mb-2 flex items-start gap-1.5 rounded-md bg-ai-accent-subtle px-2.5 py-1.5 text-xs text-foreground"
            >
              <Sparkles aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ai-accent" />
              <span className="min-w-0 flex-1">{notice.text}</span>
              {notice.id === LIMIT_NOTICE_ID && showSessions && (
                <button
                  type="button"
                  onClick={showSessions}
                  // ::after 로 터치 영역만 44px 이상으로 확장 — 레이아웃 높이는 그대로.
                  className="relative shrink-0 rounded-sm font-medium after:absolute after:-inset-x-1.5 after:-inset-y-3.5 after:content-[''] text-ai-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  대화 목록 보기
                </button>
              )}
            </div>
          )}
        </div>
        {/* WP-54: 현재 화면 컨텍스트 칩 — 포함/제외(이번 1회) 상태 + 되돌리기. 상세는 ScreenContextChip. */}
        <ScreenContextChip
          context={screenContext}
          excluded={!contextActive}
          onExclude={() => {
            setSuppressedIdentity(screenIdentity);
            // 칩이 제외 상태로 바뀌며 × 가 사라지므로 키보드 포커스를 입력창으로 옮긴다(10-accessibility).
            inputRef.current?.focus();
          }}
          onRestore={() => {
            setSuppressedIdentity(null);
            inputRef.current?.focus();
          }}
        />
        {/* WP-234: 첨부 대기 칩(＋ 업로드 중 진행 칩) — 드라이브 링크는 받지 않으므로 드라이브 칩 props 는 넘기지 않는다. */}
        <ComposerAttachmentChips
          testIdPrefix="ai-composer"
          pending={attach.pending}
          uploadingNames={attach.uploadingNames}
          onRemoveFile={attach.removeFile}
        />
        <div className="flex items-end gap-2">
          {/* WP-234: ＋ 첨부 — 드라이브 제외(드라이브 props 를 넘기지 않으면 「드라이브에서 링크」가 없다).
              메뉴·바텀시트(딤 포함)가 AI 시트(z-[60]) 뒤로 숨지 않게 세션 스위처와 같은 z-[80] 층. */}
          <ComposerAttachMenu
            testIdPrefix="ai-composer"
            aboveAiSheet
            onFiles={(files) => void attach.addFiles(files)}
          />
          {/* 여러 줄 입력 — Enter 전송, Shift+Enter 줄바꿈(isSubmitEnter, RichInput 과 공용 규칙). */}
          <Textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (isSubmitEnter(e.nativeEvent)) {
                e.preventDefault();
                submit();
              }
            }}
            // WP-234: 클립보드 파일(스크린샷 등)은 본문 대신 첨부로. 텍스트가 함께 있으면 텍스트 붙여넣기(filesFromPaste).
            onPaste={(e) => {
              const files = filesFromPaste(e.clipboardData);
              if (files.length === 0) return;
              e.preventDefault();
              void attach.addFiles(files);
            }}
            // 모바일엔 하드웨어 키보드 단축키(⌘K)가 없으므로 힌트를 뺀다(U2-3).
            placeholder={isMobile ? 'AI 에게 요청…' : 'AI 에게 요청…  (⌘K)'}
            // 모바일: 링 오프셋(2px 배경 띠)이 테두리와 겹쳐 이중 링처럼 보이던 것을 단일 링으로(U2-3), 색은 AI 보라 토큰(ai-accent, U3-R4). 데스크톱 불변.
            className={cn(
              'field-sizing-content max-h-40 min-h-9 resize-none py-1.5',
              isMobile && 'min-h-10 rounded-2xl focus-visible:border-ai-accent focus-visible:ring-1 focus-visible:ring-ai-accent focus-visible:ring-offset-0',
            )}
            data-testid="chat-input"
          />
          {/* #335: 스트리밍 중에는 '보내기'를 '중단' 버튼으로 전환 — 클릭 시 진행 중 응답을 멈춘다.
              세 버튼 모두 keepFocusProps — 탭이 입력창을 blur 해 iOS 키보드가 내려가지 않게(WP-224). */}
          {pending ? (
            <Button
              type="button"
              variant="outline"
              onClick={onStop}
              {...keepFocusProps}
              aria-label="응답 중단"
              data-testid="chat-stop"
            >
              <Square className="h-4 w-4 fill-current" /> 중단
            </Button>
          ) : isMobile ? (
            // 모바일: 40px 원형 아이콘 버튼(메신저 관례) — 접근 이름은 데스크톱과 같은 '보내기'.
            <Button
              type="submit"
              size="icon"
              {...keepFocusProps}
              aria-label="보내기"
              disabled={!canSend || sendBlocked}
              aria-describedby={notice?.id}
              data-testid="chat-send"
              className="h-10 w-10 shrink-0 rounded-full bg-ai-accent text-ai-accent-foreground"
            >
              <ArrowUp className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              type="submit"
              {...keepFocusProps}
              disabled={!canSend || sendBlocked}
              aria-describedby={notice?.id}
              className="bg-ai-accent text-ai-accent-foreground"
              data-testid="chat-send"
            >
              {attach.uploading ? '업로드 중…' : '보내기'}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
