// 본문 하단 탭 — 코멘트(기록)와 활동(변경 이력)을 분리.
// 무엇을: shadcn Tabs 로 [💬 코멘트|📜 활동] 전환, 기본 코멘트.
// 왜: 활동 로그를 사이드바에서 본문 탭으로 이동(업계 표준), 속성 접근 방해 제거(#343).

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import type { IssueCommentResponse, IssueHistoryEntry } from '../../../types/issue';
import { IssueActivityTimeline } from './IssueActivityTimeline';
import { IssueCommentList } from './IssueCommentList';

export function IssueBodyTabs({
  projectKey,
  issueNumber,
  issueId,
  comments,
  history,
}: {
  projectKey: string;
  issueNumber: number;
  issueId: number;
  comments: IssueCommentResponse[];
  history: IssueHistoryEntry[];
}) {
  return (
    <Tabs defaultValue="comments" className="w-full">
      <TabsList>
        <TabsTrigger value="comments">💬 코멘트</TabsTrigger>
        <TabsTrigger value="activity">📜 활동</TabsTrigger>
      </TabsList>
      {/* forceMount: Radix 가 비활성 탭을 unmount 하면 작성 중인 코멘트 초안이 날아감.
          data-[state=inactive]:hidden 으로 비활성 시 시각적으로만 숨기고 DOM 유지. */}
      <TabsContent value="comments" className="pt-4 data-[state=inactive]:hidden" forceMount>
        <IssueCommentList
          projectKey={projectKey}
          issueNumber={issueNumber}
          issueId={issueId}
          comments={comments}
        />
      </TabsContent>
      <TabsContent value="activity" className="pt-4">
        <IssueActivityTimeline entries={history} />
      </TabsContent>
    </Tabs>
  );
}
