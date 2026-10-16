// 문자열 키 → 값 맵의 안전 조회(WP-416) — 주소 파라미터·서버 응답처럼 아무 문자열이나 키로 올 수 있는 곳에서 쓴다.
// 객체 리터럴 맵을 map[key] 로 바로 읽으면 'toString'·'constructor' 같은 프로토타입 키가 함수로 새어 나와
// `map[key] ?? 기본값` 의 기본값이 쓰이지 않는다. 자기 키만 조회해 그런 키는 "없음"(undefined)으로 본다.

/** map 의 자기(own) 키일 때만 값을, 아니면 undefined 를 돌려준다. */
export function ownLookup<V>(map: Readonly<Record<string, V>>, key: string): V | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined
}
