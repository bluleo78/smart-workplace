// src/components/ai/useAiPanelAwareDialog.tsx
// WP-54: 엔티티 다이얼로그(일정·파일 미리보기)가 열린 채로도 AI 사이드 패널에 질문할 수 있게 하는 공통 훅.
//
// 왜: Radix modal Dialog 는 포커스 트랩·바깥 aria-hidden·body pointer-events 차단을 걸어
// "이 회의 참석자 알려줘" 처럼 모달이 열린 대상에 대한 질문을 막는다.
// 무엇을: AI 패널이 side 모드일 때만 다이얼로그를 non-modal 로 바꾸고,
//  - AI 표면(사이드 패널·AI 칩·패널에서 연 포털 레이어 — aiPanelSurface.ts) 상호작용은 다이얼로그를 닫지 않게 하고,
//  - 열린 동안 페이지 영역을 inert 로 만들어 포커스·보조기기가 흐린 페이지로 새지 않게 하고,
//  - 페이지 영역만 덮는 dim 오버레이를 직접 렌더(non-modal 이면 Radix 가 Overlay 를 그리지 않으므로)하고,
//  - 데스크톱(lg+)에서는 다이얼로그를 페이지 영역 중앙으로 옮기고 폭을 클램프해 패널을 가리지 않게 한다.
// closed/fullscreen 에서는 기존 modal 동작(접근성) 그대로다 — 단 모바일 AI 시트는 side 와 같이 취급(모바일의 유일한 AI 표면).
// shadcn primitive(components/ui/dialog.tsx)는 편집하지 않고 호출부 props/className 조합으로만 적용한다.
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { useAssistant } from '@/components/ai/AIAssistantContext';
import { inertPageArea, isAiPanelInteraction, isInAiPanelDom } from '@/components/ai/aiPanelSurface';
import { DialogPortal } from '@/components/ui/dialog';
import { useIsMobile } from '@/hooks/useIsMobile';

// side 모드 데스크톱 배치 — 페이지 영역(뷰포트 - 패널 폭) 중앙 + 폭 클램프.
// Tailwind 는 정적 클래스만 수집하므로 크기별 리터럴로 둔다.
//  - default: 기본 DialogContent(sm:max-w-lg=32rem) 폭을 유지하되 페이지 영역을 넘지 않게 min().
//  - wide: 넓은 미리보기(w-[64rem]·CSS resize)도 드래그로 패널을 덮지 못하게 페이지 영역 폭으로 제한.
const SIDE_CONTENT_CLASS = {
  default:
    'lg:left-[calc((100%-var(--ai-side-width,0px))/2)] lg:max-w-[min(32rem,calc(100%-var(--ai-side-width,0px)-2rem))]',
  wide: 'lg:left-[calc((100%-var(--ai-side-width,0px))/2)] lg:max-w-[calc(100%-var(--ai-side-width,0px)-2rem)]',
} as const;

interface Options {
  /** 다이얼로그 열림 여부 — side 모드에서 열린 동안만 페이지 영역을 inert 로 만든다. */
  open: boolean;
  /** 콘텐츠 폭 프리셋 — 기본 다이얼로그(default) / 넓은 미리보기(wide). */
  size?: keyof typeof SIDE_CONTENT_CLASS;
}

/** DialogContent 에 펼칠 이벤트 핸들러 묶음. */
interface ContentHandlers {
  onInteractOutside: (e: Event) => void;
  onEscapeKeyDown: (e: KeyboardEvent) => void;
  onOpenAutoFocus: (e: Event) => void;
  onCloseAutoFocus: (e: Event) => void;
}

interface Result {
  /** `<Dialog modal>` 에 넘길 값 — side 모드면 false. */
  modal: boolean;
  /** `<DialogContent>` 에 펼칠 핸들러. */
  contentProps: ContentHandlers;
  /** `<DialogContent className>` 에 cn() 으로 덧붙일 배치 클래스(side 가 아니면 빈 문자열). */
  contentClassName: string;
  /** `<Dialog>` 자식으로 DialogContent 앞에 렌더할 페이지 영역 dim(side 가 아니면 null). */
  overlay: ReactNode;
}

