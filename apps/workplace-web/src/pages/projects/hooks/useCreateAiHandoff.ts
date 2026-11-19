import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { postIssueRecurrenceTestRun, putIssueRecurrence } from '../../../api/issueRecurrence';
import { useProjectRecurrenceAgents } from '../../../hooks/queries/useIssueRecurrence';
import { issueKeys } from '../../../hooks/queries/useIssues';
import { extractApiError } from '../../../lib/api-error';
import {
  buildTaskRRule,
  DEFAULT_TASK_RECURRENCE_FORM,
  type TaskRecurrenceForm,
  taskRunTime,
  validateTaskRecurrence,
} from '../../../lib/issueRecurrence';

/** 만들기 창에서 처음 펼쳤을 때의 일정 — 한 번만 09:00(되풀이를 고르지 않으면 한 번만 돈다, WP-1315). */
const INITIAL_FORM: TaskRecurrenceForm = { ...DEFAULT_TASK_RECURRENCE_FORM, freq: 'ONCE' };

/** 만들기 버튼 종류 — 만들고 지금 실행 / 만들기만(일정만 저장). */
export type CreateMode = 'run' | 'only';

/**
 * 만들기 창의 「AI 에게 맡기기」 상태(WP-1315) — 데스크톱 대화상자와 모바일 시트가 같이 쓴다.
 *
 * - on: 맡기기를 켰는지(처음 펼치면 켜진다. 「맡기지 않기」가 끈다). expanded: 펼침.
 * - 담당 AI 후보는 켠 뒤에만 받는다(프로젝트 단위 후보 — 이슈가 아직 없다). 고르지 않으면 첫 후보(내 AI 비서가 맨 앞).
 * - active: 켜져 있고 담당 AI 가 정해졌다 — 이때만 만들기 뒤 일정을 저장하고 버튼이 「만들고 지금 실행」/「만들기만」으로 바뀐다.
 * - loading: 켰는데 후보를 아직 받는 중 — 버튼은 「만들고 지금 실행」/「만들기만」으로 두되 잠그고, 만들기도 막는다(받기 전에 눌러 맡기기가 조용히
 *   빠진 채 만들어지지 않게). 받은 목록이 비면 active 가 아니라 평소 「생성」으로 돌아가고, 칸이 「맡길 수 있는 AI 가 없습니다」를 보인다.
 *
 * initialAgentId(WP-1767): 사람 카드의 「일 맡기기」가 AI 를 골라 둔 채 창을 연다 — 열릴 때 맡기기를 켜고 펼치며 그 AI 를 고른다. 후보를 받았는데 그
 * AI 가 없으면(이 프로젝트의 멤버가 아님) 첫 후보로 대신 고르지 않고 agent 를 비운다(notMember) — 엉뚱한 AI 에게 맡겨지지 않게.
 * 그때도 칸은 다른 후보를 고를 수 있게 보이고, 사용자가 고르면 pickedAgentId 가 바뀌어 notMember 가 풀린다.
 * projectKey 가 열린 채 바뀌면(WP-1768) 열릴 때처럼 처음 상태로 돌아가 initialAgentId 를 새 프로젝트 후보로 다시 판정한다.
 *
 * 만들기와 일정 저장은 화면이 차례로 부른다(afterCreate) — 작업 만들기는 성공했는데 일정 저장이 실패하면 작업은 남기고 이유를 알린다.
 */
