// 내 태스크(구독) — 공유 InfiniteIssueList 사용. /me/tasks/watched 탭과 동일 렌더.
import { InfiniteIssueList } from '../../components/issue/InfiniteIssueList'
import { useWatchedIssues } from '../../hooks/queries/useWatchedIssues'

export default function WatchedIssuesPage() {
  const query = useWatchedIssues()
  return (
    <div className="container mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">내 태스크</h1>
      <InfiniteIssueList
        query={query}
        rowTestIdPrefix="watched-row"
        emptyText="구독 중인 태스크가 없습니다."
      />
    </div>
  )
}
