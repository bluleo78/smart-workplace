/**
 * 인메모리 localStorage — Node 의 실험적 전역 localStorage(Node 25+)가 jsdom 것을 가려 테스트 환경에서 비어 있어(--localstorage-file
 * 없이는 메서드가 없다) 직접 세운다. `vi.stubGlobal('localStorage', memoryStorage())` 로 쓴다.
 *
 * 브라우저 Storage 처럼 저장한 키가 객체의 열거 가능한 속성으로 보인다 — `Object.entries(localStorage)` 로 키·값을 읽는 테스트가
 * Node 24(happy-dom 의 Storage)와 Node 26(이 대체 저장소)에서 같은 결과를 내게 한다. 메서드는 열거되지 않는다.
 */
export function memoryStorage(): Storage {
  const data = new Map<string, string>()
  const api: Storage = {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
  return new Proxy(api, {
    get: (target, prop, receiver) =>
      prop in target ? Reflect.get(target, prop, receiver) : typeof prop === 'string' ? data.get(prop) : undefined,
    ownKeys: () => [...data.keys()],
    getOwnPropertyDescriptor: (_target, prop) =>
      typeof prop === 'string' && data.has(prop)
        ? { value: data.get(prop), enumerable: true, configurable: true, writable: true }
        : undefined,
  })
}

/** 저장된 키 전부(넣은 순서) — Storage API(length·key)로 읽어 어떤 저장소에서도 같다. */
export const storageKeys = (s: Storage) => Array.from({ length: s.length }, (_, i) => s.key(i))
