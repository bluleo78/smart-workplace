// 메일 작성 도크 컨텍스트 — 앱 어디서든 새/답장/전달을 prefill 상태로 도크 오픈.
// v1 단일 창(동시 1통). 도크 본체는 MailComposeDock 이 렌더.
// 임시저장(WP-577): 다른 작성으로 바뀌기 전에 작성창이 등록한 저장(handlers.save)을 먼저 돌리고,
// 같은 임시저장을 다시 열면 새로 열지 않고 지금 창을 앞으로 가져온다(handlers.raise). 임시보관함에서 지운 임시저장이
// 열려 있으면 저장 없이 닫는다(closeDraft — 지운 임시저장을 다시 저장하지 않게).
// 작성 방식 기본값(WP-1744): 내 메일 설정(composeMode)은 「새 작성」(openCompose 에 placement 를 넘긴 호출 — 새 메일·답장·전달·
// 임시보관함에서 열기·AI 답장 초안)에만 쓴다. 저장 실패 「다시 열기」·「되돌리기」·충돌 「다시 불러오기」처럼 이미 쓰던 작성을 다시 여는 길은
// placement 없이 불러 처음 배치 규칙(우측 하단, 창 미리 열지 않음 — WP-1743)대로 연다. 읽기 창은 도크 본체가 회차마다 initialPlacementFor 로
// 정하고, 새 창은 팝업 차단을 피하려 openCompose(클릭 처리 중)가 빈 창을 미리 열어 두고 도크 본체가 작성기가 준비되면 그 창으로 옮긴다.

import { useQueryClient } from '@tanstack/react-query';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { mailSettingsKey, useMailSettings } from '@/hooks/queries/useMailSettings';
import { getIsMobile } from '@/hooks/useIsMobile';
import type { ComposeAttachment } from '@/lib/mailComposeAttachments';
import { openMailComposeWindow } from '@/lib/mailComposeChannel';
import type { MailQuote } from '@/lib/mailQuote';
import type { ComposeMode } from '@/types/mailDraft';
import type { MailComposeDefault, MailUserSettings } from '@/types/mailSettings';

// 작성 종류는 임시저장 DTO 와 같은 값이라 types 에 두고 여기서 다시 내보낸다(기존 import 경로 호환).
export type { ComposeMode };

/**
 * 작성창 배치(WP-1743) — 우측 하단 작은 창(dock) / 최소화(min) / 메일 읽기 자리(pane).
 * 옛 `fill`(가운데 큰 모달)은 `pane` 이 잇는다(확대 단추 = 「읽기 창으로」).
 */
export type ComposeSize = 'dock' | 'min' | 'pane';

