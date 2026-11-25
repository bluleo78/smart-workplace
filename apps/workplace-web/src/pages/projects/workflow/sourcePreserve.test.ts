import { describe, expect, it } from 'vitest'
import { parse, parseDocument } from 'yaml'

import { mergeEditedSource } from './sourcePreserve'
import { SPEC } from './specFixture'

describe('sourcePreserve', () => {
  it('sourcePreserve_편집없는문서는글자그대로', () => {
    const out = mergeEditedSource(SPEC, parseDocument(SPEC), parseDocument(SPEC))
    expect(out).toBe(SPEC)
  })

  it('sourcePreserve_한항목만바뀌어도나머지는원문', () => {
    const before = parseDocument(SPEC)
    const after = parseDocument(SPEC)
    after.setIn(['layout', 'triage'], after.createNode({ x: 260, y: 40 }))
    const out = mergeEditedSource(SPEC, before, after)
    expect(out).not.toBeNull()
    expect(out!.replace('layout: { triage: { x: 260, y: 40 } }', 'layout: { triage: { x: 200, y: 0 } }')).toBe(SPEC)
  })

  it('sourcePreserve_범위밖_머리꼬리주석이살아있다', () => {
    // 머리 주석·끝 주석은 before.contents.range 밖에 있다 — 범위 밖 글자가 편집과 함께 지워지면 안 된다.
    const src = '# 초안 머리 주석\nschema: genia/workflow@1\nnodes:\n  start:\n    type: start\n# 맨 끝 주석\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    after.setIn(['nodes', 'start', 'name'], '시작')
    const out = mergeEditedSource(src, before, after)
    expect(out).not.toBeNull()
    expect(out!.startsWith('# 초안 머리 주석\n')).toBe(true)
    expect(out!.endsWith('# 맨 끝 주석\n')).toBe(true)
    expect(out).toContain('name: 시작')
  })

  // WP-2040 Task 5 — 안전망: 파싱 오류 문서는 병합하지 않고 null(호출자가 정규화 출력으로 대체)
  it('sourcePreserve_파싱오류입력은그대로', () => {
    expect(mergeEditedSource('a: [', parseDocument('a: ['), parseDocument('a: ['))).toBeNull()
  })

  // WP-2040 Task 5 — 병합 불가(null) 경로: 빈 문서는 병합 범위(contents.range)가 없다
  // 호출자가 dump 로 대체하는지는 graphYaml 쪽 실제 편집 함수 테스트에서 검증한다
  it('sourcePreserve_병합불가면정규화출력으로대체', () => {
    const edited = parseDocument('')
    edited.set('a', 1)
    expect(mergeEditedSource('', parseDocument(''), edited)).toBeNull()
  })

  // WP-2040 Task 5 — 리뷰 포커스 1: 병합이 값을 잃지 않는다
  // 유일한 노드를 지우면 after 는 `nodes: {}` 인데, 원문 범위를 그대로 자르면 `nodes:`(값 null)로 읽힌다 —
  // 재파싱 + 깊이 비교가 없으면 값이 조용히 사라진 채 바깥으로 나간다.
  it('sourcePreserve_병합결과값유실은검증에서걸린다', () => {
    const src = 'nodes:\n  a: { type: end }\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    after.deleteIn(['nodes', 'a'])
    expect(after.toJS()).toEqual({ nodes: {} })
    const out = mergeEditedSource(src, before, after)
    // 병합이 null 이 아니면 반드시 after 와 깊이 같아야 한다 — 이 자리는 재파싱·깊이 비교가
    // 없으면 `nodes:` (값 null)로 읽히는 병합이 검증 없이 새어 나가는 자리다(오늘은 null 로 거부)
    if (out !== null) expect(parse(out)).toEqual(after.toJS())
    expect(out).toBeNull()
  })

  // WP-2040 리뷰 반려 1 — 블록 스칼라(`|`) 본문은 값 시작 열이 아니라 키 줄 들여쓰기 아래 한 단계로 쓴다
  // (값 시작 열로 쓰면 `instructions: |` 본문이 18칸으로 밀려 옛 dump 와 달라졌다)
  it('sourcePreserve_지시문블록본문은키들여쓰기다음칸에쓴다', () => {
    const src = 'schema: genia/workflow@1\nnodes:\n  a:\n    type: task\n    instructions: |\n      안내 한 줄\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    after.setIn(['nodes', 'a', 'instructions'], '바뀐 줄1\n바뀐 줄2\n')
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nnodes:\n  a:\n    type: task\n    instructions: |\n      바뀐 줄1\n      바뀐 줄2\n')
  })

  // WP-2040 리뷰 반려 1 — 목록 항목 한 줄(`- |`)도 같은 규칙(줄 들여쓰기 아래 한 단계)
  it('sourcePreserve_목록항목블록본문은대시아래한칸에쓴다', () => {
    const src = 'steps:\n  - |\n    안내\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    after.setIn(['steps', 0], '바뀐 안내\n')
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('steps:\n  - |\n    바뀐 안내\n')
  })

  // WP-2040 리뷰 반려 2 — CRLF 원문에서 여러 줄 값을 바꾸면 새 줄도 CRLF 로 — 섞이면 diff 가 줄 전체로 흔들린다
  it('sourcePreserve_CRLF원문의새줄은개행이섞이지않는다', () => {
    const src = 'schema: genia/workflow@1\r\nnodes:\r\n  a:\r\n    type: task\r\n    instructions: |\r\n      안내 한 줄\r\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    after.setIn(['nodes', 'a', 'instructions'], '바뀐 줄1\n바뀐 줄2\n')
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\r\nnodes:\r\n  a:\r\n    type: task\r\n    instructions: |\r\n      바뀐 줄1\r\n      바뀐 줄2\r\n')
    expect(out).not.toMatch(/[^\r]\n/)
  })

  // WP-2040 리뷰 반려 3 — 항목과 다음 노드 사이의 빈 줄로 떨어진 구역 주석은 다음 노드의 것이다
  // (앞 항목 꼬리로 잡히면 앞 노드를 지울 때 주석이 함께 사라진다)
  it('sourcePreserve_구역주석은다음노드것이라앞노드를지워도남는다', () => {
    const src = 'schema: genia/workflow@1\nnodes:\n  a: { type: start }\n  # 구역 주석\n\n  b: { type: end }\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    after.deleteIn(['nodes', 'a'])
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nnodes:\n  # 구역 주석\n\n  b: { type: end }\n')
    expect(parse(out!)).toEqual({ schema: 'genia/workflow@1', nodes: { b: { type: 'end' } } })
  })

  // WP-2040 리뷰 반려 4 — 여러 줄 흐름 맵에서 마지막 항목을 지우면 줄 끝 쉼표가 남지 않는다
  it('sourcePreserve_여러줄흐름맵의끝쉼표를걷는다', () => {
    const src = 'schema: genia/workflow@1\nlayout: {\n  a: { x: 0, y: 0 },\n  b: { x: 1, y: 1 },\n}\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    after.deleteIn(['layout', 'b'])
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nlayout: {\n  a: { x: 0, y: 0 }\n}\n')
    expect(parse(out!)).toEqual({ schema: 'genia/workflow@1', layout: { a: { x: 0, y: 0 } } })
  })

  // WP-2040 리뷰 반려 4 — 여러 줄 흐름 맵에 항목을 더해도 원문 항목 줄이 그대로고(전체 재직렬화로 떨어지지 않고)
  // 새 항목만 한 줄씩 이어 붙인다
  it('sourcePreserve_여러줄흐름맵에항목을더해도원문모양이남는다', () => {
    const src = 'schema: genia/workflow@1\nlayout: {\n  a: { x: 0, y: 0 },\n  b: { x: 1, y: 1 },\n}\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    after.setIn(['layout', 'c'], { x: 2, y: 2 })
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nlayout: {\n  a: { x: 0, y: 0 },\n  b: { x: 1, y: 1 },\n  c: { x: 2, y: 2 }\n}\n')
    expect(parse(out!).layout.c).toEqual({ x: 2, y: 2 })
  })

  // WP-2040 6번 리뷰 Important 1 — 마지막 항목 줄 끝 주석 뒤에 쉼표를 붙이면 주석 글자가 바뀐다
  it('sourcePreserve_흐름맵줄끝주석에쉼표를붙이지않는다', () => {
    const src = 'schema: genia/workflow@1\nlayout: {\n  a: { x: 0, y: 0 },\n  b: { x: 1, y: 1 },  # 마지막 항목\n}\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    after.setIn(['layout', 'c'], { x: 2, y: 2 })
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nlayout: {\n  a: { x: 0, y: 0 },\n  b: { x: 1, y: 1 },  # 마지막 항목\n  c: { x: 2, y: 2 }\n}\n')
    expect(parse(out!).layout.c).toEqual({ x: 2, y: 2 })
  })

  // WP-2040 6번 리뷰 Important 1 — 쉼표 없는 줄 끝 주석 앞에 쉼표를 넣는다(주석에 붙이거나 파싱을 깨지 않고)
  it('sourcePreserve_흐름맵끝쉼표없는줄끝주석앞에쉼표를넣는다', () => {
    const src = 'schema: genia/workflow@1\nlayout: {\n  a: { x: 0, y: 0 },\n  b: { x: 1, y: 1 }  # 마지막 항목\n}\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    after.setIn(['layout', 'c'], { x: 2, y: 2 })
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nlayout: {\n  a: { x: 0, y: 0 },\n  b: { x: 1, y: 1 },  # 마지막 항목\n  c: { x: 2, y: 2 }\n}\n')
    expect(parse(out!).layout.c).toEqual({ x: 2, y: 2 })
  })

  // WP-2040 6번 리뷰 Important 2 — 마지막 항목 위 빈 줄이 항목 범위에 포함돼도 새 항목 칸은 키 칸을 쓴다
  // (빈 줄 위치(0칸)로 칸을 세면 새 항목이 들여쓰기를 잃어 병합이 정규화 dump 로 떨어진다)
  it('sourcePreserve_흐름맵마지막항목위빈줄에도새항목칸을지킨다', () => {
    const src = 'schema: genia/workflow@1\nlayout: {\n  a: { x: 0, y: 0 },\n\n  b: { x: 1, y: 1 },\n}\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    after.setIn(['layout', 'c'], { x: 2, y: 2 })
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nlayout: {\n  a: { x: 0, y: 0 },\n\n  b: { x: 1, y: 1 },\n  c: { x: 2, y: 2 }\n}\n')
    expect(parse(out!).layout.c).toEqual({ x: 2, y: 2 })
  })

  // WP-2040 6번 리뷰 Minor 3 — 빈 흐름 맵에 항목을 넣어도 `}` 는 원래 줄바꿈·들여쓰기 자리에 남는다
  it('sourcePreserve_빈흐름맵에항목을넣어도닫는괄호칸이바뀌지않는다', () => {
    const src = 'schema: genia/workflow@1\nlayout: {\n  }\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    after.setIn(['layout', 'c'], { x: 2, y: 2 })
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nlayout: {\n  c: { x: 2, y: 2 }\n  }\n')
    expect(parse(out!).layout.c).toEqual({ x: 2, y: 2 })
  })

  // WP-2040 재반려 finding 1 — 바꿈과 지움이 섞이면 지운 항목의 주석이 남고 살아남은 항목의 주석이 사라졌다
  // (지운 항목 자리에 바뀐 항목을 앉히면 주석이 항목과 어긋나 읽는 사람이 헷갈린다)
  it('sourcePreserve_목록에서바꾼항목은자기주석을지운항목은주석을버린다', () => {
    const src = 'requires:\n  - one   # 첫째\n  - two   # 둘째\n  - three # 셋째\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    const seq = after.getIn(['requires'], true) as { items: { value: unknown }[] }
    seq.items.splice(1, 1) // two 지움
    seq.items[1].value = 'three_x' // three 값만 바꿈 — 바꿈과 지움이 섞인 자리
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('requires:\n  - one   # 첫째\n  - three_x # 셋째\n')
    expect(out).not.toContain('# 둘째') // 지운 항목의 주석은 따라오지 않는다
    expect(parse(out!)).toEqual({ requires: ['one', 'three_x'] })
  })

  // WP-2040 재반려 finding 2 — 앞 노드보다 깊이 들여쓴 주석은 앞 노드 몸통이다
  // 뒷 노드에 딸려 있으면 뒷 노드를 지울 때 함께 사라진다
  it('sourcePreserve_깊은들여쓰기주석은뒷노드를지워도남는다', () => {
    const src = 'schema: genia/workflow@1\nnodes:\n  a:\n    type: agent_task\n    # 앞 노드 몸통 주석\n  b: { type: end }\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    after.deleteIn(['nodes', 'b'])
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nnodes:\n  a:\n    type: agent_task\n    # 앞 노드 몸통 주석\n')
    expect(parse(out!)).toEqual({ schema: 'genia/workflow@1', nodes: { a: { type: 'agent_task' } } })
  })

  // WP-2040 재반려 finding 2 — 같은 주석은 앞 노드를 지울 때 함께 사라진다(뒷 노드 위에 고아로 남지 않는다)
  it('sourcePreserve_깊은들여쓰기주석은앞노드를지우면함께사라진다', () => {
    const src = 'schema: genia/workflow@1\nnodes:\n  a:\n    type: agent_task\n    # 앞 노드 몸통 주석\n  b: { type: end }\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    after.deleteIn(['nodes', 'a'])
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nnodes:\n  b: { type: end }\n')
    expect(parse(out!)).toEqual({ schema: 'genia/workflow@1', nodes: { b: { type: 'end' } } })
  })

  // WP-2040 재반려 finding 4 — 키 순서만 바꾼 편집이 버려지지 않는다(순서 비교가 성립하는 자리 한정)
  it('sourcePreserve_키순서만바꾼편집이원문에반영된다', () => {
    const src = 'schema: genia/workflow@1\nnodes:\n  a: { type: end }\n  b: { type: end }\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    const nodes = after.getIn(['nodes'], true) as { items: unknown[] }
    nodes.items.reverse()
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nnodes:\n  b: { type: end }\n  a: { type: end }\n')
    expect(Object.keys(parse(out!).nodes)).toEqual(['b', 'a'])
  })

  // WP-2040 팀장 재반려 Important 2 — 한 줄 흐름 맵에서 마지막 항목(쉼표 없는 자리)을 앞으로 옮기면
  // 그 뒤 조각과 사이에 쉼표를 끼운다(없으면 `} b:` 처럼 붙어 파싱이 깨지고 전문이 정규화 dump 로 떨어진다)
  it('sourcePreserve_한줄흐름맵을뒤집어도항목사이에쉼표가있다', () => {
    const src = 'schema: genia/workflow@1\nlayout: { a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, c: { x: 2, y: 2 } }\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    const layout = after.getIn(['layout'], true) as { items: unknown[] }
    layout.items.reverse()
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nlayout: { c: { x: 2, y: 2 }, b: { x: 1, y: 1 }, a: { x: 0, y: 0 } }\n')
    expect(Object.keys(parse(out!).layout)).toEqual(['c', 'b', 'a'])
  })

  // WP-2040 팀장 재반려 Important 2 — 마지막 항목을 가운데로만 옮겨도(뒤에 한 항목이 더 잇는 자리) 같은 쉼표 처리
  it('sourcePreserve_한줄흐름맵의마지막항목을가운데로옮겨도쉼표가끊기지않는다', () => {
    const src = 'schema: genia/workflow@1\nlayout: { a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, c: { x: 2, y: 2 } }\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    const layout = after.getIn(['layout'], true) as { items: unknown[] }
    const [a, b, c] = layout.items
    layout.items = [a, c, b] // 마지막 b 를 가운데로
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nlayout: { a: { x: 0, y: 0 }, c: { x: 2, y: 2 }, b: { x: 1, y: 1 } }\n')
    expect(Object.keys(parse(out!).layout)).toEqual(['a', 'c', 'b'])
  })

  // WP-2040 팀장 재반려 Important 2 — 재배치와 값 수정이 섞여도 쉼표와 수정값이 모두 남는다
  it('sourcePreserve_한줄흐름맵을뒤집으면서값도고치면둘다남는다', () => {
    const src = 'schema: genia/workflow@1\nlayout: { a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, c: { x: 2, y: 2 } }\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    const layout = after.getIn(['layout'], true) as { items: unknown[] }
    layout.items.reverse()
    after.setIn(['layout', 'a', 'x'], 9) // 뒤집은 뒤 a 가 맨 뒤 — 값도 바꾼다
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nlayout: { c: { x: 2, y: 2 }, b: { x: 1, y: 1 }, a: { x: 9, y: 0 } }\n')
    expect(parse(out!).layout.a.x).toBe(9)
  })

  // WP-2040 팀장 재반려 Important 3 — 깊은 들여쓰기 머리 주석(컨테이너 몸통)은 첫 항목을 지워도 남는다
  it('sourcePreserve_깊은머리주석은첫항목을지워도남는다', () => {
    const src = 'requires:\n      # 머리 주석\n  - one   # 첫째\n  - two   # 둘째\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    const seq = after.getIn(['requires'], true) as { items: unknown[] }
    seq.items.splice(0, 1)
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('requires:\n      # 머리 주석\n  - two   # 둘째\n')
    expect(parse(out!)).toEqual({ requires: ['two'] })
  })

  // WP-2040 팀장 재반려 Minor 8 — CRLF 원문에서 목록을 비우면 개행이 섞이지 않고 빈 목록이 남는다
  it('sourcePreserve_CRLF에서빈목록을지워도개행이섞이지않는다', () => {
    const src =
      'schema: genia/workflow@1\r\nnodes:\r\n  a:\r\n    type: decision\r\n    start: []\r\n  b: { type: end }\r\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    const start = after.getIn(['nodes', 'a', 'start'], true) as { items: unknown[] }
    start.items.splice(0, 1)
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\r\nnodes:\r\n  a:\r\n    type: decision\r\n    start: []\r\n  b: { type: end }\r\n')
    expect(/(?<!\r)\n/.test(out!)).toBe(false) // bare LF 로 갈라진 줄이 없다
    expect(parse(out!)).toEqual({ schema: 'genia/workflow@1', nodes: { a: { type: 'decision', start: [] }, b: { type: 'end' } } })
  })

  // WP-2040 팀장 재반려 Minor 7 — 끝 개행이 없는 파일에서 키 줄 주석은 키 줄에 남는다
  // (줄 끝을 못 찾으면 그대로 두어 마지막 항목 줄 뒤에 붙어 없던 자리에 왔다)
  it('sourcePreserve_끝개행없는키줄주석은키줄에남는다', () => {
    const src = 'schema: genia/workflow@1\nnodes: {} # 보관'
    const before = parseDocument(src)
    const after = parseDocument('schema: genia/workflow@1\nnodes:\n  a:\n    type: agent_task\n    name: 새 작업\n')
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('schema: genia/workflow@1\nnodes: # 보관\n  a:\n    type: agent_task\n    name: 새 작업')
    expect(parse(out!)).toEqual({
      schema: 'genia/workflow@1',
      nodes: { a: { type: 'agent_task', name: '새 작업' } },
    })
  })

  // WP-2040 팀장 재반려 Minor 4 — 줄 중간에 쓴 중첩 목록(`- - a`)을 비워도 그 자리에 `[]` 이 남는다
  // (이 분기는 도달한다 — 흐름 목록뿐 아니라 중첩 목록 값도 값 시작이 줄머리가 아니다)
  it('sourcePreserve_줄중간의중첩목록을비워도빈칸이남지않는다', () => {
    const src = 'x:\n  - - a\n  - - b\n'
    const before = parseDocument(src)
    const after = parseDocument(src)
    const outer = after.getIn(['x'], true) as { items: { items: unknown[] }[] }
    outer.items[0].items.splice(0, 1)
    const out = mergeEditedSource(src, before, after)
    expect(out).toBe('x:\n  - []\n  - - b\n')
    expect(parse(out!)).toEqual({ x: [[], ['b']] })
  })
})
