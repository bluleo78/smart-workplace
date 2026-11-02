// AGENT 유저 목록 + 생성/삭제 mutation. queryKey 는 ['agents'] 단일.

import { hashKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  renameAgent,
  setAgentRuntime,
} from "../../api/agents";
import { handleApiError } from "../../lib/api-error";
import type { AgentRuntime } from "../../types/agent";

export const agentKeys = {
  all: ["agents"] as const,
  list: (includePersonal: boolean) => ["agents", { includePersonal }] as const,
  // 상세도 agentKeys.all 아래 — 이름 변경·실행 방식 변경 등 에이전트 변경이 목록과 상세를 함께 다시 읽는다.
  detail: (id: number) => ["agents", "detail", id] as const,
};

// includePersonal=true 면 개인 비서(자동 생성 AGENT)까지 포함해 조회한다.
export function useAgents(includePersonal = false) {
  return useQuery({
    queryKey: agentKeys.list(includePersonal),
    queryFn: () => listAgents(includePersonal),
  });
}

// 에이전트 한 명 — 상세 페이지용. id 가 숫자가 아니면(잘못된 주소) 부르지 않는다.
export function useAgent(id: number | null) {
  return useQuery({
    queryKey: agentKeys.detail(id ?? 0),
    queryFn: () => getAgent(id!),
    enabled: id != null,
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createAgent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
      toast.success("에이전트를 추가했습니다");
    },
    onError: (e) => handleApiError(e, "에이전트 추가에 실패했습니다"),
  });
}

// AGENT 이름/식별자 변경. 성공 시 목록 갱신 + 토스트.
export function useRenameAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      ...body
    }: { userId: number } & Parameters<typeof renameAgent>[1]) =>
      renameAgent(userId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
      toast.success("에이전트를 변경했습니다");
    },
    onError: (e) => handleApiError(e, "에이전트 변경에 실패했습니다"),
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteAgent,
    onSuccess: (result, userId) => {
      // 지운 AI 의 상세 조회는 다시 읽지 않는다 — 상세 화면이 목록으로 넘어가기 전에 404 로 「찾을 수 없어요」가 잠깐 뜨지 않게.
      const deletedDetail = result === "DELETED" ? agentKeys.detail(userId) : null;
      qc.invalidateQueries({
        queryKey: agentKeys.all,
        predicate: (q) => deletedDetail == null || q.queryHash !== hashKey(deletedDetail),
      });
      // 남은 기록이 있는 AI 는 서버가 삭제 대신 사용을 중지한다(WP-705) — 무엇이 일어났는지 그대로 알린다.
      toast.success(
        result === "DEACTIVATED"
          ? "남은 기록이 있어 삭제 대신 사용을 중지했습니다"
          : "에이전트를 삭제했습니다",
      );
    },
    onError: (e) => handleApiError(e, "에이전트 삭제에 실패했습니다"),
  });
}

// 실행 방식(내부·외부) 변경. 409(비서 지정 등) 사유는 서버 message 를 handleApiError 가 토스트로 보여준다.
export function useSetAgentRuntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      runtime,
    }: {
      userId: number;
      runtime: AgentRuntime;
    }) => setAgentRuntime(userId, runtime),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
      toast.success("실행 방식을 변경했습니다");
    },
    onError: (e) => handleApiError(e, "실행 방식 변경에 실패했습니다"),
  });
}
