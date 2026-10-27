 
// 팀 채팅 화면 테스트 공용 도구(WP-966 웨이브 3 b5) — e2e/pages/chat/* 에서 옮긴 판정이 같이 쓴다.
// App·인증 부팅·앱 셸(레일·AI 패널)을 거치지 않고 채팅 라우트(사이드바 레이아웃 + 채널·DM·스레드 인박스 화면)만
// renderScreen 으로 띄운다. 실시간 SSE 는 앱 셸(AppLayout)이 구독하므로, 같은 구독(useEventStream)과 연결 상태 컨텍스트만
// 작은 호스트(ChatStreamHost)로 세워 프레임 → 캐시 → 화면을 브라우저 없이 본다.
import { http, HttpResponse, type RequestHandler } from "msw";
import { type ComponentType, type ReactNode, useMemo } from "react";
import { Route, Routes, useParams } from "react-router-dom";

import { setAccessToken } from "@/api/client";
import { AIAssistantProvider } from "@/components/ai/AIAssistantContext";
import { ChatModuleLayout } from "@/components/chat/ChatModuleLayout";
import { MessagingConnectionContext } from "@/hooks/MessagingConnectionContext";
import { useRouteDocumentTitle } from "@/hooks/useDocumentTitle";
import { useEventStream } from "@/hooks/useEventStream";
import ChannelListPage from "@/pages/chat/ChannelListPage";
import ChannelPage from "@/pages/chat/ChannelPage";
import DmPage from "@/pages/chat/DmPage";
import NewMessagePage from "@/pages/chat/NewMessagePage";
import SelfDmRedirect from "@/pages/chat/SelfDmRedirect";
import ThreadsInboxPage from "@/pages/chat/ThreadsInboxPage";
import { renderScreen } from "@/test/renderScreen";
import type {
  ChannelMemberResponse,
  ChannelResponse,
  DmResponse,
  MessageResponse,
} from "@/types/messaging";

import { createPageResponse } from "../../../../e2e/fixtures/api-mock";

export const API = "/api/v1";
export const ME_ID = 1;

/** 앱 셸이 하던 통합 SSE 구독과 연결 상태 전달만 한다 — 끊김 배너·실시간 프레임 반영을 보는 데 필요한 최소 셸. */
function ChatStreamHost({ children }: { children: ReactNode }) {
  const { isConnected } = useEventStream(ME_ID);
  const value = useMemo(() => ({ isConnected }), [isConnected]);
  return (
    <MessagingConnectionContext.Provider value={value}>
      {children}
    </MessagingConnectionContext.Provider>
  );
}

/** App 의 RouteDocumentTitle 과 같다 — 주소별 기본 탭 제목(「대화 · …」)을 맞춘다(WP-814). */
function RouteTitle() {
  useRouteDocumentTitle();
  return null;
}

/** App.tsx 의 KeyedByParam 과 같다 — 채널·DM 화면을 id 마다 새로 마운트한다(WP-418). */
function KeyedByParam({
  component: Page,
  param,
}: {
  component: ComponentType;
  param: string;
}) {
  const params = useParams();
  return <Page key={params[param]} />;
}

/** App.tsx 의 /chat 라우트 묶음과 같은 모양 — 레이아웃(사이드바) 아래 채널·DM·새 메시지·스레드 인박스. */
export function ChatRoutes() {
  return (
    // 첨부 뷰어가 AI 패널 상태(useAiPanelAwareDialog)를 읽으므로 앱 셸처럼 AI 어시스턴트 상태만 세운다(단축키 끔).
    <AIAssistantProvider hotkeysEnabled={false}>
      <ChatStreamHost>
        <RouteTitle />
        <Routes>
          <Route path="/chat" element={<ChatModuleLayout />}>
            <Route index element={<ChannelListPage />} />
            <Route path="new" element={<NewMessagePage />} />
            <Route
              path="channels/:id"
              element={<KeyedByParam component={ChannelPage} param="id" />}
            />
            <Route path="threads/inbox" element={<ThreadsInboxPage />} />
            <Route path="dms/self" element={<SelfDmRedirect />} />
            <Route
              path="dms/:id"
              element={<KeyedByParam component={DmPage} param="id" />}
            />
          </Route>
          {/* 채팅 밖으로 나가는 이동(드라이브·캘린더 등)은 도착 주소만 본다. */}
          <Route path="*" element={<div data-testid="outside-chat" />} />
        </Routes>
      </ChatStreamHost>
    </AIAssistantProvider>
  );
}

/**
 * 통합 SSE(/api/v1/events)를 테스트가 프레임을 밀어 넣을 수 있는 열린 스트림으로 둔다(E2E mockGatedEvents 자리).
 * push 는 열린 연결이 생길 때까지 기다린 뒤 모든 열린 연결에 보낸다.
 */
