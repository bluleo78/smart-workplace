/**
 * 드라이브 업로드 테스트 공용 도우미 (WP-1531).
 * 리듀서·훅·패널 테스트가 같은 모양의 가짜 파일·대상 목록을 쓰게 한 곳에 둔다.
 */

/** 테스트용 파일 — 내용은 한 글자지만 크기 상한 판정을 보려고 size 를 덮어쓸 수 있다. */
export function makeFile(name: string, size = 10): File {
  const f = new File(['x'], name, { type: 'text/plain' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

/** f0.txt … f{n-1}.txt 를 버튼 경로(path=[])로 올릴 대상 목록. */
export function files(n: number): Array<{ file: File; path: string[] }> {
  return Array.from({ length: n }, (_, i) => ({ file: makeFile(`f${i}.txt`), path: [] }))
}
