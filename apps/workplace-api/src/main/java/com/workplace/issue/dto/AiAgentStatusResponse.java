package com.workplace.issue.dto;

import com.workplace.global.dto.UserSummary;
import java.time.Instant;
import java.util.List;

/**
 * AI 위임 작업 「AI별」 보기(WP-1201) 응답 — 워크스페이스 AI 마다 연결 여부·열린 작업·동시 진행 자리 수. 대표 상태·정렬·상태별 건수는 화면이 계산한다(AI
 * 수가 적어 한 번에 다 보낸다).
 *
 * @param agents AI 목록(이름순)
 * @param slotLimit 동시 진행 상한 — work-loop 스킬과 같은 값(WP-1040)
 */
public record AiAgentStatusResponse(List<AiAgentStatus> agents, int slotLimit) {

  /**
   * AI 한 명.
   *
   * @param connected 알림 구독(SSE) 연결 여부 — 서버 안에서 도는 AI(INTERNAL)는 판단하지 않아 null
   * @param disconnectedAt 끊긴 시각 — 연결 중이거나 모르면 null
   * @param lastEndedAt 마지막으로 작업을 끝낸 시각 — 「쉬는 중 n분째」의 기준
   * @param works 열린 작업 중 호출자가 볼 수 있는 것
   * @param hiddenWorks 호출자가 볼 수 없는 프로젝트의 열린 작업 수
   * @param slotsUsed 동시 진행 상한에 세는 작업 수(볼 수 없는 것 포함) — 작업 중·대기 중·답변 필요·인증 필요, 무소식 아님, 작업 중인 하위가 있는
   *     부모 아님
   */
  public record AiAgentStatus(
      UserSummary agent,
      String description,
      Boolean connected,
      Instant disconnectedAt,
      Instant lastEndedAt,
      List<AiAgentWork> works,
      int hiddenWorks,
      int slotsUsed) {}

  /**
   * 열린 작업 한 건.
   *
   * @param updatedAt 마지막 보고 시각
   * @param stateChangedAt 상태가 실제로 바뀐 시각 — note 만 바뀐 보고로는 바뀌지 않는다
   * @param stale 무소식(작업 중인데 2시간 넘게 보고 없음)
   */
  public record AiAgentWork(
      String projectKey,
      int number,
      String title,
      String state,
      String note,
      Instant updatedAt,
      Instant stateChangedAt,
      boolean stale) {}
}
