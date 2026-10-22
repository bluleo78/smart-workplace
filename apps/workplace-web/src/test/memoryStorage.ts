/**
 * 인메모리 localStorage — Node 의 실험적 전역 localStorage(Node 25+)가 jsdom 것을 가려 테스트 환경에서 비어 있어(--localstorage-file
 * 없이는 메서드가 없다) 직접 세운다. `vi.stubGlobal('localStorage', memoryStorage())` 로 쓴다.
 */
export function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

/** 저장된 키 전부(넣은 순서) — 인메모리 저장소는 Object.keys 로 키가 보이지 않는다. */
export const storageKeys = (s: Storage) => Array.from({ length: s.length }, (_, i) => s.key(i))
