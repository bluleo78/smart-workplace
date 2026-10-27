// 활동 섹션 — 코멘트(기록)와 이력(변경 이력)을 탭으로 묶는다.
// 무엇을: "활동" 섹션 레이블 + shadcn Tabs [코멘트|이력] 전환, 기본 코멘트. 장식 이모지 미사용(디자인 시스템 §7.3).
// 왜: 활동 로그를 사이드바에서 본문 탭으로 이동(업계 표준), 속성 접근 방해 제거(#343).
// WP-1016: 탭 오른쪽 「오래된 순 / 최신순」 — 두 탭에 같이 적용되고 앱 전체 설정으로 기억한다. 지금 순서가 늘 글자로 보이게 두 버튼을 다 드러낸다.

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ActivityOrder } from '@/lib/activityOrder';
import { TOGGLE_ON_CLASS } from '@/lib/selectionStyles';

import type { IssueCommentResponse, IssueHistoryEntry } from '../../../types/issue';
import { useActivityOrder } from '../hooks/useActivityOrder';
import { IssueActivityTimeline } from './IssueActivityTimeline';
import { IssueCommentList } from './IssueCommentList';

const ORDER_OPTIONS: { value: ActivityOrder; label: string }[] = [
  { value: 'oldest', label: '오래된 순' },
  { value: 'newest', label: '최신순' },
];

export function IssueBodyTabs({
  projectKey,
  issueNumber,
  issueId,
  comments,
  history,
  canReact,
  hideComposer = false,
  scrollToCommentId,
  onScrolledToComment,
}: {
  projectKey: string;
  issueNumber: number;
  issueId: number;
  comments: IssueCommentResponse[];
  history: IssueHistoryEntry[];
  /** 코멘트 이모지 반응 추가·취소 가능 여부(viewerCanEditContent, WP-504). */
  canReact: boolean;
  /** 모바일(WP-196) — 코멘트 작성창은 화면 하단 줄에 있으므로 탭 안 작성창을 뺀다. */
  hideComposer?: boolean;
  /** 모바일 하단 작성창으로 방금 쓴 코멘트 — 코멘트 목록이 그리로 스크롤한다(WP-1016). */
  scrollToCommentId?: number | null;
  onScrolledToComment?: () => void;
}) {
  const [order, setOrder] = useActivityOrder();
  return (
    // 활동 섹션 — 코멘트/이력 탭을 감싸는 레이블(본문·하위 태스크와 동일 heading-group 토큰).
    <section aria-label="활동" className="space-y-2">
      <h2 className="text-base leading-6 font-medium">활동</h2>
      <Tabs defaultValue="comments" className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="comments">코멘트</TabsTrigger>
            <TabsTrigger value="activity">이력</TabsTrigger>
          </TabsList>
          {/* 정렬 선택 — 타임라인 줌(일·주·월)과 같은 눌림 버튼 묶음. */}
          <div className="flex items-center gap-1" role="group" aria-label="활동 정렬" data-testid="activity-order">
            {ORDER_OPTIONS.map((o) => (
              <Button
                key={o.value}
                variant="outline"
                size="sm"
                aria-pressed={order === o.value}
                className={order === o.value ? TOGGLE_ON_CLASS : undefined}
                onClick={() => setOrder(o.value)}
                data-testid={`activity-order-${o.value}`}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
        {/* forceMount: Radix 가 비활성 탭을 unmount 하면 작성 중인 코멘트 초안이 날아감.
            data-[state=inactive]:hidden 으로 비활성 시 시각적으로만 숨기고 DOM 유지. */}
        <TabsContent value="comments" className="pt-4 data-[state=inactive]:hidden" forceMount>
          <IssueCommentList
            projectKey={projectKey}
            issueNumber={issueNumber}
            issueId={issueId}
            comments={comments}
            canReact={canReact}
            hideComposer={hideComposer}
            order={order}
            scrollToCommentId={scrollToCommentId}
            onScrolledToComment={onScrolledToComment}
          />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <IssueActivityTimeline entries={history} projectKey={projectKey} order={order} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
