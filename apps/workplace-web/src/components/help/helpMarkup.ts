// 도움말 본문의 조건 블록·자리표시를 화면 값으로 채운다(WP-1505).
// 표기 규칙의 원본은 매뉴얼 쪽 docs/manual/scripts/lib/help-markup.mjs(braceTokens·splitProseLines·applyHelpMarkupForPdf)다 —
// PDF 와 패널이 같은 글자를 표기로 보도록 중괄호 판정(`$`·`\` 앞은 표기 아님, 코드 안은 목록의 자리표시만)을 그대로 옮긴다.
// 처리 위치를 둘로 나눈다(계획 「내가 정한 것」 7):
// - 조건 블록은 markdown 문자열에서 줄 단위로 — 블록이 목록 여러 항목에 걸쳐 AST 한 노드로 잡히지 않는다.
// - 자리표시는 remark 플러그인으로 AST 노드 값에 — 값이 markdown 으로 해석되지 않아 아이디·주소의 `*`·`[` 가 안전하다.
import type { Nodes, Root } from 'mdast'

import type { HelpVars } from './helpBundle'

/** 화면이 넘기는 자리표시 값·조건 값. undefined 는 「값 없음」(PDF 와 같은 표시로 보인다). */
export type HelpValues = {
  placeholders: Record<string, string | undefined>
  conditions: Record<string, boolean | undefined>
}