/** AI 사이드 패널과 공존하는 다이얼로그 props 를 만든다. */
export function useAiPanelAwareDialog({ open, size = 'default' }: Options): Result {
  const { mode, close } = useAssistant();
  // 모바일(<lg)은 side 패널이 없고 AI 가 곧 시트(다이얼로그 위 z-[60] AI 표면, WP-191)이므로,
  // 데스크톱 side 와 같은 "다이얼로그 위 AI 질문" 흐름을 시트에 적용한다. 데스크톱 fullscreen 은 기존대로 modal.
  const isMobile = useIsMobile();
  const modal = !(mode === 'side' || (isMobile && mode === 'fullscreen'));

  // side 모드에서 열린 동안 페이지 영역(AppRail·main)을 inert — 포커스 트랩 대신 Tab 이 흐린 페이지로 새지 않고
  // 보조기기에서도 페이지가 숨겨진다(AI 패널·다이얼로그 포털은 제외). 닫힘·모드 전환·언마운트 시 cleanup 으로 해제.
  // aria-modal 은 달지 않는다 — 보조기기가 다이얼로그 밖(AI 패널)까지 무시하게 되어 "모달 위 AI 질문"이 막히므로.
  useEffect(() => {
    if (!open || modal) return;
    return inertPageArea();
  }, [open, modal]);

  // 최신 modal 값 — Radix 가 언마운트 시 늦게(setTimeout) 부르는 포커스 콜백에서 "지금" 값을 보기 위함.
  // 커밋 직후(layout effect) 갱신하므로 그 setTimeout 콜백 시점엔 항상 최신이다.
  const modalRef = useRef(modal);
  useLayoutEffect(() => {
    modalRef.current = modal;
  }, [modal]);
  // 이번 열림 세션이 진행 중인지 + 닫힐 때 포커스를 돌려줄 요소(대개 트리거).
  // modal↔non-modal 전환은 Radix 가 Content 를 다른 컴포넌트로 교체(언마운트→마운트)하므로
  // shadcn 래퍼의 복원 대상 캡처가 교체 시점 activeElement 로 덮이거나 비워진다 → 여기서 세션 단위로 직접 관리.
  const sessionActive = useRef(false);
  const restoreTarget = useRef<HTMLElement | null>(null);

  // AI 표면을 누르거나 포커스가 그리로 가도 다이얼로그는 닫지 않는다(pointerdown·focusin 모두 이 콜백을 거친다).
  // 그 외 페이지 영역(dim 포함) 상호작용은 기본 동작 — 닫힘.
  const onInteractOutside = useCallback((e: Event) => {
    if (isAiPanelInteraction(e)) e.preventDefault();
  }, []);

  // Esc: AI 표면에서 누르면 다이얼로그가 아니라 패널만 닫는다.
  // Radix 의 Esc 리스너(document)가 AIAssistantProvider 단축키의 window 리스너보다 먼저 돌고, 여기서 preventDefault 하면
  // 전역 리스너는 defaultPrevented 라 패널을 닫지 않으므로 패널 닫기를 직접 호출한다(둘이 동시에 닫히지 않음).
  const onEscapeKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isInAiPanelDom(e.target)) return;
      e.preventDefault();
      close();
    },
    [close],
  );

  // 열림 자동 포커스: 세션 첫 마운트에서만 복원 대상을 캡처한다.
  // 세션 중 재마운트(모드 전환)가 non-modal 로 바뀐 것이라면 포커스를 다이얼로그로 끌어오지 않는다
  // — ⌘K 로 패널을 연 사용자가 바로 패널 입력창에 타이핑할 수 있게(패널 autoFocus 유지).
  const onOpenAutoFocus = useCallback((e: Event) => {
    if (!sessionActive.current) {
      sessionActive.current = true;
      const active = document.activeElement;
      restoreTarget.current = active instanceof HTMLElement && active !== document.body ? active : null;
      return;
    }
    if (!modalRef.current) e.preventDefault();
  }, []);

  // 닫힘 자동 포커스: 이 콜백이 렌더될 때의 modal 과 지금 modal 이 다르면 "닫힘"이 아니라 모드 전환에 따른
  // Content 교체다 → 포커스 복원을 막는다(안 막으면 패널 입력창의 포커스를 트리거가 뺏는다).
  // 실제 닫힘이면 세션 첫 열림 때 캡처한 요소로 포커스를 돌려준다(shadcn 래퍼와 같은 규칙, 교체에도 안전).
  // (클로저의 modal 은 이 콜백이 만들어진 렌더 시점 값, modalRef.current 는 지금 값이다.)
  const onCloseAutoFocus = useCallback(
    (e: Event) => {
      if (modal !== modalRef.current) {
        e.preventDefault();
        return;
      }
      sessionActive.current = false;
      const target = restoreTarget.current;
      restoreTarget.current = null;
      if (target && target.isConnected) {
        e.preventDefault();
        target.focus();
      }
    },
    [modal],
  );

  return {
    modal,
    contentProps: { onInteractOutside, onEscapeKeyDown, onOpenAutoFocus, onCloseAutoFocus },
    contentClassName: modal ? '' : SIDE_CONTENT_CLASS[size],
    // 페이지 영역 dim — 기존 DialogOverlay 와 같은 톤(bg-black/50·z-50). 데스크톱에선 패널 폭만큼 우측을 비워
    // 패널은 덮지 않는다(모바일은 AI 시트 레이어가 z-[60] 이라 inset-0 이어도 시트 아래에 깔린다).
    // DialogPortal 은 다이얼로그가 열려 있을 때만 렌더되므로 닫히면 함께 사라진다. 클릭 시 바깥 클릭으로 닫힘.
    overlay: modal ? null : (
      <DialogPortal>
        {/* data-state 를 직접 달아 DialogOverlay 와 같은 진입/퇴장 페이드 — DialogPortal 의 Presence 가 퇴장 애니메이션을 기다린다. */}
        <div
          aria-hidden
          data-state={open ? 'open' : 'closed'}
          data-testid="ai-aware-dialog-overlay"
          className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 lg:right-[var(--ai-side-width,0px)]"
        />
      </DialogPortal>
    ),
  };
}
