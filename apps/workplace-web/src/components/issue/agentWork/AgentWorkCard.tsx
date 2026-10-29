// 이슈 상세 「AI 진행」 칸(WP-1079) — 제목 아래(AI 현황 요약 위)에 진행 중 AI 작업을 작업자별로 보인다. 데스크톱·모바일이 같은 칸을 쓴다.
// 속성 레일(고르는 값 목록)에 문장으로 된 실시간 소식이 끼어 결이 달랐고, 질문 카드와 정보가 두 곳에 나뉘었다(WP-377 레일 섹션·질문 카드·모바일 칩/시트를 대체).
// AI 구성원의 「답변 필요」 배지를 누르면 이슈 채팅 드로워가 열린다 — 「내 AI 작업」 목록(채팅 링크)과 같은 규칙. 도구 이름은 이 화면에선 보이지 않는다(목록에 남음).
import { AgentLastReport, AgentNextRun, AgentStateBadge } from '@/components/ai/agentWork/AgentWorkBits';
import { AiLabel } from '@/components/ai/AiLabel';
import { AI_CONTENT_CONTAINER_CLASS } from '@/components/ai/aiMarker';
import { AssigneeAvatar } from '@/components/users/UserAvatar';
import { isAgentQuestion, progressView } from '@/lib/agentWork';
import { cn } from '@/lib/utils';
import type { AgentWorkView } from '@/types/issue';

/**
 * AI 진행 칸 — 진행 중 작업이 없으면 렌더하지 않는다. 서버가 급한 순(상태 순위 → 마지막 보고 최근순)으로 내려주므로 그 순서 그대로 보인다.
 * 데스크톱(기본): 작업자마다 한 줄 [아바타 · 이름 · 상태(진행률 포함) · 최근 보고 · 다음 회차/마지막 보고]. 최근 보고는 한 줄 말줄임(마우스 올리면 전체),
 * 답해야 하는 질문은 읽어야 답할 수 있으므로 줄이지 않는다.
 * stacked(모바일): 폭이 좁아 [아바타 · 이름 · 상태 … 마지막 보고] / 최근 보고(두 줄) / 다음 회차 로 나눈다.
 */
export function AgentWorkCard({
  list,
  onOpenChat,
  stacked = false,
}: {
  list?: AgentWorkView[];
  /** 「답변 필요」 배지가 이슈 채팅 드로워를 연다 — 페이지의 openChat(?chat=1 을 기존 쿼리·히스토리 표식과 함께 더한다). */
  onOpenChat: () => void;
  stacked?: boolean;
}) {
  if (!list || list.length === 0) return null;
  return (
    <div className={cn(AI_CONTENT_CONTAINER_CLASS, 'space-y-2')} data-testid="agent-work-card">
      <AiLabel>AI 진행</AiLabel>
      <ul className={stacked ? 'space-y-3' : 'space-y-1.5'}>
        {list.map((w) => {
          // 작업자는 이슈당 진행 중 작업 1건(서버 부분 유니크) — key·testid 로 쓴다.
          const id = `agent-work-${w.worker.id}`;
          const question = isAgentQuestion(w);
          // 진행률은 배지에 합친다(「작업 중 3/5」, WP-917 좁은 표와 같은 방식) — 줄마다 막대를 두면 한 줄이 넘친다.
          const badge = (
            <AgentStateBadge
              state={w.state}
              suffix={progressView(w)?.text}
              onClick={question ? onOpenChat : undefined}
              hint={question ? '채팅에서 답하기' : undefined}
              data-testid={`${id}-state`}
            />
          );
          const last = <AgentLastReport w={w} className="shrink-0 whitespace-nowrap" data-testid={`${id}-last`} />;
          const nextRun = <AgentNextRun w={w} suffix="시작" className="shrink-0" data-testid={`${id}-next-run`} />;
          const who = (
            <>
              {/* 정지된 작업자는 담당자 칸·AI 위임 작업 표처럼 회색 아바타(작업자 요약의 active, WP-1160). */}
              <AssigneeAvatar user={w.worker} size="xs" />
              {/* 이름이 길면 말줄임 — 데스크톱 한 줄은 이름(12rem 까지)과 최근 보고가 함께 줄고, 배지·시간은 줄지 않는다. */}
              <span className={cn('min-w-0 truncate font-medium', !stacked && 'max-w-48')}>{w.worker.name}</span>
              <span className="shrink-0">{badge}</span>
            </>
          );
          if (stacked)
            return (
              <li key={w.worker.id} className="min-w-0 space-y-1 text-sm" data-testid={id}>
                <div className="flex min-w-0 items-center gap-2">
                  {who}
                  <span className="ml-auto flex shrink-0">{last}</span>
                </div>
                {/* 터치 화면엔 마우스 올리기가 없어 질문은 전부, 나머지는 두 줄까지. break-keep 으로 한국어는 어절 단위로 줄바꿈. */}
                {w.note && (
                  <p className={cn('break-words break-keep text-muted-foreground', !question && 'line-clamp-2')}>{w.note}</p>
                )}
                {nextRun}
              </li>
            );
          return (
            // 질문이 여러 줄로 꺾이면 이름·배지·시간이 가운데로 떠 보이지 않게 첫 줄에 맞춘다.
            <li key={w.worker.id} className={cn('flex min-h-7 min-w-0 gap-2 text-sm', question ? 'items-start' : 'items-center')} data-testid={id}>
              {who}
              <span
                className={cn('min-w-0 flex-1 text-muted-foreground', question ? 'break-words break-keep' : 'truncate')}
                title={question ? undefined : (w.note ?? undefined)}
              >
                {w.note}
              </span>
              {nextRun}
              {last}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
