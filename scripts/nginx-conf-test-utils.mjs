// 웹 nginx 설정 글자 검사 테스트(scripts/nginx-*.test.mjs)의 공용 도구 — 설정 읽기와 location 본문 꺼내기를 한곳에 둔다.
// 여러 테스트가 같은 파서를 따로 두면 한쪽만 고쳐 어긋나므로 모은다. 이름이 *.test.mjs 가 아니라 test:scripts 가 테스트로 돌리지 않는다.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 저장소 루트 — 실행 위치(cwd)와 상관없이 파일을 찾는다(scripts/*.test.mjs 와 같은 방식).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 웹 nginx.conf 를 주석(`#` 뒤)을 지운 글자로 읽는다 — 주석 속 예시가 검사에 걸리지 않게. */
export function readWebNginxConf() {
  return readFileSync(path.join(root, 'apps/workplace-web/nginx.conf'), 'utf8').replace(/#.*$/gm, '')
}

/**
 * 머리(location 뒤 ~ `{` 앞, 앞뒤 공백 제거)가 match 에 맞는 첫 location 의 본문을 꺼낸다(없으면 null).
 * match 는 머리 글자(정확히 같을 때) 또는 머리 → boolean 함수. 중첩 블록(if 등)은 본문에 그대로 남는다.
 */
export function locationBody(conf, match) {
  const accept = typeof match === 'function' ? match : (head) => head === match
  const re = /location\s+([^{]+)\{/g
  let m
  while ((m = re.exec(conf))) {
    if (!accept(m[1].trim())) continue
    let depth = 1
    let i = re.lastIndex
    while (depth > 0 && i < conf.length) {
      if (conf[i] === '{') depth++
      else if (conf[i] === '}') depth--
      i++
    }
    return conf.slice(re.lastIndex, i - 1)
  }
  return null
}
