import { Link } from 'react-router-dom';

import type { IssueResponse } from '../../../types/issue';
import { IssuePriorityBadge } from './IssuePriorityBadge';
import { IssueStatusBadge } from './IssueStatusBadge';

// 이슈 리스트 테이블. 빈 상태/행 클릭 시 상세로 이동.
export function IssueListTable({
  projectKey, issues,
}: { projectKey: string; issues: IssueResponse[] }) {
  if (issues.length === 0) {
    return <p className="text-muted-foreground py-8 text-center">이슈가 없습니다.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" role="table">
        <thead>
          <tr className="text-left text-muted-foreground border-b">
            <th className="py-2 w-24">#</th>
            <th>제목</th>
            <th className="w-28">상태</th>
            <th className="w-24">우선순위</th>
            <th className="w-32">마감일</th>
          </tr>
        </thead>
        <tbody>
          {issues.map(i => (
            <tr key={i.id} className="border-b hover:bg-accent" role="row">
              <td className="py-2 font-mono text-muted-foreground">{projectKey}-{i.number}</td>
              <td>
                <Link to={`/projects/${projectKey}/issues/${i.number}`} className="font-medium hover:underline">
                  {i.title}
                </Link>
              </td>
              <td><IssueStatusBadge status={i.status} /></td>
              <td><IssuePriorityBadge priority={i.priority} /></td>
              <td>{i.dueDate ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
