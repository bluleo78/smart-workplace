export const wikiKeys = {
  all: ['wiki'] as const,
  spaces: () => ['wiki', 'spaces'] as const,
  tree: (spaceId: number) => ['wiki', 'tree', spaceId] as const,
  page: (pageId: number) => ['wiki', 'page', pageId] as const,
  members: (spaceId: number) => ['wiki', 'members', spaceId] as const,
  mentions: (pageId: number) => ['wiki', 'mentions', pageId] as const,
  backlinks: (pageId: number) => ['wiki', 'backlinks', pageId] as const,
}