export function chatEvents() {
  const open = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const handler = http.get(`${API}/events`, ({ request }) => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c;
        open.add(c);
      },
    });
    request.signal.addEventListener("abort", () => {
      open.delete(ctrl);
      try {
        ctrl.close();
      } catch {
        // 이미 닫혔으면 무시
      }
    });
    return new HttpResponse(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  return {
    handler,
    /** 이벤트 이름·데이터를 SSE 프레임으로 열린 연결 모두에 보낸다. */
    async push(event: string, data: unknown) {
      for (let i = 0; open.size === 0 && i < 100; i++)
        await new Promise((r) => setTimeout(r, 20));
      if (open.size === 0) throw new Error("열린 /api/v1/events 연결이 없다");
      const bytes = new TextEncoder().encode(
        `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      );
      for (const c of open) c.enqueue(bytes);
    },
  };
}

type ChatData = {
  channels?: ChannelResponse[];
  dms?: DmResponse[];
  /** 채널·DM id → 메시지(최신이 앞, 서버 DESC 와 같음). 없는 대화는 빈 목록. */
  messages?: Record<number, MessageResponse[]>;
  /** 채널·DM id → 멤버. 없으면 나 하나. */
  members?: Record<number, ChannelMemberResponse[]>;
};

/**
 * 채팅 화면이 늘 부르는 조회 — 채널·DM 목록과 상세, 메시지·멤버, 읽음·인박스 미읽음 수, 멘션 에이전트, 캐치업.
 * 테스트가 handlers 로 같은 경로를 다시 주면 그쪽이 먼저다(MSW 는 앞에 둔 핸들러를 먼저 본다).
 */
export function chatBaseHandlers({
  channels = [],
  dms = [],
  messages = {},
  members = {},
}: ChatData = {}): RequestHandler[] {
  const conv = (id: number) =>
    channels.find((c) => c.id === id) ?? dms.find((d) => d.id === id);
  return [
    http.get(`${API}/messaging/channels`, () => HttpResponse.json(channels)),
    http.get(`${API}/messaging/dms`, () => HttpResponse.json(dms)),
    http.get(`${API}/messaging/channels/:id`, ({ params }) => {
      const found = conv(Number(params.id));
      return found
        ? HttpResponse.json(found)
        : HttpResponse.json(
            { message: "채널을 찾을 수 없습니다" },
            { status: 404 },
          );
    }),
    http.get(`${API}/messaging/channels/:id/messages`, ({ params }) =>
      HttpResponse.json({
        items: messages[Number(params.id)] ?? [],
        nextCursor: null,
        hasMore: false,
      }),
    ),
    http.get(`${API}/messaging/channels/:id/members`, ({ params }) =>
      HttpResponse.json(
        members[Number(params.id)] ?? [
          {
            userId: ME_ID,
            name: "테스트 사용자",
            kind: "HUMAN",
            role: "OWNER",
            joinedAt: "2026-06-01T00:00:00Z",
          },
        ],
      ),
    ),
    http.post(
      `${API}/messaging/channels/:id/read`,
      () => new HttpResponse(null, { status: 204 }),
    ),
    http.get(`${API}/messaging/threads/inbox/unread-count`, () =>
      HttpResponse.json({ count: 0 }),
    ),
    http.get(`${API}/members`, () =>
      HttpResponse.json(createPageResponse([], { size: 100 })),
    ),
    // 입력창 첨부 초안이 드라이브 개인 공간을 찾는다(드라이브 링크 피커 시작 위치).
    http.get(`${API}/drive/spaces`, () => HttpResponse.json([])),
    // SSE 연결(onOpen)마다 생성 중 AI 대화를 다시 맞춘다 — 채팅 화면 판정과 무관해 빈 목록.
    http.get(`${API}/ai/chat/active`, () =>
      HttpResponse.json({ limit: 3, items: [] }),
    ),
    http.get(
      `${API}/messaging/channels/:id/catchup`,
      () => new HttpResponse(null, { status: 204 }),
    ),
  ];
}

type RenderChatOptions = ChatData & {
  handlers?: RequestHandler[];
  /** 통합 SSE — 기본은 열린 채 아무 프레임도 없는 스트림. 프레임을 밀거나 끊김을 보려면 넘긴다. */
  events?: RequestHandler;
  auth?: Parameters<typeof renderScreen>[1] extends infer O
    ? O extends { auth?: infer A }
      ? A
      : never
    : never;
};

/** 채팅 라우트를 path 로 띄운다 — 화면 데이터는 ChatData, 덮어쓸 응답은 handlers. */
export function renderChat(
  path: string,
  { handlers = [], events, auth, ...data }: RenderChatOptions = {},
) {
  // SSE 구독은 메모리 access 토큰이 있어야 연결한다(renderPage 에선 AuthProvider 가 refresh 로 넣는다).
  setAccessToken("test-access-token");
  return renderScreen(<ChatRoutes />, {
    path,
    auth,
    handlers: [
      ...handlers,
      events ?? chatEvents().handler,
      ...chatBaseHandlers(data),
    ],
  });
}

/** 요청 본문 수집기 — 쓰기 핸들러에서 request.json() 을 모아 비교한다. */
export function recorder<T = unknown>() {
  const bodies: T[] = [];
  return { bodies, push: (b: T) => bodies.push(b) };
}
