// 에이전트 실행 방식(WP-1273·1278·1281) 화면 판정 — 방식 카드·방식 바꾸기 요약·실행 전 확인. 화면과 분리해 vitest 로 지킨다.
// 실행 방식은 서버가 판정한 AgentResponse.runMode(SERVER·WORKSPACE·EXTERNAL)를 그대로 쓴다 — 화면이 runtime 과 실행 설정 유무로 다시 추론하지 않는다.

import type { AgentRunMode } from '../types/agent';
import type { AgentTemplate } from '../types/agentRuntime';
import { euroRo } from './utils';

/** 방식 카드 하나 — 「기본」·작업 공간 방식(템플릿마다 한 장)·「외부」. */
export interface RunModeCard {
  /** 카드 식별자 — SERVER · EXTERNAL · 작업 공간 방식은 그 이름. */
  id: string;
  mode: AgentRunMode;
  title: string;
  description: string;
  /** 작업 공간 방식이면 그 정의, 아니면 null. */
  template: AgentTemplate | null;
}

/**
 * 카드 목록 — 기본 / (작업 공간 방식들) / 외부. 작업 공간 방식의 제목·설명은 서버가 준 정의에서 가져와 화면이 방식 이름을 모르게 한다.
 * 정의 목록을 아직 못 받았으면 기본·외부 두 장만.
 */
export function runModeCards(templates: AgentTemplate[] | undefined): RunModeCard[] {
  const worksRun = (templates ?? [])
    .filter((t) => t.kind === 'WORKSPACE')
    .map<RunModeCard>((t) => ({
      id: t.name,
      mode: 'WORKSPACE',
      title: t.card.title,
      description: `Works 가 실행 · ${t.card.description}`,
      template: t,
    }));
  return [
    { id: 'SERVER', mode: 'SERVER', title: '기본', description: 'Works 가 실행 · 이슈·멘션에 바로 답해요', template: null },
    ...worksRun,
    { id: 'EXTERNAL', mode: 'EXTERNAL', title: '외부', description: '직접 띄운 AI 도구가 키로 접속해요', template: null },
  ];
}

/**
 * 저장된 작업 공간 방식이 카드에 없을 때(정의를 아직 못 받았거나 릴리스에서 빠짐) 그 방식 카드를 「외부」 앞에 더한다 — 지금 방식이 늘 카드 한 장으로
 * 보이고, 다른 방식으로 바꿀 때 출발 방식을 작업 공간으로 판단해 실행 설정을 지우게 한다(기본으로 잘못 보면 설정이 남는다).
 * 빠진 방식이면(templatesLoaded) 제목에 「(지원 끝남)」을 붙인다 — 목록의 실행 배지와 같은 표기.
 */
export function withSavedWorkspaceCard(
  cards: RunModeCard[],
  mode: AgentRunMode,
  templateName: string | null | undefined,
  templatesLoaded: boolean,
): RunModeCard[] {
  if (mode !== 'WORKSPACE' || !templateName || cards.some((c) => c.id === templateName)) return cards;
  const saved: RunModeCard = {
    id: templateName,
    mode: 'WORKSPACE',
    title: templatesLoaded ? `${templateName} (지원 끝남)` : templateName,
    description: 'Works 가 실행',
    template: null,
  };
  return [...cards.slice(0, -1), saved, cards[cards.length - 1]];
}

/** 지금 방식의 카드 id — 작업 공간이면 저장된 방식 이름(없으면 첫 작업 공간 카드). */
export function currentCardId(mode: AgentRunMode, templateName: string | null | undefined, cards: RunModeCard[]): string {
  if (mode !== 'WORKSPACE') return mode;
  return templateName ?? cards.find((c) => c.mode === 'WORKSPACE')?.id ?? 'WORKSPACE';
}

/** 「실행 방식을 외부로 바꿀까요?」 — 확인 창 제목. */
export function modeChangeTitle(to: RunModeCard): string {
  return `실행 방식을 ${to.title}${euroRo(to.title)} 바꿀까요?`;
}

/** 작업 설정 칸 이름 묶음 — 「모델·대기열 라벨·실행 환경」. */
function workSettingNames(t: AgentTemplate | null): string {
  return [...(t?.config.map((f) => f.label) ?? []), '실행 환경'].join('·');
}