/** 작성 초기값(새/답장/전달·임시저장이 채워 보낸다). */
export interface ComposeDraft {
  /** 작성 종류. 화면 제목과 새 메일 전용 기능(AI 초안)이 이 값으로 갈린다. */
  mode: ComposeMode;
  accountId: number;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** 초기 본문 HTML — 내가 쓸 부분만. 답장/전달은 ''(AI 초안이면 그 초안). */
  initialHtml: string;
  /**
   * 인용문 — html/text/meta/variant 를 하나로 묶은 객체. 에디터 미경유·불변.
   * 없으면 null(이 값이 "인용문 없음"의 단일 판별자다). 4개 평면 필드였던 이전 표현은
   * "quoteHtml 만 있고 meta 없음" 같은 불가능한 상태를 타입으로 배제하지 못했다.
   */
  quote: MailQuote | null;
  /**
   * 처음 붙어 있는 첨부(WP-574) — 전달은 원본 메일의 첨부가 미리 들어간다(각각 ✕ 로 뺄 수 있다).
   * 없으면 빈 목록. 작성 중 바뀌는 첨부 상태는 작성창(useMailComposeAttachments)이 들고, 이 값은 시작값으로만 쓴다.
   */
  attachments?: ComposeAttachment[];
  /** 답장 대상 로컬 message id(없으면 새 메일/전달). */
  inReplyToMessageId: number | null;
  /**
   * 답장·전달의 원본 메일 id(WP-577) — 임시저장을 다시 열 때 인용문을 원본으로 다시 만든다.
   * 전달은 inReplyToMessageId 가 null 이라 이 값이 없으면 원본을 찾을 수 없다. 새 메일은 없음.
   */
  sourceMessageId?: number | null;
  /** 작성 중 인용문을 지웠는가(WP-577) — 임시보관함에서 다시 열 때 이어받아 다음 저장에도 그대로 싣는다. 생략하면 false. */
  quoteRemoved?: boolean;
  /** 저장에 실패해 「다시 열기」로 연 작성 — 처음부터 저장 안 된 상태라 곧 다시 저장하고, 그냥 닫아도 저장한다. */
  unsaved?: boolean;
  /** 이 작성의 임시저장 id — 임시보관함에서 열었거나 첫 자동 저장(POST)이 끝나면 생긴다. */
  draftId?: number;
  /** 임시보관함에서 열 때의 서버 버전 — 첫 PUT 에 싣는다. */
  draftVersion?: number;
  /** openCompose 마다 부여되는 고유 인스턴스 id(에디터 재마운트 key 용). */
  instanceId?: number;
}

/**
 * 새 작성의 처음 배치를 작성 방식 기본값으로 정하는가(WP-1744) — openCompose 의 opts.placement.
 * - 'default': 설정 그대로(읽기 창·우측 하단·새 창) — 새 메일·답장·전달·임시보관함에서 열기.
 * - 'default-inline': 새 창을 우측 하단으로 본다(읽기 창은 그대로) — AI 답장 초안처럼 응답을 기다린 뒤 열려 클릭과 멀어 팝업이 늘 막히는 길.
 * 넘기지 않으면 기본값을 쓰지 않는다(우측 하단, 창 미리 열지 않음) — 쓰던 작성을 다시 여는 길(다시 열기·되돌리기·다시 불러오기).
 */
export type ComposePlacement = 'default' | 'default-inline';

/** openCompose 선택 사항. */
export interface OpenComposeOptions {
  /** 열린 작성의 저장을 건너뛴다 — 충돌 다시 불러오기. */
  skipSave?: boolean;
  /** 작성 방식 기본값을 쓸지(WP-1744). 없으면 쓰지 않는다. */
  placement?: ComposePlacement;
}

interface MailComposeContextValue {
  draft: ComposeDraft | null;
  /** 작성창 열기. 다른 작성이 열려 있으면 그 작성의 저장을 먼저 돌린다(skipSave 면 건너뛴다 — 충돌 다시 불러오기). */
  openCompose: (draft: ComposeDraft, opts?: OpenComposeOptions) => void;
  /**
   * 지금 작성 방식 기본값(WP-1744) — 클릭 처리 중에 설정 캐시를 바로 읽는다(값을 구독하지 않아 설정이 도착해도 다시 그리지 않는다).
   * 설정을 못 받았거나 실패했으면 DOCK. 새 창 페이지 공급자는 늘 DOCK, 모바일 셸(늘 화면 전체 작성)에서는 「새 창」을 DOCK 으로 본다 —
   * 이 두 판정은 여기 한 곳에서만 해서, 이 값이 WINDOW 이면 곧 「데스크톱 앱 창에서 새 창으로 연다」는 뜻이다. 임시보관함 열기가 새 창으로 바로 열지 정할 때 쓴다.
   */
  getComposeDefault: () => MailComposeDefault;
  closeCompose: () => void;
  /** 그 작성이 아직 열려 있을 때만 닫는다 — 보내는 동안 다른 작성으로 바뀌었으면 그 작성을 닫지 않게. */
  closeInstance: (instanceId: number) => void;
  /** 인용문 제거 — 기밀 문단을 빼고 회신하는 시나리오. instanceId 는 유지(에디터 리마운트 금지). */
  clearQuote: () => void;
  /** 첫 자동 저장으로 받은 id 를 지금 작성에 묶는다(instanceId 유지) — 같은 임시저장을 다시 열 때 알아보게. */
  bindDraftId: (instanceId: number, draftId: number) => void;
  /**
   * 그 임시저장이 기본값 「새 창」으로 옮기는 중인 작성(우측 하단 창을 감춘 채 새 창으로 가는 길)인가 — 임시보관함에서 다시 누를 때 감춰진 창을
   * 올리는 대신 안내하려고 읽는다. ref 로 읽어 값을 구독하지 않는다(옮기는 회차가 바뀔 때마다 소비자가 다시 그려지지 않게).
   */
  isMovingToWindow: (draftId: number) => boolean;
  /** 그 임시저장이 지금 열려 있으면 앞으로 가져오고(handlers.raise) true. */
  focusDraft: (draftId: number) => boolean;
  /** 그 임시저장이 지금 열려 있으면 저장하지 않고 닫고 true — 임시보관함에서 지울 때. */
  closeDraft: (draftId: number) => boolean;
  /** 작성창이 등록하는 손잡이(닫히면 null) — 다른 작성으로 바뀌기 직전 save, 같은 임시저장을 다시 열 때 raise, 지운 임시저장을 닫을 때 abandon. */
  setComposeHandlers: (h: ComposeHandlers | null) => void;
}

