import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useCreatePage, useDeletePage } from '../../hooks/queries/useWikiMutations'
import { useWikiSpaces } from '../../hooks/queries/useWikiSpaces'
import { useWikiTree } from '../../hooks/queries/useWikiTree'
import type { WikiPageSummary } from '../../types/wiki'

interface TreeNode extends WikiPageSummary {
  children: TreeNode[]
}

// 평면 목록 → 트리. position 순서 유지.
function buildTree(pages: WikiPageSummary[]): TreeNode[] {
  const byId = new Map<number, TreeNode>()
  pages.forEach((p) => byId.set(p.id, { ...p, children: [] }))
  const roots: TreeNode[] = []
  byId.forEach((node) => {
    if (node.parentId != null && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })
  return roots
}

function TreeItem({
  node,
  spaceId,
  activePageId,
  onOpen,
  onDelete,
  depth,
}: {
  node: TreeNode
  spaceId: number
  activePageId: number | null
  onOpen: (id: number) => void
  onDelete: (id: number) => void
  depth: number
}) {
  const active = node.id === activePageId
  const title = node.title || '제목 없음'
  return (
    <div>
      {/* 행 단위 group — 삭제 버튼은 평소 숨겨두고 hover 시 노출(시각적으로 subtle). */}
      <div className="group relative flex items-center">
        <button
          type="button"
          onClick={() => onOpen(node.id)}
          style={{ paddingLeft: 8 + depth * 14, paddingRight: 28 }}
          className={`block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-accent ${
            active ? 'bg-accent font-medium' : ''
          }`}
        >
          {title}
        </button>
        {/* 페이지 삭제 — 평소 opacity-0, hover 시 노출. Playwright 는 hover 후 role 로 접근. */}
        <button
          type="button"
          onClick={() => onDelete(node.id)}
          aria-label={`삭제: ${title}`}
          className="absolute right-1 rounded px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        >
          ✕
        </button>
      </div>
      {node.children.map((c) => (
        <TreeItem
          key={c.id}
          node={c}
          spaceId={spaceId}
          activePageId={activePageId}
          onOpen={onOpen}
          onDelete={onDelete}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

/** 위키 2차 사이드바 — 스페이스 선택 + 페이지 트리. */
export function WikiSidebar() {
  const navigate = useNavigate()
  const { spaceId: spaceIdParam, pageId: pageIdParam } = useParams()
  const spaceId = spaceIdParam ? Number(spaceIdParam) : null
  const activePageId = pageIdParam ? Number(pageIdParam) : null

  const { data: spaces } = useWikiSpaces()
  const { data: pages } = useWikiTree(spaceId)
  const createPage = useCreatePage(spaceId ?? 0)
  const deletePage = useDeletePage(spaceId ?? 0)

  const tree = useMemo(() => buildTree(pages ?? []), [pages])

  const openPage = (id: number) => navigate(`/wiki/spaces/${spaceId}/pages/${id}`)

  const addRootPage = async () => {
    if (spaceId == null) return
    const created = await createPage.mutateAsync({ parentId: null, title: '제목 없음' })
    openPage(created.id)
  }

  // 페이지 삭제 — 확인 후 mutate. 열려 있던 페이지가 삭제되면 스페이스 루트로 이동.
  const handleDelete = async (id: number) => {
    if (spaceId == null) return
    if (!window.confirm('이 페이지를 삭제할까요? 하위 페이지도 함께 삭제됩니다.')) return
    await deletePage.mutateAsync(id)
    if (activePageId === id) navigate(`/wiki/spaces/${spaceId}`)
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/20">
      <div className="border-b p-2">
        <select
          value={spaceId ?? ''}
          onChange={(e) => navigate(`/wiki/spaces/${e.target.value}`)}
          className="w-full rounded border bg-background px-2 py-1 text-sm"
        >
          {(spaces ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase text-muted-foreground">페이지</span>
        <button
          type="button"
          onClick={addRootPage}
          className="rounded px-1.5 text-sm text-muted-foreground hover:bg-accent"
          aria-label="새 페이지"
        >
          ＋
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        {tree.map((n) => (
          <TreeItem
            key={n.id}
            node={n}
            spaceId={spaceId ?? 0}
            activePageId={activePageId}
            onOpen={openPage}
            onDelete={handleDelete}
            depth={0}
          />
        ))}
      </nav>
    </aside>
  )
}
