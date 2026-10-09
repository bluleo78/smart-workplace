import { markdownToDoc } from '@smart-workplace/wiki-editor-schema'
import { Extension } from '@tiptap/core'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { DecorationSet } from '@tiptap/pm/view'

import { buildRevisionDiff, type RevisionDiffMark, toSchema } from './wikiRevisionDiff'

/**
 * 버전 기록 미리보기(WP-298)가 그릴 문서와 차이 표시를 고른다.
 * 리비전 본문(마크다운)은 공용 markdownToDoc 스키마로 읽히고, 비교 대상은 마크다운(다음 판)이거나 라이브 에디터 문서다.
 * 결과 doc 은 미리보기 에디터의 schema 로 옮겨 준다 — 스키마 인스턴스가 다르면 setContent·데코레이션이 섞인 노드를 받는다.
 * 옮겨도 노드 구조가 같아 marks 좌표는 그대로 쓸 수 있다.
 *
 * - showDiff 가 꺼졌거나 비교 대상이 없으면: 보는 판 그대로, 표시 없음.
 * - 켜졌으면: buildRevisionDiff(보는 판, 비교 대상) 결과(보는 판 구조 + 다음 판에만 있는 블록)와 그 표시.
 */
export function revisionPreviewDoc(
  schema: Schema,
  body: string,
  compareTo: PMNode | string | null,
  showDiff: boolean,
): { doc: PMNode; marks: RevisionDiffMark[] } {
  const from = markdownToDoc(body)
  return previewDocOf(schema, from, showDiff ? revisionDiffOf(from, compareTo) : null)
}

/** 보는 판(파싱된 from)과 비교 대상의 차이 — 비교 대상이 없으면 null. 미리보기가 변경 표시 토글과 따로 메모해 둔다. */
export function revisionDiffOf(from: PMNode, compareTo: PMNode | string | null): RevisionDiff | null {
  if (compareTo == null) return null
  return buildRevisionDiff(from, typeof compareTo === 'string' ? markdownToDoc(compareTo) : compareTo)
}

/** 그릴 문서와 표시 — 차이(diff)가 있으면 그 결과, 없으면 보는 판 그대로(표시 없음). 미리보기 에디터 스키마로 옮긴다. */
export function previewDocOf(schema: Schema, from: PMNode, diff: RevisionDiff | null): RevisionDiff {
  return diff ? { doc: toSchema(schema, diff.doc), marks: diff.marks } : { doc: toSchema(schema, from), marks: [] }
}

/** 미리보기 문서 + 그 좌표의 차이 표시. */
type RevisionDiff = { doc: PMNode; marks: RevisionDiffMark[] }

/** 차이 표시 데코레이션 상태 키 — 미리보기 컴포넌트가 setMeta 로 새 DecorationSet 을 넣는다. */
export const wikiRevisionDiffKey = new PluginKey<DecorationSet>('wikiRevisionDiff')

/**
 * 미리보기 전용 차이 표시 확장 — 문서 스키마는 건드리지 않고 데코레이션만 그린다(WIKI_SCHEMA_VERSION 무관).
 * 메타로 받은 DecorationSet 을 그대로 쓰고, 그 밖의 트랜잭션에는 매핑만 한다(읽기 전용이라 사실상 바뀌지 않는다).
 * 노트 에디터(wikiEditorExtensions)에는 넣지 않는다 — 미리보기에서만 쓴다.
 */
export const WikiRevisionDiffHighlight = Extension.create({
  name: 'wikiRevisionDiff',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: wikiRevisionDiffKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => (tr.getMeta(wikiRevisionDiffKey) as DecorationSet | undefined) ?? old.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => wikiRevisionDiffKey.getState(state) },
      }),
    ]
  },
})
