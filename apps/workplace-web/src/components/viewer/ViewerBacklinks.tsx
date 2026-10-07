import { useFileBacklinks } from '../../hooks/queries/useFileBacklinks'

/** "참조된 곳" — 사이드 패널과 ✨ 불가 시의 하단 띠가 함께 쓴다. 이 파일을 링크한 이슈·메시지 목록. 비어 있으면 섹션 자체를 숨긴다. */
export function ViewerBacklinks({ driveFileId }: { driveFileId: number }) {
  const backlinks = useFileBacklinks(driveFileId)
  if ((backlinks.data?.length ?? 0) === 0) return null
  return (
    <div data-testid="file-backlinks">
      <p className="mb-1 text-xs font-medium text-muted-foreground">참조된 곳</p>
      <ul className="space-y-1">
        {backlinks.data!.map((b) => (
          <li key={`${b.sourceType}-${b.sourceId}`} data-testid={`file-backlink-${b.sourceType}-${b.sourceId}`}>
            <a href={b.deepLink} className="text-sm text-primary hover:underline">
              {b.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