/**
 * 작성창 배치 상태(WP-1743) — 도크 컨텍스트와 따로 둔다. 크기 전환·슬롯 등록은 자주 바뀌는데,
 * 한 컨텍스트에 두면 그때마다 openCompose 만 쓰는 사이드바·임시보관함 같은 모든 소비자가 다시 그려지기 때문이다.
 */
interface MailComposeLayoutContextValue {
  /**
   * 지금 배치 — 도크 본체와 메일 읽기 자리(MailComposePaneSlot)가 같은 값을 봐야 호스트 이동과 접기가 어긋나지 않는다.
   * 새 작성마다 처음 배치를 정하는 규칙(작성 방식 기본값 — 읽기 창 또는 dock, WP-1744)은 도크 본체의 instanceId 효과가 맡는다.
   */
  size: ComposeSize;
  /** 배치 바꾸기 — 값이나 다음 값을 고르는 함수를 받는다(setState 그대로). */
  setSize: Dispatch<SetStateAction<ComposeSize>>;
  /**
   * 읽기 자리 슬롯 — 메일 화면이 슬롯 DOM 을 등록하면, 도크는 그 안으로 호스트를 옮긴다(포털 없이 appendChild).
   * 슬롯이 없으면(메일 화면 밖) null — 「읽기 창으로」 단추 비활성 판정이 이 값을 쓴다.
   */
  slotEl: HTMLElement | null;
  /** 슬롯 등록·해제 — 슬롯 div 의 ref 로 넘긴다(setState 그대로라 안정적이고, 같은 요소로 다시 불러도 리렌더가 없다). */
  registerSlot: Dispatch<SetStateAction<HTMLElement | null>>;
  /**
   * 그 회차에 적용할 작성 방식 기본값(WP-1744) — openCompose 가 placement 를 받아 정해 둔 값(default-inline 이면 새 창은 DOCK).
   * placement 없이 연 회차(다시 열기·되돌리기·다시 불러오기)나 모르는 회차는 null — 도크 본체는 지금처럼 우측 하단으로 연다.
   * 설정을 아직 못 받았거나 실패했으면 DOCK(작성창 열기를 설정 조회로 늦추지 않는다). 작성 초안(ComposeDraft)에 싣지 않는다 —
   * 「다시 열기」가 초안을 펼쳐 다시 넘겨도 이 값이 따라가지 않고, 임시저장 payload 에도 섞이지 않게.
   */
  initialPlacementFor: (instanceId: number) => MailComposeDefault | null;
}

