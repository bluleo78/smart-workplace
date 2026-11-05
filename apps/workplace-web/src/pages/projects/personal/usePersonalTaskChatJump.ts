// 모바일 개인 작업 전체 화면의 「채팅으로 이동」(WP-1372). 데스크톱 넓은 모달은 WP-1374 부터 팀 이슈처럼 채팅 서랍을 연다(useIssueChatDrawerParam 의 unmarkedClose).
// 왜: 모바일 상세는 채팅이 화면 안에 이미 있어, 채팅 드로워를 또 띄우면 전체 화면 위에 화면이 하나 더 겹친다.
// 그래서 채팅 버튼·AI 진행 카드·딥링크(`?chat=1` — 알림·「내 AI 작업」 링크가 리다이렉트로 넘겨준다)는 모두
// 상세 안의 채팅 칸으로 스크롤하고 입력칸에 포커스를 준다. 화면에는 묶음 props 를 넘겨 배선을 한 곳에 둔다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useChatThreadSettled } from '@/hooks/queries/useChatThread';
import { hasIssueChatParam, removeIssueChatParam } from '@/lib/issueChatParam';
import { finePointerStore } from '@/lib/mobile/mediaQueryStore';

import type { usePersonalTask } from './usePersonalTask';

/**
 * 스크롤 칸(container)만 움직여 목표(target)의 아래끝을 칸 아래끝에 맞춘다 — 입력칸·최근 메시지가 보이게.
 * scrollIntoView 는 조상 스크롤 칸(페이지·목록)까지 모두 움직이므로 쓰지 않는다.
 */
function scrollToEnd(container: HTMLElement, target: HTMLElement) {
  const offset = target.getBoundingClientRect().bottom - container.getBoundingClientRect().bottom;
  container.scrollTo({ top: Math.max(0, container.scrollTop + offset), behavior: 'smooth' });
}

/**
 * 개인 작업 상세의 채팅 이동. task 는 같은 화면의 usePersonalTask 결과다.
 * - 상세가 로드되고(task.data) 스레드 조회가 끝나야(채팅 칸이 제 높이로 그려진 뒤) 딥링크를 쓴다.
 * - 상세 조회가 실패하면(404 등) 채팅 칸이 영영 없으므로 딥링크를 쓰지 않고 지운다 —
 *   남겨 두면 같은 화면에서 다음에 여는 작업(task 만 바꾸고 다른 쿼리는 둔다)에 chat=1 이 묻어간다.
 *
 * `?chat=1` 은 한 번 쓰고 주소에서 지운다(replace, router state 보존) — 다시 그려질 때·필드를 고칠 때 또 스크롤하지 않게.
 * replace 라 히스토리 항목 수와 idx·task 열림 마크(useHistoryParam, WP-208)가 그대로여서, 상세 닫기(뒤로)가 chat 상태로 돌아가지 않는다.
 *
 * 반환하는 묶음 props:
 * - scrollProps: 상세의 스크롤 칸(스크롤은 이 칸만 움직인다). sectionProps: 채팅 칸을 감싸는 요소(스크롤 목표).
 * - chatProps: IssueChatSection 에 펼친다(포커스 요청). buttonProps: IssueChatButton 에 펼친다. onOpenChat: AI 진행 카드 「답변 필요」.
 */
export function usePersonalTaskChatJump({
  projectKey,
  number,
  task,
}: {
  projectKey: string;
  number: number;
  task: ReturnType<typeof usePersonalTask>;
}) {
  const scrollEl = useRef<HTMLDivElement | null>(null);
  const sectionEl = useRef<HTMLDivElement | null>(null);
  // 콜백 ref — 렌더 중에 ref 객체를 넘기지 않고(React Compiler 규칙) 요소만 받아 둔다.
  const scrollRef = useCallback((el: HTMLDivElement | null) => {
    scrollEl.current = el;
  }, []);
  const sectionRef = useCallback((el: HTMLDivElement | null) => {
    sectionEl.current = el;
  }, []);
  const location = useLocation();
  const navigate = useNavigate();
  const ready = !!task.data;
  const failed = !!task.q.error;
  // 스레드 조회가 끝났는가 — 채팅 칸과 같은 캐시를 보되 상태가 바뀔 때만 다시 그린다(스레드 응답이 바뀔 때마다 상세 전체가 그려지지 않게).
  const chatSettled = useChatThreadSettled(projectKey, number);

  // 대기 중인 포커스 요청 번호(0 = 없음). 입력칸이 포커스를 마치면(onFocusRequestDone) 0 으로 돌려 한 번만 쓴다 —
  // 입력칸이 나중에 다시 붙어도(포털 대상 교체·쓰기 권한 바뀜) 포커스를 다시 가져가지 않게. 누를 때마다 번호가 올라 새 요청이 된다.
  const [focusRequest, setFocusRequest] = useState(0);
  const requestSeq = useRef(0);
  const onFocusRequestDone = useCallback(() => setFocusRequest(0), []);

  /** 채팅 칸으로 스크롤하고, focus=true 면 입력칸 포커스를 요청한다. */
  const jump = useCallback((focus: boolean) => {
    const container = scrollEl.current;
    const section = sectionEl.current;
    if (container && section) scrollToEnd(container, section);
    if (focus) setFocusRequest(++requestSeq.current);
  }, []);

  const jumpToChat = useCallback(() => jump(true), [jump]);

  // 딥링크 소비 — 같은 위치(location.key)에서 두 번 하지 않는다(StrictMode 이중 이펙트·replace 전 다시 그리기).
  const wantsChat = hasIssueChatParam(location.search);
  const consumedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!wantsChat) return;
    const canJump = ready && chatSettled;
    if (!failed && !canJump) return;
    if (consumedKeyRef.current === location.key) return;
    consumedKeyRef.current = location.key;
    // 입력칸 포커스는 정밀 포인터에서만 — 터치 기기는 가상 키보드가 화면 절반을 덮는다(팀 채팅 드로워 자동 포커스와 같은 기준).
    // 터치에서는 스크롤만 하고, 입력은 사용자가 입력줄을 눌러 시작한다(채팅 버튼은 누른 동작이라 포커스한다).
    if (canJump) jump(finePointerStore.get());
    removeIssueChatParam(navigate, location);
  }, [wantsChat, ready, failed, chatSettled, jump, navigate, location]);

  return {
    scrollProps: { ref: scrollRef, 'data-testid': 'personal-task-scroll' },
    sectionProps: { ref: sectionRef, 'data-testid': 'personal-panel-chat' },
    chatProps: { projectKey, issueNumber: number, focusRequest, onFocusRequestDone },
    // 채팅이 늘 화면에 있으므로 open 은 넘기지 않는다 — 읽지 않은 수는 읽음 워터마크로만 지운다(IssueChatButton).
    buttonProps: { projectKey, issueNumber: number, onOpen: jumpToChat },
    onOpenChat: jumpToChat,
  };
}