/**
 * 방식을 바꾸면 무엇이 달라지는지 — 확인 창 ②(WP-1278)의 항목. 「기본」 카드도 바로 저장하지 않고 이 요약을 거친다.
 * from 이 작업 공간이면 그 정의(fromTemplate)로 지워질 칸 이름을 적는다.
 */
export function modeChangeSummary(from: RunModeCard, to: RunModeCard, fromTemplate: AgentTemplate | null): string[] {
  const lines: string[] = [];
  const leavingWorks = from.mode === 'WORKSPACE' && to.id !== from.id;
  if (leavingWorks) {
    lines.push(`${fromTemplate?.card.title ?? from.title} 작업 설정(${workSettingNames(fromTemplate)})이 지워져요.`);
    if (to.mode !== 'WORKSPACE') lines.push('Works 가 관리하던 접속 키는 폐기돼요.');
  }
  if (to.mode === 'SERVER') {
    if (from.mode !== 'SERVER') lines.push('Works 가 이 AI 의 이슈·멘션에 바로 답해요. AI 계정을 연결해야 일할 수 있어요.');
    lines.push('지시는 읽지 않아요. 적어 둔 지시는 지워지지 않아요.');
  }
  if (to.mode === 'EXTERNAL') {
    if (from.mode === 'SERVER') lines.push('Works 는 이 AI 의 이슈·멘션에 더는 바로 답하지 않아요.');
    lines.push('직접 띄운 AI 도구가 이 AI 의 키로 접속해 일해요. 바꾼 뒤 연결 방법을 따라 키를 발급해 주세요.');
    if (from.mode === 'WORKSPACE') lines.push('코드는 그 도구를 띄운 컴퓨터의 GitHub 로그인으로 받아요.');
  }
  if (to.mode === 'WORKSPACE') {
    if (from.mode === 'SERVER') lines.push('Works 는 이 AI 의 이슈·멘션에 더는 바로 답하지 않고, 작업 공간을 띄워 일하게 해요.');
    if (from.mode === 'EXTERNAL') lines.push('접속 키는 Works 가 만들어 관리해요. 직접 발급한 키는 그대로 남으니 쓰지 않으면 폐기해 주세요.');
    lines.push('펼친 작업 설정으로 저장돼요. 실행은 저장한 뒤 상태에서 시작해요.');
  }
  return lines;
}

/** 실행 전 확인 결과 — 화면은 이 값으로 ✓/✗ 와 실행 시작을 막는 이유를 그린다. */
export interface StartChecks {
  /** Claude 연결이 필요한 방식인지 — 필요 없으면 항목을 그리지 않는다. */
  needsClaude: boolean;
  claudeOk: boolean;
  /** 저장소 토큰이 필요한 방식인지(템플릿 requires 에 repo, WP-1268) — 필요 없으면 항목을 그리지 않는다. */
  needsRepos: boolean;
  /** 맡는 프로젝트 저장소 호스트 중 토큰이 없는 것. */
  missingRepoHosts: string[];
  projectCount: number;
  /** 실행 환경이 하나라도 있는지. */
  hasLocation: boolean;
  /** 고른(또는 기본) 실행 환경에 자리가 있는지. */
  seatOk: boolean;
  /** 작업 설정의 필수 칸이 비었는지. */
  missingRequired: boolean;
  /** 사용 중지된 AI 인지 — 사용 중지면 실행할 수 없다. */
  inactive: boolean;
}

/** 실행 시작을 막는 첫 이유 — 막히지 않으면 null. 위에서부터 고칠 순서대로 고른다. */
export function startBlockReason(c: StartChecks): string | null {
  if (c.inactive) return '사용 중지된 AI 는 실행할 수 없어요';
  if (c.needsClaude && !c.claudeOk) return 'Claude 를 먼저 연결해 주세요';
  if (c.needsRepos && c.missingRepoHosts.length > 0) return '저장소를 먼저 연결해 주세요';
  if (c.projectCount === 0) return '맡는 프로젝트를 먼저 정해 주세요';
  if (!c.hasLocation) return '실행 환경을 먼저 추가해 주세요';
  if (!c.seatOk) return '실행 환경에 여유가 없어요';
  if (c.missingRequired) return '작업 설정의 빈 칸을 채워 주세요';
  return null;
}
