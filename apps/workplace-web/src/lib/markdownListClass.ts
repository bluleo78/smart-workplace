// markdown 목록 클래스 — 채팅 MarkdownMessage 와 도움말 HelpMarkdown 이 같은 글머리표·들여쓰기를 쓰도록 한곳에 둔다(WP-1505).

/**
 * 목록(ul·ol) 클래스 — GFM 체크리스트(contains-task-list)면 글머리표 없이 얕게, 아니면 지정한 글머리표 스타일과 들여쓰기.
 * @param className react-markdown 이 넘긴 목록 class(remark-gfm 이 체크리스트에 contains-task-list 를 단다)
 * @param marker 글머리표 클래스(list-disc·list-decimal)
 */
export function markdownListClass(className: string | undefined, marker: string): string {
  return className?.includes('contains-task-list') ? 'list-none space-y-0.5 pl-1' : `${marker} space-y-0.5 pl-5`
}
