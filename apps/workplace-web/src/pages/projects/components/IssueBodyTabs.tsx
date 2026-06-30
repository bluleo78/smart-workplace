// 활동 섹션 — 코멘트(기록)와 이력(변경 이력)을 탭으로 묶는다.
// 무엇을: "활동" 섹션 레이블 + shadcn Tabs [코멘트|이력] 전환, 기본 코멘트. 장식 이모지 미사용(디자인 시스템 §7.3).
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
    // 활동 섹션 — 코멘트/이력 탭을 감싸는 레이블(본문·하위 태스크와 동일 heading-group 토큰).
    <section aria-label="활동" className="space-y-2">
      <h2 className="text-base leading-6 font-medium">활동</h2>
      <Tabs defaultValue="comments" className="w-full">
        <TabsList>
          <TabsTrigger value="comments">코멘트</TabsTrigger>
          <TabsTrigger value="activity">이력</TabsTrigger>
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
    </section>
  );
}