/**
 * 기본값 「새 창」으로 옮기는 중 상태(WP-1744) — 배치 컨텍스트와 따로 둔다. 「새 창」 작성마다 바뀌는데, 배치 컨텍스트에 두면
 * setSize 만 쓰는 메일 화면 전체(MailInboxPage)가 그때마다 다시 그려지기 때문이다. 도크 본체만 구독한다.
 */
interface MailComposeWindowMoveContextValue {
  /**
   * 새 창으로 옮기는 중인 작성 회차 — 기본값 「새 창」이 미리 연 창으로 옮기는 동안 도크 본체가 우측 하단 창을 감춘다(깜빡임 방지).
   * 옮기지 못하면(차단·저장 실패) 도크 본체가 endWindowMove 로 풀어 우측 하단에 다시 보인다. 없으면 null.
   */
  windowMoveFor: number | null;
  /**
   * 그 회차를 위해 openCompose 가 미리 연 창을 한 번 꺼낸다 — Window(열림) / null(팝업 차단) / undefined(새 창 기본값이 아니었거나 이미 꺼냄).
   */
  takePendingWindow: (instanceId: number) => Window | null | undefined;
  /**
   * 새 창으로 옮기기를 그만둔다(우측 하단 창을 다시 보인다). 그 회차가 옮기는 중일 때만 푼다 — 앞 회차의 늦은 실패가
   * 그 사이 연 다음 회차의 감춤까지 풀지 않게 회차를 가린다. 옮기는 중이 아니거나 다른 회차면 아무 일도 하지 않는다.
   */
  endWindowMove: (instanceId: number) => void;
}

/** 작성창(도크)이 컨텍스트에 맡기는 임시저장 동작. */
export interface ComposeHandlers {
  /** 남은 변경을 바로 저장(결과는 작성창이 토스트로 알린다). */
  save: () => void;
  /** 창을 앞으로 가져온다 — 최소화했으면 작은 창으로 펼친다. */
  raise: () => void;
  /** 이후 저장하지 않는다(기다리던 저장도 버린다). */
  abandon: () => void;
}

const MailComposeContext = createContext<MailComposeContextValue | null>(null);
const MailComposeLayoutContext = createContext<MailComposeLayoutContextValue | null>(null);
const MailComposeWindowMoveContext = createContext<MailComposeWindowMoveContextValue | null>(null);

/**
 * 한 작성 회차의 처음 배치 기록(WP-1744) — openCompose 가 placement 를 받아 정하고, 회차가 바뀌거나 공급자가 사라지면 지운다.
 * mode 는 그 회차에 적용할 기본값(initialPlacementFor), win 은 기본값 「새 창」으로 미리 연 창(null 이면 팝업 차단, 없으면 미리 열지 않음).
 * 회차 정보를 한 ref 에 두어 commit·정리·takePendingWindow·initialPlacementFor 가 한 곳에서 회차를 비교한다.
 */
