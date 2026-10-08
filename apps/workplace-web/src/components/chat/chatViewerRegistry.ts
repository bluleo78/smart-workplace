// 채팅 첨부 뷰어 호스트 등록부(WP-279) — 같은 열림 키(router state)를 읽는 호스트가 여럿이어도 뷰어는 정확히 하나만 그리게 한다.
// 왜: 스레드 패널의 두 목록과 채널 목록, 여러 AIChatPanel(사이드·전체화면·모바일 시트)이 같은 메시지를 동시에 그릴 수 있다.
//     인스턴스별 스냅숏에 기대면 닫힘·앞으로가기·내비게이션 무동작 같은 틈에서 두 뷰어가 겹치거나 아무도 안 그린다.
// 규칙: 키(표면)마다 소유 호스트 하나. 클릭한 호스트가 가져가고(덮어씀), 소유자 없이 열린 키(앞으로가기·새로고침)는
//       먼저 묶음을 만들 수 있는 호스트가 가져간다. 소유자가 언마운트되면 풀린다.
// React 밖 순수 상태라 vitest 로 규칙을 고정한다(createChatViewerRegistry). 앱은 모듈 싱글턴을 쓴다.

/** 호스트가 알리는 현재 상태 — 열린 키의 묶음을 만들 수 있는지, 목록 조회가 끝났는지. */
export interface ChatViewerHostState {
  resolvable: boolean
  ready: boolean
}

export function createChatViewerRegistry() {
  const hosts = new Map<string, Map<number, ChatViewerHostState>>()
  const owners = new Map<string, number>()
  const listeners = new Set<() => void>()
  let nextId = 1
  const emit = () => listeners.forEach((l) => l())

  return {
    /** 호스트 인스턴스 id 발급. */
    newHostId: () => nextId++,
    subscribe(l: () => void) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    /** 키의 소유 호스트 id(없으면 null). */
    owner: (key: string): number | null => owners.get(key) ?? null,
    /** 소유권을 가져간다(이미 다른 호스트가 가졌어도 덮어쓴다 — 클릭한 호스트가 이긴다). */
    claim(key: string, hostId: number) {
      if (owners.get(key) === hostId) return
      owners.set(key, hostId)
      emit()
    },
    /** 이 호스트가 소유자일 때만 내려놓는다. */
    release(key: string, hostId: number) {
      if (owners.get(key) !== hostId) return
      owners.delete(key)
      emit()
    },
    /** 호스트 상태 보고(렌더 커밋마다). */
    report(key: string, hostId: number, state: ChatViewerHostState) {
      let m = hosts.get(key)
      if (!m) hosts.set(key, (m = new Map()))
      m.set(hostId, state)
    },
    /** 언마운트 — 보고를 지우고 소유권도 푼다. */
    unregister(key: string, hostId: number) {
      hosts.get(key)?.delete(hostId)
      if (owners.get(key) === hostId) {
        owners.delete(key)
        emit()
      }
    },
    /**
     * 열린 키를 보여 줄 수 있는 호스트가 아무도 없는지 — 등록된 호스트가 있고, 모두 조회를 마쳤고, 아무도 묶음을 못 만들 때만 참.
     * 참이면 그 열림 표식은 낡은 것(메시지가 페이지 밖·삭제됨)이라 지워도 된다. 호스트가 하나도 없으면(그 표면이 안 보임) 판단하지 않는다.
     */
    nobodyCanShow(key: string): boolean {
      const m = hosts.get(key)
      if (!m || m.size === 0) return false
      for (const h of m.values()) if (h.resolvable || !h.ready) return false
      return true
    },
  }
}

export type ChatViewerRegistry = ReturnType<typeof createChatViewerRegistry>

/** 앱 전역 등록부(탭 하나에 하나). */
export const chatViewerRegistry = createChatViewerRegistry()
