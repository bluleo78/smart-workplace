// 마크다운 서식 넣기(WP-2092) — 지시문 입력칸(textarea)의 선택 영역에 서식 기호를 넣는 순수 함수.
// 서식 툴바가 DOM 없이 같은 규칙으로 동작하고 테스트되도록 문자열·선택 위치만 다룬다.

export type MarkdownFormatKind = 'bold' | 'italic' | 'h3' | 'bullet' | 'ordered' | 'table' | 'code'

/** 서식을 넣은 뒤의 전체 텍스트와 다시 잡아줄 선택 범위 */
export interface FormatResult {
  value: string
  selStart: number
  selEnd: number
}

/** 표 뼈대 — 항목/내용 2열, 본문 빈 행 1개 */
const TABLE_HEADER = '| 항목 | 내용 |'
const TABLE_SEPARATOR = '| --- | --- |'
const TABLE_ROW = '|  |  |'

/** pos 가 놓인 줄의 시작 위치. pos 가 0 이면 lastIndexOf 의 음수 시작값이 0 으로 보정되는 문제를 피한다 */
function lineStartOf(value: string, pos: number): number {
  return pos === 0 ? 0 : value.lastIndexOf('\n', pos - 1) + 1
}

/** 선택 위치를 0..length 로 자르고 start <= end 가 되게 정리한다(범위 밖 입력에도 예외 없음) */
function normalizeSelection(length: number, selStart: number, selEnd: number): [number, number] {
  const clamp = (n: number) => Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), length)
  const a = clamp(selStart)
  const b = clamp(selEnd)
  return a <= b ? [a, b] : [b, a]
}

/** 선택을 marker 로 감싼다. 선택은 안쪽 글자에 유지(선택 없으면 표시 사이에 커서) */
function wrap(value: string, start: number, end: number, open: string, close: string): FormatResult {
  return {
    value: value.slice(0, start) + open + value.slice(start, end) + close + value.slice(end),
    selStart: start + open.length,
    selEnd: end + open.length,
  }
}

/** 줄 머리 기호 종류별 판별 정규식(이미 붙어 있는지 확인·제거용)과 붙일 기호 */
const LINE_KINDS = {
  // 다른 수준(#·##·####…) 제목은 기호를 더 붙이지 않고 ### 로 바꾼다(`### ## 절차` 방지) — 바꿀 때 기존 제목 기호를 뗀다
  h3: { has: /^### /, prefix: () => '### ', replaces: /^#{1,6} / },
  bullet: { has: /^- /, prefix: () => '- ', replaces: null },
  // 번호는 어떤 숫자든 "숫자. " 로 인식해 뺀다
  ordered: { has: /^\d+\. /, prefix: (n: number) => `${n}. `, replaces: null },
} as const

/**
 * 선택이 걸친 줄 전체에 머리 기호를 붙이거나(토글) 뺀다.
 * 대상 줄이 모두 이미 그 기호로 시작하면 빼고, 아니면 기호 없는 줄에 붙인다 — 빈 줄은 (여러 줄일 때) 건너뛴다.
 * 선택이 다음 줄 맨 앞에서 끝나면 그 줄은 포함하지 않는다. 결과 선택은 바뀐 줄 전체(첫 줄 시작~마지막 줄 끝).
 */
function applyLineKind(value: string, start: number, end: number, kind: keyof typeof LINE_KINDS): FormatResult {
  const effEnd = end > start && value[end - 1] === '\n' ? end - 1 : end
  const blockStart = lineStartOf(value, start)
  const nl = value.indexOf('\n', effEnd)
  const blockEnd = nl === -1 ? value.length : nl
  const lines = value.slice(blockStart, blockEnd).split('\n')

  // 빈 줄만 있는 경우(빈 입력 등)에는 그 줄에 그대로 적용한다
  const nonEmpty = lines.filter((l) => l !== '')
  const targets = nonEmpty.length > 0 ? nonEmpty : lines
  const { has, prefix, replaces } = LINE_KINDS[kind]
  const remove = targets.every((l) => has.test(l))

  let n = 0
  const next = lines
    .map((line) => {
      if (line === '' && nonEmpty.length > 0) return line
      if (remove) return line.replace(has, '')
      // 섞인 선택 — 이미 그 기호가 있는 줄은 그대로(기호를 또 붙이지 않는다)
      if (has.test(line)) return line
      // 번호는 새로 붙이는 줄만 1. 부터 센다(이미 번호 있는 줄은 다시 매기지 않음)
      n += 1
      return prefix(n) + (replaces ? line.replace(replaces, '') : line)
    })
    .join('\n')

  return {
    value: value.slice(0, blockStart) + next + value.slice(blockEnd),
    selStart: blockStart,
    selEnd: blockStart + next.length,
  }
}

/** 현재 줄(선택 끝이 있는 줄) 끝 뒤에 표 뼈대를 넣는다. 줄에 글이 있으면 빈 줄 하나를 사이에 두고, 커서는 첫 빈 칸 */
function insertTable(value: string, end: number): FormatResult {
  const lineStart = lineStartOf(value, end)
  const nl = value.indexOf('\n', end)
  const lineEnd = nl === -1 ? value.length : nl
  // 빈 줄 커서라도 바로 앞 줄에 글이 있으면 표가 문단에 붙지 않게 빈 줄을 하나 더 둔다
  const prevLine = lineStart > 0 ? value.slice(lineStartOf(value, lineStart - 1), lineStart - 1) : ''
  const gap = lineEnd > lineStart ? '\n\n' : prevLine !== '' ? '\n' : ''
  const skeleton = `${TABLE_HEADER}\n${TABLE_SEPARATOR}\n${TABLE_ROW}\n`
  const cursor = lineEnd + gap.length + TABLE_HEADER.length + 1 + TABLE_SEPARATOR.length + 1 + 2
  return {
    value: value.slice(0, lineEnd) + gap + skeleton + value.slice(lineEnd),
    selStart: cursor,
    selEnd: cursor,
  }
}

/** 선택 영역(selStart~selEnd)에 kind 서식을 넣은 새 텍스트와 선택 범위를 돌려준다 */
export function applyMarkdownFormat(value: string, selStart: number, selEnd: number, kind: MarkdownFormatKind): FormatResult {
  const [start, end] = normalizeSelection(value.length, selStart, selEnd)
  switch (kind) {
    case 'bold':
      return wrap(value, start, end, '**', '**')
    case 'italic':
      return wrap(value, start, end, '*', '*')
    case 'code':
      // 여러 줄 선택은 코드 블록(펜스)으로, 한 줄·없음은 인라인 백틱으로
      if (!value.slice(start, end).includes('\n')) return wrap(value, start, end, '`', '`')
      // 펜스는 줄 맨 앞에 있어야 코드 블록이 된다 — 선택이 줄 중간에서 시작·끝나면 앞·뒤에 줄바꿈을 더한다
      return wrap(
        value,
        start,
        end,
        (start > 0 && value[start - 1] !== '\n' ? '\n' : '') + '```\n',
        '\n```' + (end < value.length && value[end] !== '\n' ? '\n' : ''),
      )
    case 'table':
      return insertTable(value, end)
    default:
      return applyLineKind(value, start, end, kind)
  }
}
