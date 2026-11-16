package com.workplace.issue.outbound.dto;

import com.workplace.issue.report.ReportIssue;
import com.workplace.issue.report.ReportTableRow;
import java.util.List;
import java.util.Map;

/**
 * ai-agent POST /issue/personal-report 요청 DTO(WP-1486) — 내 노트 템플릿 샘플·시스템 계산값·이슈 목록을 보내 개인 보고 마크다운을
 * 받는다. 필드 이름은 ai-agent 의 personalReportInputSchema 와 1:1 이다(남은 건수 이름 {@code omittedByEpic} 은 프로젝트
 * DTO 와 맞췄다 — 값은 에픽, 없으면 프로젝트별 건수).
 *
 * @param userName 보고 주인 이름(본인)
 * @param kind 종류(DAILY / WEEKLY / MONTHLY)
 * @param kindLabel 종류 이름(일일·주간·월간)
 * @param title 보고 제목(h1 로 쓰지 않는다 — 참고용)
 * @param periodLabel 기간 문구(「11월 11일 (수)」, 「11월 9일 ~ 15일」)
 * @param templateMarkdown 템플릿 본문(샘플) — 지시 상자를 담은 그대로 보낸다(AI 가 따르되 출력하지 않는다)
 * @param tableRows 주간·월간 비교 표 행(일일은 빈 목록)
 * @param numbersLine 일일 「어제 숫자」 한 줄(칸은 「 | 」 로 나눔, 주간·월간은 null)
 * @param issues 이슈 목록(40건 상한)
 * @param omittedByEpic 상한에 걸려 빠진 이슈의 에픽(없으면 프로젝트)별 건수(없으면 빈 맵)
 * @param completedSplit 끝낸 일 건수와 그중 AI와 함께/직접(WP-1632) — 요약 고정 줄 재료. 새 선택 필드(롤링 배포 호환 — {@link
 *     com.workplace.issue.report.ReportAssignee} 참고)
 * @param assistantAgentId 비서 사용자 id(개인 비서 → 공용 비서)
 * @param model 비서 모델
 * @param maxTurns 비서 최대 턴
 * @param timeoutMs 실행 예산(ms) — 프로젝트 리포트와 같은 리포트 예산
 */
public record PersonalReportAiRequest(
    String userName,
    String kind,
    String kindLabel,
    String title,
    String periodLabel,
    String templateMarkdown,
    List<ReportTableRow> tableRows,
    String numbersLine,
    List<ReportIssue> issues,
    Map<String, Integer> omittedByEpic,
    CompletedSplit completedSplit,
    long assistantAgentId,
    String model,
    int maxTurns,
    long timeoutMs) {

  /**
   * 끝낸 일 나눔(WP-1632) — AI 가 합·차를 새로 계산하지 않게 직접 건수까지 시스템이 정해 보낸다.
   *
   * @param completed 끝냄
   * @param withAi 그중 AI와 함께
   * @param direct 그중 직접(끝냄 − AI와 함께, 0 아래로 내려가지 않음)
   */
  public record CompletedSplit(int completed, int withAi, int direct) {

    /**
     * 끝냄·AI와 함께로 나눔을 만든다 — AI와 함께를 [0, 끝냄] 안으로 깎고 직접 = 끝냄 − AI와 함께로 정한다. 두 값은 같은 지표에서 나와 보통 어긋나지
     * 않지만, 어긋나면 「끝낸 일 1건 (AI와 함께 3, 직접 0)」 처럼 합이 맞지 않는 줄이 AI 에 실리므로 여기서 바로잡아 「AI와 함께 + 직접 = 끝냄」 을 늘
     * 지킨다.
     *
     * @param completed 끝냄
     * @param withAi 그중 AI와 함께(지표 값 그대로)
     * @return 합이 맞는 나눔
     */
    public static CompletedSplit of(int completed, int withAi) {
      int clamped = Math.max(0, Math.min(withAi, completed));
      return new CompletedSplit(completed, clamped, completed - clamped);
    }
  }
}