// 펜스 줄: 들여쓰기 뒤 ``` 또는 ~~~ 셋 이상(markdown.mjs FENCE 와 같다).
const FENCE_RE = /^\s*(`{3,}|~{3,})/
// 한 줄 안의 중괄호 덩어리(중첩·줄바꿈 없음) — help-markup.mjs BRACE_RE.
const BRACE_RE = /\{([^{}\n]*)\}/g
// 자리표시 이름: 소문자로 시작하고 점이 하나 이상 — help-markup.mjs PLACEHOLDER_NAME_RE.
const PLACEHOLDER_NAME_RE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/
// 줄 전체가 조건 여는/닫는 표기인 줄(줄 단위 꼴) — help-markup.mjs LINE_COND_RE.
const LINE_COND_RE = /^[ \t]*\{(?:if[ \t]+\S+|\/if)\}[ \t\r]*$/
// 목록 항목 줄(번호·글머리표). 그룹 1=표지와 뒤 공백까지 — 꼬리표를 항목 글 앞에 끼울 자리.
const LIST_ITEM_RE = /^([ \t]*(?:\d{1,9}[.)]|[-*+])[ \t]+)/

/**
 * 줄마다 코드 펜스에 속하는지(여닫는 펜스 줄 포함) — markdown.mjs codeLineMask 와 같은 규칙.
 * 닫기는 연 것과 같은 문자이고 길이가 같거나 긴 펜스만 — ~~~ 블록 안의 ``` 예시가 블록을 닫지 않게.
 */
function codeLineMask(lines: string[]): boolean[] {
  let open: string | null = null
  return lines.map((line) => {
    const m = FENCE_RE.exec(line)
    if (open === null) {
      if (m) open = m[1]
      return Boolean(m)
    }
    if (m && m[1][0] === open[0] && m[1].length >= open.length) open = null
    return true
  })
}

type Segment = { text: string; prose: boolean }

/**
 * 줄을 산문·인라인 코드·HTML 주석 조각으로 나눈다(조각을 이으면 원문 줄). 코드·주석 안 중괄호는 조건 표기가 아니다.
 * help-markup.mjs splitProseLines 를 옮긴 것 — 주석은 닫는 `-->` 가 뒤에 있을 때만 주석으로 친다. 줄 첫머리(들여쓰기 0~3칸)의
 * `<!--` 는 HTML 블록이라 빈 줄을 넘어 닫혀도 되고, 줄 가운데 `<!--` 는 인라인 HTML 이라 같은 문단(빈 줄 전) 안에서 닫혀야 한다.
 * 여러 줄 주석은 inComment 상태로 잇는다. 매뉴얼 검사가 주석 안 표기를 막지 않으므로 패널에서도 지우지 않는 것이 목적이다.
 */
function makeSegmenter(lines: string[], code: boolean[]) {
  let inComment = false
  // 줄 i 의 from 부터(뒤 줄 포함) 닫는 `-->` 가 있는지. block 이 아니면 빈 줄에서 멈춘다. 펜스 줄은 건너뛴다(PDF closable 과 같다).
  const closable = (i: number, from: number, block: boolean) => {
    if (lines[i].indexOf('-->', from) >= 0) return true
    for (let k = i + 1; k < lines.length; k++) {
      if (code[k]) continue
      if (!block && lines[k].trim() === '') return false
      if (lines[k].includes('-->')) return true
    }
    return false
  }
  return (line: string, i: number): Segment[] => {
    const out: Segment[] = []
    const push = (text: string, prose: boolean) => {
      if (!text) return
      const last = out[out.length - 1]
      if (last && last.prose && prose) last.text += text
      else out.push({ text, prose })
    }
    let pos = 0
    if (inComment) {
      const end = line.indexOf('-->')
      if (end < 0) return [{ text: line, prose: false }]
      push(line.slice(0, end + 3), false)
      pos = end + 3
      inComment = false
    }
    let start = pos
    while (pos < line.length) {
      if (line.startsWith('<!--', pos) && closable(i, pos + 4, /^ {0,3}$/.test(line.slice(0, pos)))) {
        push(line.slice(start, pos), true)
        const end = line.indexOf('-->', pos + 4)
        if (end < 0) {
          push(line.slice(pos), false)
          inComment = true
          return out
        }
        push(line.slice(pos, end + 3), false)
        pos = start = end + 3
        continue
      }
      if (line[pos] !== '`') {
        pos++
        continue
      }
      // 백틱 n 개로 연 인라인 코드 — 같은 길이 덩어리로 닫힌다. 짝이 없으면 글자로 둔다.
      let j = pos
      while (line[j] === '`') j++
      const n = j - pos
      let close = -1
      for (let k = j; k < line.length; ) {
        if (line[k] !== '`') {
          k++
          continue
        }
        let e = k
        while (line[e] === '`') e++
        if (e - k === n) {
          close = k
          break
        }
        k = e
      }
      if (close < 0) {
        pos = j
        continue
      }
      push(line.slice(start, pos), true)
      push(line.slice(pos, close + n), false)
      pos = start = close + n
    }
    push(line.slice(start), true)
    return out
  }
}

/** 조건 꼬리표 글 — manual-vars 의 tag, 목록에 없거나 vars 를 못 받았으면 `(이름)`(PDF condTag 와 같다). */
function condTag(name: string, vars: HelpVars | null): string {
  return `*${vars?.conditions.find((c) => c.name === name)?.tag ?? `(${name})`}*`
}

/**
 * 조건 블록 `{if 이름}…{/if}` 을 화면 값으로 처리한 markdown 을 돌려준다.
 * - true: 표기만 지우고 내용을 둔다. false: 여는 표기부터 닫는 표기까지 지운다(안의 코드 펜스 포함).
 * - undefined(값을 모름): 내용을 두고 PDF 처럼 꼬리표를 단다 — 누구에게만 해당하는 절차인지 알려야 해서.
 * - 줄 단위 꼴(여닫는 줄이 그 표기만)은 PDF(applyHelpMarkupForPdf 의 neighbor·inList)와 같은 경계로 다룬다 —
 *   표기 줄은 「앞줄이 목록 문맥(항목·들여쓴 연속줄)이고 다음 줄이 목록 항목」일 때만 지우고(번호 목록 `<ol>` 이 끊기지 않게),
 *   아니면 빈 줄로 남긴다(`{/if}` 뒤 문단이 목록 항목의 연속줄로 붙거나 앞뒤 문단이 한 문단으로 이어지지 않게).
 *   꼬리표는 다음 줄이 목록 항목이면 그 항목 글 앞에, 아니면 앞뒤 빈 줄을 둔 문단으로.
 *   false 로 블록을 통째 지울 때는 블록 앞줄과 `{/if}` 다음 줄로 같은 판정을 해 지우거나 빈 줄 하나를 남긴다.
 * - 코드 펜스·인라인 코드·HTML 주석 안 표기, `$`·`\` 바로 뒤 중괄호는 건드리지 않는다.
 * 닫히지 않은 블록은 끝까지 블록으로 본다(매뉴얼 검사가 막으므로 패널은 멈추지 않기만 한다).
 */
export function applyHelpConditions(markdown: string, conditions: HelpValues['conditions'], vars: HelpVars | null): string {
  const lines = markdown.split('\n')
  const code = codeLineMask(lines)
  const segment = makeSegmenter(lines, code)
  // 열린 블록들 — 값과 여는 표기의 줄 번호·줄 단위 꼴 여부(false 블록을 닫을 때 블록 앞줄을 찾으려고).
  const stack: { value: boolean | undefined; line: number; lineForm: boolean }[] = []
  const skipping = () => stack.some((b) => b.value === false)
  const out: string[] = []
  let pendingTag: string | null = null // 다음 목록 항목 글 앞에 붙일 꼬리표

  // 줄 단위 조건 줄을 건너뛴 이웃 줄(step=1 다음, -1 앞) — 연달아 놓인 `{/if}`·`{if …}` 도 한 경계로 본다. 코드 펜스 줄이면 null.
  const neighbor = (i: number, step: 1 | -1): string | null => {
    let k = i + step
    while (k >= 0 && k < lines.length && !code[k] && LINE_COND_RE.test(lines[k])) k += step
    return k >= 0 && k < lines.length && !code[k] ? lines[k] : null
  }
  // 목록 문맥 줄인가 — 목록 항목이거나 들여쓴 연속줄(help-markup.mjs inList).
  const inList = (l: string | null) => l !== null && (LIST_ITEM_RE.test(l) || /^[ \t]+\S/.test(l))
  const isItem = (l: string | null) => l !== null && LIST_ITEM_RE.test(l)
  // 표기 줄(또는 지운 블록)을 지울지 — 앞이 목록 문맥이고 다음이 목록 항목이면 지운다. 아니면 빈 줄로 남긴다.
  const keepBlank = (prev: string | null, next: string | null) => !(inList(prev) && isItem(next))

  // 남길 줄을 내보낸다 — 기다리는 꼬리표가 있으면 목록 항목 글 앞에 끼운다.
  const emit = (line: string) => {
    if (pendingTag !== null && LIST_ITEM_RE.test(line)) {
      out.push(line.replace(LIST_ITEM_RE, `$1${pendingTag} `))
      pendingTag = null
      return
    }
    out.push(line)
  }

  lines.forEach((line, i) => {
    if (code[i]) {
      if (!skipping()) emit(line)
      return
    }
    const segs = segment(line, i)
    // 줄 단위 꼴 — 지울지 빈 줄로 남길지는 이웃 줄로 정한다(주석 안에 든 줄은 산문 조각이 없어 아래 일반 경로로 간다).
    if (segs.length === 1 && segs[0].prose && LINE_COND_RE.test(line)) {
      const open = /\{if[ \t]+(\S+)\}/.exec(line)
      if (!open) {
        const wasSkipping = skipping()
        const block = stack.pop()
        if (skipping()) return // 바깥 false 블록 안 — 통째로 지운다
        if (wasSkipping) {
          // false 블록이 여기서 끝났다 — 블록 앞줄(여는 표기가 한 줄 안 꼴이면 그 줄)과 `{/if}` 다음 줄로 판정한다.
          const prev = block?.lineForm ? neighbor(block.line, -1) : block ? lines[block.line] : null
          if (keepBlank(prev, neighbor(i, 1))) out.push('')
          return
        }
        if (keepBlank(neighbor(i, -1), neighbor(i, 1))) out.push('')
        return
      }
      const value = conditions[open[1]]
      const wasSkipping = skipping()
      stack.push({ value, line: i, lineForm: true })
      // 안쪽 블록이거나 false 로 지우기 시작한 블록 — 판정은 블록을 닫을 때 한다.
      if (wasSkipping || value === false) return
      const next = neighbor(i, 1)
      if (isItem(next)) {
        if (value === undefined) pendingTag = condTag(open[1], vars)
        if (!inList(neighbor(i, -1))) out.push('')
        return
      }
      if (value === undefined) out.push('', `${/^[ \t]*/.exec(line)?.[0] ?? ''}${condTag(open[1], vars)}`, '')
      else out.push('')
      return
    }
    // 한 줄 안 표기 — 산문 조각의 여닫는 표기만 본다. 블록 안(false)의 글은 버린다.
    const startedSkipping = skipping()
    let res = ''
    for (const seg of segs) {
      if (!seg.prose) {
        if (!skipping()) res += seg.text
        continue
      }
      let pos = 0
      for (const m of seg.text.matchAll(BRACE_RE)) {
        const prev = m.index > 0 ? seg.text[m.index - 1] : ''
        if (prev === '$' || prev === '\\') continue
        const open = /^if[ \t]+(\S+)$/.exec(m[1])
        if (!open && m[1] !== '/if') continue
        if (!skipping()) res += seg.text.slice(pos, m.index)
        if (open) {
          const value = conditions[open[1]]
          if (value === undefined && !skipping()) res += `${condTag(open[1], vars)} `
          stack.push({ value, line: i, lineForm: false })
        } else {
          stack.pop()
        }
        pos = m.index + m[0].length
      }
      if (!skipping()) res += seg.text.slice(pos)
    }
    // 처음부터 끝까지 지운 블록 안에 있던 줄은 빈 줄로도 남기지 않는다.
    if (startedSkipping && skipping() && res === '') return
    emit(res)
  })
  return out.join('\n')
}

/**
 * 텍스트 노드 값의 글자마다 원문에서 중괄호 글자로 쓰지 않았는지(`\` 탈출·문자 참조로 쓴 글자) — mdast 는 `\{`·`&#123;` 를
 * `{` 로 풀어 두므로 원문 위치로 되짚는다. PDF 는 원문 글자에서 표기를 찾아 이런 중괄호를 표기로 보지 않는다(braceTokens).
 * 원문과 값을 나란히 걸으며 문자 참조(`&amp;`·`&#123;` 등)는 값 한 글자로(글자 비교보다 먼저 — `&` 자체가 값 글자와 같아서),
 * `\`+문장부호는 값 한 글자로 보고, 줄 첫머리의 인용 표지(`>`)·들여쓰기는 값에서 빠진 글자로 건너뛴다.
 * 어긋나면(알 수 없는 변환) 탈출 없음으로 본다 — 자리표시를 바꾸는 쪽이 글자 그대로 남기는 것보다 흔한 의도다.
 */
function escapedFlags(value: string, source: string | null): boolean[] | null {
  if (source === null || source === value || !/[\\&]/.test(source)) return null
  const flags: boolean[] = new Array<boolean>(value.length).fill(false)
  let i = 0
  let j = 0
  let lineStart = false // 원문이 막 줄을 바꿨는가 — 그 뒤의 `>`·공백은 블록 표지다
  while (j < value.length && i < source.length) {
    const c = source[i]
    const entity = c === '&' ? /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/.exec(source.slice(i)) : null
    if (lineStart && (c === '>' || c === ' ' || c === '\t')) {
      i++ // 인용 표지·들여쓰기 — 값에서 빠졌다
    } else if (entity) {
      flags[j] = true // 문자 참조로 쓴 글자 — 원문 글자는 중괄호가 아니다
      i += entity[0].length
      j++
      lineStart = false
    } else if (c === '\\' && i + 1 < source.length && /[!-/:-@[-`{-~]/.test(source[i + 1]) && source[i + 1] === value[j]) {
      flags[j] = true
      i += 2
      j++
      lineStart = false
    } else if (c === value[j]) {
      lineStart = c === '\n'
      i++
      j++
    } else if (c === '\r' || c === '\n' || c === ' ' || c === '\t') {
      lineStart = c === '\n' || (lineStart && c === '\r')
      i++ // 줄 끝·들여쓰기 정리로 값에서 빠진 공백
    } else {
      return null
    }
  }
  return flags
}

/**
 * 자리표시 remark 플러그인. `remarkPlugins={[remarkHelpPlaceholders({ values, vars })]}` 로 쓴다.
 * - 텍스트·인라인 코드·코드 블록 값과 링크 주소의 `{이름}` 을 바꾼다. `$`·`\` 바로 뒤 중괄호는 건너뛴다(braceTokens).
 * - vars 가 있으면 vars.placeholders 의 이름만 — 목록 밖 `{props.title}` 은 글자 그대로(PDF·검사와 같다).
 * - 값이 없으면 `<표시 이름>`(vars 의 display, 못 받았으면 `<이름>`).
 * - vars 를 못 받았으면 산문은 자리표시 꼴이면 모두(산문의 목록 밖 이름은 검사 오류라 자리표시로 봐도 된다),
 *   코드 안은 values 에 이름이 있는 것만 바꾼다 — 코드의 `{props.title}` 같은 글자를 지키려고.
 * 값을 AST 노드 값으로 넣으므로 markdown 으로 다시 해석되지 않는다.
 */
export function remarkHelpPlaceholders(opts: { values: Record<string, string | undefined>; vars: HelpVars | null }) {
  const { values, vars } = opts
  const display = new Map(vars?.placeholders.map((p) => [p.name, p.display]) ?? [])

  // 이 이름을 바꿀지 — inCode 면 코드 안(산문보다 좁게).
  const known = (name: string, inCode: boolean) => {
    if (!PLACEHOLDER_NAME_RE.test(name)) return false
    if (vars) return display.has(name)
    return !inCode || Object.hasOwn(values, name)
  }

  // 글 하나의 자리표시를 바꾼다. escaped 는 글자별 원문 탈출·문자 참조 여부(텍스트 노드만).
  const replace = (text: string, inCode: boolean, escaped: boolean[] | null = null) => {
    if (!text.includes('{')) return text
    let out = ''
    let pos = 0
    for (const m of text.matchAll(BRACE_RE)) {
      const prev = m.index > 0 ? text[m.index - 1] : ''
      // 여닫는 중괄호 가운데 하나라도 원문에서 탈출·문자 참조로 쓴 글자면 PDF 처럼 표기가 아니다.
      if (prev === '$' || prev === '\\' || escaped?.[m.index] || escaped?.[m.index + m[0].length - 1]) continue
      if (!known(m[1], inCode)) continue
      const v = values[m[1]]
      out += text.slice(pos, m.index) + (v ?? `<${display.get(m[1]) ?? m[1]}>`)
      pos = m.index + m[0].length
    }
    return out + text.slice(pos)
  }

  return () => (tree: Root, file?: { value?: unknown }) => {
    const source = typeof file?.value === 'string' ? file.value : null
    // mdast 를 작은 재귀로 돈다(unist-util-visit 는 web 의 직접 의존성이 아니다).
    const walk = (node: Nodes) => {
      if (node.type === 'text') {
        const s = node.position?.start.offset
        const e = node.position?.end.offset
        const raw = source !== null && s !== undefined && e !== undefined ? source.slice(s, e) : null
        node.value = replace(node.value, false, escapedFlags(node.value, raw))
      } else if (node.type === 'inlineCode' || node.type === 'code') {
        node.value = replace(node.value, true)
      } else if (node.type === 'link') {
        node.url = replace(node.url, false)
      }
      if ('children' in node) node.children.forEach((c) => walk(c as Nodes))
    }
    walk(tree)
  }
}
