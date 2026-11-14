// 체크리스트 블록(WP-1546) — GFM 작업 목록 `- [ ] 할 일` / `- [x] 끝난 일` 을 taskList·taskItem 노드로 읽고 쓴다.
//
// 왜: 공용 스키마에 이 노드가 없던 때는 `[ ]` 가 글자로 남아 저장할 때 `\[ \]` 로 이스케이프됐다(MCP 로 쓴 체크리스트가 깨짐).
// tiptap-markdown 0.8.10 은 이 이름(taskList·taskItem)의 노드가 스키마에 있을 때만 markdown-it-task-lists 파싱과
// `[ ] `/`[x] ` 직렬화를 켠다 — 그래서 노드 이름을 바꾸지 않는다(내장 직렬화기·파서 설정을 이름으로 이어받는다).
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import type MarkdownIt from 'markdown-it'

/**
 * 체크리스트 목록 — tiptap TaskList 에 불릿 목록과 같은 `tight` 속성을 더한다.
 * 왜: tiptap-markdown 은 tight 를 불릿·번호 목록에만 붙이고(listTypes 고정), 작업 목록 직렬화는 불릿 직렬화기(renderList)를
 * 빌려 쓰면서 `attrs.tight` 를 본다. 속성이 없으면 늘 느슨한 목록으로 써서 `- [ ] a\n\n- [x] b` 처럼 항목 사이에 빈 줄이 생겼다.
 * 파싱 판정·렌더는 tiptap-markdown 의 불릿 목록 tight 와 같다(문단 <p> 가 없으면 촘촘한 목록).
 */
export const WikiTaskList = TaskList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tight: {
        default: true,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-tight') === 'true' || !element.querySelector('p'),
        renderHTML: (attributes: { tight?: boolean }) => ({
          class: attributes.tight ? 'tight' : null,
          'data-tight': attributes.tight ? 'true' : null,
        }),
      },
    }
  },
})

/** markdown-it 핵심 규칙 상태 — @types/markdown-it 판(13·14)마다 경로가 달라 MarkdownIt 타입에서 끌어낸다. */
type StateCore = Parameters<Parameters<MarkdownIt['core']['ruler']['after']>[2]>[0]

/** markdown-it-task-lists 가 만드는 체크 상자 — tiptap-markdown 의 taskItem updateDOM 이 checked 를 읽고 지운다. */
function checkboxHtml(checked: boolean): string {
  return `<input class="task-list-item-checkbox"${checked ? ' checked=""' : ''} disabled="" type="checkbox">`
}

/**
 * 빈 체크 항목 `- [ ] ` 을 작업 목록 항목으로 읽는 markdown-it 핵심 규칙.
 * 왜: markdown-it-task-lists 는 `[ ] ` 뒤에 글자가 있어야 작업 항목으로 본다(줄 끝 공백은 markdown-it 이 잘라 `[ ]` 만 남는다).
 * 에디터에서 비워 둔 항목은 `- [ ] ` 로 저장되므로, 이것이 없으면 다시 열 때 글자 `[ ]` 불릿이 되고 다음 저장에서 `\[ \]` 로 굳었다.
 * 판정은 마크다운 원문(token.content)으로 한다 — 이미 이스케이프돼 저장된 `- \[ \]` 는 원문이 `\[ \]` 라 글자로 남는다
 * (DOM 에서는 둘 다 글자 `[ ]` 라 구별할 수 없다). 데이터 이전은 하지 않는다.
 */
function emptyTaskItemRule(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue
    const raw = inline.content
    if (raw !== '[ ]' && raw !== '[x]' && raw !== '[X]') continue
    const box = new state.Token('html_inline', '', 0)
    box.content = checkboxHtml(raw !== '[ ]')
    inline.children = [box]
    inline.content = ''
    const item = tokens[i - 2]
    item.attrSet('class', 'task-list-item')
    // 항목을 감싼 목록 여는 토큰(한 단계 바깥) — 작업 목록 표시를 붙인다.
    for (let j = i - 3; j >= 0; j--) {
      if (tokens[j].level === item.level - 1) {
        tokens[j].attrSet('class', 'contains-task-list')
        break
      }
    }
  }
}

/**
 * 체크 항목과 일반 항목이 섞인 목록을 연속 구간별 목록으로 나눈다.
 * 왜: markdown-it-task-lists 는 체크 항목이 하나라도 있으면 목록 전체에 contains-task-list 를 붙인다(→ taskList).
 * 그 안의 일반 <li> 는 taskList 에 둘 수 없어 ProseMirror 가 빈 체크 항목을 지어내 끼웠고, 저장할 때마다 늘었다.
 * 불릿 목록 바로 뒤 체크리스트도 같은 `-` 표시로 저장돼 다시 읽으면 한 목록으로 합쳐지므로 같은 경로를 탄다.
 * 번호 목록(<ol>)의 체크 구간은 <ul> 로 바꾼다 — 체크리스트 노드는 번호를 담지 않는다(번호는 버린다, 내용·체크 상태는 지킨다).
 * 새 요소를 만들어 바꿔 끼우고 체크 구간에는 data-type 을 직접 붙인다 — taskList 의 updateDOM 이 먼저 돌았어도(순서 무관) 맞다.
 */
