package com.workplace.fileai.security.dto;

import com.workplace.fileai.outbound.AiAgentDriveClient;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * HTML 보안 점검 상태 응답(WP-1262).
 *
 * @param status PENDING / CHECKING / DONE / FAILED / SKIPPED — 점검 행이 없으면 null
 * @param risk LOW / CAUTION / HIGH (DONE 일 때만)
 * @param headline AI 한 줄 요약(DONE 일 때만)
 * @param evidence 근거 목록(없으면 빈 목록)
 * @param checkedAt 점검을 마친 시각(DONE·SKIPPED)
 * @param reason 점검하지 못한 까닭 — {@code NO_AI}(워크스페이스에 AI 없음) | {@code TOO_LARGE}(20MB 초과) | {@code
 *     ERROR}(그 밖의 실패) | null
 */
public record SecurityCheckView(
    String status,
    String risk,
    String headline,
    List<AiAgentDriveClient.Evidence> evidence,
    OffsetDateTime checkedAt,
    String reason) {

  /** 까닭: 워크스페이스에 AI 가 없다. */
  public static final String REASON_NO_AI = "NO_AI";

  /** 까닭: 원본이 크기 상한을 넘는다. */
  public static final String REASON_TOO_LARGE = "TOO_LARGE";

  /** 까닭: 그 밖의 실패(AI 오류·바이너리 없음 등). */
  public static final String REASON_ERROR = "ERROR";
}
