// AI 생성 스트림(Drive Overview·Wiki AI·Home Chat) 전용 경량 pub/sub 버스(#593 편입).
// /api/v1/events 는 단일 물리 커넥션(useEventStream)이 이름 prefix 로 정적 라우팅한다(chat/messaging/notify/issue).
// AI 생성은 컴포넌트 인스턴스마다 "생성이 진행 중인 동안만" 동적으로 구독을 열고 닫아야 하므로,
// routeStreamEvent 가 wiki.ai.*/drive.overview.*/home.chat.* 이벤트를 이 버스로 전달하고,
// 각 훅은 필요한 동안만 이 버스에 리스너를 등록한다.

type Listener = (data: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

/** 지정 이벤트 이름에 리스너를 등록한다. 반환된 함수를 호출하면 구독을 해제한다. */
export function onAiStreamEvent(name: string, listener: Listener): () => void {
  let set = listeners.get(name);
  if (!set) {
    set = new Set();
    listeners.set(name, set);
  }
  set.add(listener);
  return () => {
    const s = listeners.get(name);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) listeners.delete(name);
  };
}

/** routeStreamEvent 전용 — 해당 이름의 리스너 전원에 데이터를 전달한다. */
export function emitAiStreamEvent(name: string, data: unknown): void {
  listeners.get(name)?.forEach((listener) => listener(data));
}