export function useCreateAiHandoff(projectKey: string, open: boolean, initialAgentId?: number) {
  const qc = useQueryClient();
  const [on, setOn] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState<TaskRecurrenceForm>(INITIAL_FORM);
  const [pickedAgentId, setPickedAgentId] = useState<number | null>(null);
  // 만들기를 한 번 누른 뒤부터 일정 검사 문구를 보인다.
  const [touched, setTouched] = useState(false);
  // 켜져 있는 동안 받는다 — 받는 사이 줄을 접어도 요청이 끊기지 않고, 접은 뒤에도 요약에 고른 AI 가 남는다.
  const agents = useProjectRecurrenceAgents(projectKey, open && on);
  const options = agents.data ?? [];
  const pickedInOptions = pickedAgentId != null && options.some((o) => o.id === pickedAgentId);
  // 미리 채운 AI 를 아직 고른 채인데 후보에 없으면 첫 후보로 대신하지 않는다(받는 중이거나 멤버가 아님).
  const keepInitial = initialAgentId != null && pickedAgentId === initialAgentId && !pickedInOptions;
  const agentId = pickedInOptions ? pickedAgentId : keepInitial ? null : options[0]?.id ?? null;
  const notMember = on && keepInitial && agents.isSuccess;
  const agent = options.find((o) => o.id === agentId) ?? null;
  const active = on && agent != null;
  const loading = on && agents.isPending;
  const error = active ? validateTaskRecurrence(form) : null;

  // 창을 다시 열면 처음 상태로 — 지난번에 켜 둔 맡기기가 다음 작업에 남지 않게. 미리 채운 AI 가 있으면 켜고 펼쳐 그 AI 를 고른다.
  // 열린 채 프로젝트가 바뀌어도(WP-1768 창 안 프로젝트 고르기) 같이 처음으로 — 미리 채운 AI 를 다시 골라 새 프로젝트 후보로 판정한다
  // (멤버가 아니면 notMember, 멤버인 프로젝트로 돌아오면 그 AI 가 다시 골라진다). 앞 프로젝트에서 고른 다른 AI 는 남기지 않는다.
  useEffect(() => {
    if (!open) return;
    const preset = initialAgentId != null;
    setOn(preset);
    setExpanded(preset);
    setForm(INITIAL_FORM);
    setPickedAgentId(initialAgentId ?? null);
    setTouched(false);
    // initialAgentId 는 열릴 때(·프로젝트가 바뀔 때)의 값만 쓴다 — 열린 채 바뀌어도 입력 중인 폼을 되돌리지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectKey]);

  /** 줄을 누른다 — 처음 펼치면 맡기기를 켠다. 펼친 채 누르면 접기만 한다(설정은 남는다). */
  const toggle = () => {
    if (!expanded) setOn(true);
    setExpanded((v) => !v);
  };

  /** 「맡기지 않기」 — 끄고 접는다. */
  const turnOff = () => {
    setOn(false);
    setExpanded(false);
    setTouched(false);
  };

  const patch = (p: Partial<TaskRecurrenceForm>) => setForm((f) => ({ ...f, ...p }));

  /** 만들기 전 검사 — 담당 AI 후보를 아직 받는 중이거나, 맡기기가 켜져 있고 일정이 틀리면(펼쳐 문구를 보이고) false. */
  const check = (): boolean => {
    if (loading) return false;
    setTouched(true);
    if (active && error) {
      setExpanded(true);
      return false;
    }
    return true;
  };

  /**
   * 작업을 만든 뒤 — 일정을 저장하고(서버가 담당 AI 를 담당자에 넣는다) 「만들고 지금 실행」이면 시험 실행을 보낸다. 실패는 작업이 이미 있다는 것과 이유를 함께
   * 알린다. 성공 토스트도 여기서 낸다(맡기기가 꺼져 있으면 false — 부르는 쪽이 평소 토스트를 낸다).
   */
  const afterCreate = async (issueNumber: number, mode: CreateMode): Promise<boolean> => {
    if (!active || agentId == null) return false;
    const rrule = buildTaskRRule(form);
    if (!rrule) return false;
    try {
      // 시간대를 정하지 않은 몇 시간마다는 00:00 으로 보낸다(WP-1413 — 끝 23:59 와 함께 하루 종일).
      await putIssueRecurrence(projectKey, issueNumber, { rrule, time: taskRunTime(form), agentUserId: agentId });
    } catch (e) {
      toast.error(`작업은 만들었지만 실행 일정을 저장하지 못했습니다 — ${extractApiError(e, '알 수 없는 오류')}`);
      return true;
    } finally {
      // 저장 성공·실패와 관계없이 — 담당자·AI 위임 작업 목록이 바뀌었을 수 있다.
      qc.invalidateQueries({ queryKey: ['ai-tasks'] });
      qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
    }
    if (mode === 'run') {
      try {
        await postIssueRecurrenceTestRun(projectKey, issueNumber);
      } catch (e) {
        toast.error(`작업과 실행 일정은 저장했지만 지금 실행하지 못했습니다 — ${extractApiError(e, '알 수 없는 오류')}`);
        return true;
      }
      toast.success('작업을 만들고 지금 실행을 시작했습니다 — 결과는 작업 채팅에 남습니다');
      return true;
    }
    toast.success('작업을 만들고 실행 일정을 저장했습니다');
    return true;
  };

  return {
    expanded, toggle, turnOff, form, patch, agents, options, agentId, agent, setAgentId: setPickedAgentId,
    active, loading, notMember, error: touched ? error : null, check, afterCreate,
  };
}

export type CreateAiHandoff = ReturnType<typeof useCreateAiHandoff>;