interface PlacementRecord {
  instanceId: number;
  mode: MailComposeDefault;
  win?: Window | null;
  /** 미리 연 창의 시한 타이머 — 꺼내지 못한 빈 창이 남지 않게 한다. 회차 정리·언마운트에서 지운다. */
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * 미리 연 빈 창의 시한(ms) — 이 안에 도크가 꺼내 가지 않으면(작성기 준비·서명 조회가 끝나지 않음) 창을 닫고
 * 우측 하단 창을 다시 보인다. 빈 창과 감춘 작성창이 계속 남는 것을 막는다.
 */
export const MAIL_COMPOSE_PREOPEN_TIMEOUT_MS = 10_000;

/** 쓰이지 않은 미리 연 창 기록을 푼다 — 시한 타이머를 끄고 아직 안 꺼낸 빈 창을 닫는다(회차 전환·공급자 해제 공용). */
function releasePendingWindow(record: PlacementRecord | null | undefined) {
  if (!record) return;
  clearTimeout(record.timer);
  record.win?.close();
}

/**
 * 도크 상태 provider. AppLayout 이 감싼다. popout 은 새 창 페이지(WP-1535)의 공급자 — 작성 방식 기본값을 읽지도 쓰지도 않는다.
 */
export function MailComposeProvider({ children, popout = false }: { children: ReactNode; popout?: boolean }) {
  const [draft, setDraft] = useState<ComposeDraft | null>(null);
  // 작성 방식 기본값(WP-1744) — 조회만 여기서 띄운다(앱 셸이 늘 마운트하므로 클릭 전에 받아 둔다). 값은 클릭 처리 중 캐시에서 바로 읽는다
  // (구독한 값으로 openCompose 를 다시 만들면 설정이 도착할 때 openCompose 만 쓰는 모든 소비자가 다시 그려진다).
  useMailSettings({ enabled: !popout });
  const qc = useQueryClient();
  // 지금 회차의 처음 배치 기록 — 회차 하나만 기억하면 된다.
  const placementRef = useRef<PlacementRecord | null>(null);
  // 새 창으로 옮기는 중인 회차 — 그동안 우측 하단 창을 감춘다.
  const [windowMoveFor, setWindowMoveFor] = useState<number | null>(null);
  // 지금 배치(WP-1743) — 도크 본체와 메일 읽기 자리 슬롯이 함께 보는 단일 값이라 컨텍스트(배치 컨텍스트)로 올렸다.
  const [size, setSize] = useState<ComposeSize>('dock');
  // 읽기 자리 슬롯 DOM — 메일 화면이 등록하고, 도크 호스트를 옮길 자리로 쓴다.
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  // 같은 ms 충돌을 피하려 단조 증가 ref 카운터로 인스턴스 id 를 찍는다.
  const seq = useRef(0);
  // 지금 작성 — focusDraft·bindDraftId 가 렌더 클로저가 아니라 최신 값을 보게 ref 로도 둔다.
  const draftRef = useRef<ComposeDraft | null>(null);
  const handlers = useRef<ComposeHandlers | null>(null);
  // 옮기는 중인 회차의 최신 값 — isMovingToWindow 가 렌더 클로저가 아니라 지금 값을 읽게 ref 로도 둔다.
  const windowMoveRef = useRef<number | null>(null);
  useEffect(() => {
    windowMoveRef.current = windowMoveFor;
  }, [windowMoveFor]);

  // 지금 작성 방식 기본값 — 새 창 페이지는 늘 DOCK, 모바일 셸은 「새 창」을 DOCK 으로(늘 화면 전체 작성). 두 판정은 여기서만 한다.
  const getComposeDefault = useCallback((): MailComposeDefault => {
    if (popout) return 'DOCK';
    const mode = qc.getQueryData<MailUserSettings>(mailSettingsKey)?.composeMode ?? 'DOCK';
    return mode === 'WINDOW' && getIsMobile() ? 'DOCK' : mode;
  }, [popout, qc]);

  // 그 회차가 옮기는 중일 때만 푼다 — 함수형 갱신이라 늦게 도착한 앞 회차의 해제가 새 회차의 값을 건드리지 못한다.
  const endWindowMove = useCallback((instanceId: number) => setWindowMoveFor((cur) => (cur === instanceId ? null : cur)), []);

  const commit = useCallback((d: ComposeDraft | null) => {
    draftRef.current = d;
    setDraft(d);
    // 다른 작성으로 바뀌었거나 닫혔다 — 그 회차의 기록을 지우고, 미리 열어 두고 아직 쓰지 않은 창은 닫고, 감춤도 푼다(빈 창이 남지 않게).
    const record = placementRef.current;
    if (record && record.instanceId !== d?.instanceId) {
      releasePendingWindow(record);
      placementRef.current = null;
    }
    setWindowMoveFor((v) => (v != null && v === d?.instanceId ? v : null));
  }, []);

  const openCompose = useCallback(
    (d: ComposeDraft, opts?: OpenComposeOptions) => {
      // 열려 있는 작성이 있으면 그 내용을 먼저 저장한다 — 다른 메일에 답장을 눌러도 쓰던 것이 임시보관함에 남게.
      if (draftRef.current && !opts?.skipSave) handlers.current?.save();
      const instanceId = ++seq.current;
      // 이 회차에 적용할 기본값(WP-1744) — placement 없이 연 작성은 기본값을 쓰지 않는다. default-inline 은 새 창을 우측 하단으로 본다.
      const base = opts?.placement ? getComposeDefault() : null;
      const mode: MailComposeDefault | null = opts?.placement === 'default-inline' && base === 'WINDOW' ? 'DOCK' : base;
      // 기본값 「새 창」(WP-1744) — 클릭 처리 중인 지금 빈 창을 연다(효과에서 열면 클릭과 멀어져 팝업 차단을 더 받는다).
      // 막히면 null 을 남겨 도크 본체가 차단 안내를 띄우게 한다. 새 창 페이지·모바일 셸은 getComposeDefault 가 WINDOW 를 돌려주지 않는다.
      const win = mode === 'WINDOW' ? openMailComposeWindow() : undefined;
      // 앞 회차 기록은 commit 이 정리하므로(미리 연 창 닫기) 새 기록은 그 뒤에 둔다.
      commit({ ...d, instanceId });
      const record: PlacementRecord | null = mode ? { instanceId, mode, win } : null;
      placementRef.current = record;
      // 창이 열렸을 때만 우측 하단 창을 감춘다 — 막혔으면 우측 하단에 그대로 보인다.
      if (win && record) {
        setWindowMoveFor(instanceId);
        // 시한 — 그때까지 같은 회차의 창이 아직 꺼내지지 않았으면 닫고 우측 하단에 다시 보인다(꺼낸 뒤엔 도크가 맡아 닫지 않는다).
        record.timer = setTimeout(() => {
          record.timer = undefined;
          if (placementRef.current !== record || !record.win) return;
          // 사용자가 그 사이 빈 창을 닫았으면 그만둔 것이다 — 우측 하단에 되돌리기만 하고 준비 못 했다는 안내는 띄우지 않는다.
          const userClosed = record.win.closed;
          record.win.close();
          record.win = undefined;
          endWindowMove(instanceId);
          if (!userClosed) toast('새 창을 준비하지 못해 우측 하단에 열었어요');
        }, MAIL_COMPOSE_PREOPEN_TIMEOUT_MS);
      }
    },
    [commit, getComposeDefault, endWindowMove],
  );
  const takePendingWindow = useCallback((instanceId: number) => {
    const record = placementRef.current;
    if (record?.instanceId !== instanceId || record.win === undefined) return undefined;
    const { win } = record;
    // 꺼냈으니 시한은 필요 없다 — 이후 창은 도크 본체가 닫는다.
    clearTimeout(record.timer);
    record.timer = undefined;
    // 꺼낸 창은 도크 본체가 맡는다 — 회차가 바뀌어도 commit 이 다시 닫지 않게 기록에서 뺀다(처음 배치 mode 는 남긴다).
    record.win = undefined;
    return win;
  }, []);
  const initialPlacementFor = useCallback(
    (instanceId: number) => (placementRef.current?.instanceId === instanceId ? placementRef.current.mode : null),
    [],
  );
  // 공급자가 사라지면(로그아웃 등) 쓰이지 않은 미리 연 창을 닫는다.
  useEffect(
    () => () => {
      releasePendingWindow(placementRef.current);
      placementRef.current = null;
    },
    [],
  );
  const closeCompose = useCallback(() => commit(null), [commit]);
  const closeInstance = useCallback(
    (instanceId: number) => {
      if (draftRef.current?.instanceId === instanceId) commit(null);
    },
    [commit],
  );
  const clearQuote = useCallback(() => {
    const d = draftRef.current;
    if (d) commit({ ...d, quote: null });
  }, [commit]);
  const bindDraftId = useCallback(
    (instanceId: number, draftId: number) => {
      const d = draftRef.current;
      if (d && d.instanceId === instanceId && d.draftId !== draftId) commit({ ...d, draftId });
    },
    [commit],
  );
  const isMovingToWindow = useCallback((draftId: number) => {
    const d = draftRef.current;
    return windowMoveRef.current != null && d?.instanceId === windowMoveRef.current && d.draftId === draftId;
  }, []);
  const focusDraft = useCallback((draftId: number) => {
    if (draftRef.current?.draftId !== draftId) return false;
    handlers.current?.raise();
    return true;
  }, []);
  const closeDraft = useCallback(
    (draftId: number) => {
      if (draftRef.current?.draftId !== draftId) return false;
      // 지운 임시저장에 늦게 PUT 하지 않게 저장을 먼저 멈추고 닫는다(쓰던 변경은 지우기와 함께 버려진다).
      handlers.current?.abandon();
      commit(null);
      return true;
    },
    [commit],
  );
  const setComposeHandlers = useCallback((h: ComposeHandlers | null) => {
    handlers.current = h;
  }, []);

  const value = useMemo(
    () => ({ draft, openCompose, getComposeDefault, closeCompose, closeInstance, clearQuote, bindDraftId, isMovingToWindow, focusDraft, closeDraft, setComposeHandlers }),
    [draft, openCompose, getComposeDefault, closeCompose, closeInstance, clearQuote, bindDraftId, isMovingToWindow, focusDraft, closeDraft, setComposeHandlers],
  );
  // 배치 상태 — setSize·setSlotEl 은 setState 라 안정적이고, size·slotEl 이 바뀔 때만 새 값이 된다.
  const layout = useMemo(
    () => ({ size, setSize, slotEl, registerSlot: setSlotEl, initialPlacementFor }),
    [size, slotEl, initialPlacementFor],
  );
  // 새 창으로 옮기는 중 상태 — 옮기는 회차가 바뀔 때만 새 값이 된다(도크 본체만 구독).
  const windowMove = useMemo(
    () => ({ windowMoveFor, takePendingWindow, endWindowMove }),
    [windowMoveFor, takePendingWindow, endWindowMove],
  );

  return (
    <MailComposeContext.Provider value={value}>
      <MailComposeLayoutContext.Provider value={layout}>
        <MailComposeWindowMoveContext.Provider value={windowMove}>{children}</MailComposeWindowMoveContext.Provider>
      </MailComposeLayoutContext.Provider>
    </MailComposeContext.Provider>
  );
}

/** 도크 컨트롤 훅. */
// eslint-disable-next-line react-refresh/only-export-components
export function useMailCompose() {
  const ctx = useContext(MailComposeContext);
  if (!ctx) throw new Error('useMailCompose must be used within MailComposeProvider');
  return ctx;
}

/** 작성창 배치 훅(WP-1743) — 크기(size)·읽기 자리 슬롯을 쓰는 곳(도크·읽기 자리 슬롯·메일 화면 접기)만 구독한다. */
// eslint-disable-next-line react-refresh/only-export-components
export function useMailComposeLayout() {
  const ctx = useContext(MailComposeLayoutContext);
  if (!ctx) throw new Error('useMailComposeLayout must be used within MailComposeProvider');
  return ctx;
}

/** 새 창으로 옮기는 중 상태 훅(WP-1744) — 도크 본체만 구독한다(기본값 「새 창」으로 미리 연 창 꺼내기·옮기는 동안 감추기). */
// eslint-disable-next-line react-refresh/only-export-components
export function useMailComposeWindowMove() {
  const ctx = useContext(MailComposeWindowMoveContext);
  if (!ctx) throw new Error('useMailComposeWindowMove must be used within MailComposeProvider');
  return ctx;
}