function splitMixedTaskLists(element: HTMLElement): void {
  for (const list of Array.from(element.querySelectorAll<HTMLElement>('.contains-task-list'))) {
    const items = Array.from(list.children).filter((c): c is HTMLElement => c.tagName === 'LI')
    const isTask = (li: HTMLElement) => li.classList.contains('task-list-item')
    if (list.tagName === 'UL' && items.every(isTask)) continue
    const doc = list.ownerDocument
    const runs: HTMLElement[] = []
    let current: HTMLElement | null = null
    // 번호 목록 일반 구간은 이어지는 번호(start)를 지킨다.
    let number = Number(list.getAttribute('start') ?? '1') || 1
    for (const li of items) {
      const task = isTask(li)
      // 체크 구간 요소에만 data-type 이 있다 — 지금 구간의 종류는 거기서 읽는다.
      if (!current || task !== current.hasAttribute('data-type')) {
        current = doc.createElement(task ? 'ul' : list.tagName.toLowerCase())
        if (task) {
          current.className = 'contains-task-list'
          current.setAttribute('data-type', 'taskList')
        } else if (list.tagName === 'OL' && number !== 1) {
          current.setAttribute('start', String(number))
        }
        runs.push(current)
      }
      current.appendChild(li)
      number++
    }
    // 촘촘함 판정 — 구간을 나눠 저장하면 구간 사이 빈 줄 때문에 다시 읽을 때 markdown-it 이 합친 목록 전체를 느슨하게(<p>) 본다.
    // 그대로 두면 저장할 때마다 촘촘↔느슨이 바뀌어 본문이 흔들리므로, 항목마다 문단이 하나뿐인 구간은 촘촘한 목록으로 둔다.
    for (const run of runs) {
      const single = Array.from(run.children).every((li) => Array.from(li.children).filter((c) => c.tagName === 'P').length <= 1)
      if (single) run.setAttribute('data-tight', 'true')
    }
    list.replaceWith(...runs)
  }
}

/** 첫 자식이 이것이면 항목에 첫 문단이 없다 — 문단(P)은 빼고 하위 목록·블록 요소만. */
const BLOCK_TAGS: ReadonlySet<string> = new Set(['UL', 'OL', 'BLOCKQUOTE', 'PRE', 'DIV', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR'])

/**
 * 내용 없는 항목 앞에 빈 문단을 넣는다.
 * 왜: 촘촘한 목록의 빈 항목(`- [ ] ` 아래 하위 목록)은 상자를 지우면 <li> 에 하위 <ul> 만 남는다. taskItem 은 `paragraph block*` 라
 * ProseMirror 가 하위 목록을 항목 밖으로 끌어내 중첩이 풀리고 목록이 셋으로 쪼개졌다(저장할 때마다 빈 줄도 늘었다).
 */
function ensureLeadingParagraph(item: HTMLElement): void {
  // 공백 글자를 건너뛴 첫 자식 — 글자·인라인 요소·문단이 먼저면(또는 비었으면) 첫 문단이 이미 생긴다.
  const first = Array.from(item.childNodes).find((n) => !(n.nodeType === 3 && !n.textContent?.trim()))
  if (!first || first.nodeType !== 1 || !BLOCK_TAGS.has((first as HTMLElement).tagName)) return
  // 넣을 <p> 가 촘촘함 판정(<p> 가 없으면 촘촘)을 뒤집지 않게, 넣기 전 판정을 바깥 목록들에 먼저 적어 둔다.
  for (let el = item.parentElement; el; el = el.parentElement) {
    if ((el.tagName === 'UL' || el.tagName === 'OL') && !el.hasAttribute('data-tight') && !el.querySelector('p')) {
      el.setAttribute('data-tight', 'true')
    }
  }
  item.prepend(item.ownerDocument.createElement('p'))
}

/**
 * 체크리스트 항목 — nested: GFM 도 들여쓴 하위 작업 목록을 표현하므로 하위 체크리스트를 허용한다.
 * 마크다운 파싱만 바꾼다(직렬화 `[ ] `/`[x] ` 는 tiptap-markdown 기본을 이어받는다 — getMarkdownSpec 이 얕게 덮어쓴다).
 * parse 를 바꾸면 tiptap-markdown 기본 taskItem updateDOM 이 빠지므로 그 일(data-type·data-checked 붙이고 상자 지우기)도 여기서 한다.
 * TaskList 의 parse 는 건드리지 않는다 — 거기서 markdown-it-task-lists 를 등록한다(덮으면 등록이 빠진다).
 */
export const WikiTaskItem = TaskItem.extend({
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.core.ruler.after('inline', 'wiki-empty-task-item', emptyTaskItemRule)
          },
          updateDOM(element: HTMLElement) {
            splitMixedTaskLists(element)
            for (const item of Array.from(element.querySelectorAll<HTMLElement>('.task-list-item'))) {
              const input = item.querySelector('input')
              item.setAttribute('data-type', 'taskItem')
              if (input) {
                item.setAttribute('data-checked', String(input.checked))
                input.remove()
              }
              ensureLeadingParagraph(item)
            }
          },
        },
      },
    }
  },
}).configure({ nested: true })
