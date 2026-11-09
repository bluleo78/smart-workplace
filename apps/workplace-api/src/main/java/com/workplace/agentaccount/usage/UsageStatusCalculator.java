package com.workplace.agentaccount.usage;

import com.workplace.auth.service.AgentProviders;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * 계정 사용량 상태 계산(WP-1449) — 계정 상태·종류·창 스냅샷·조회 기록으로 화면에 보일 상태 하나를 정한다. 우선순위(위가 먼저):
 *
 * <ol>
 *   <li>계정이 RELOGIN_REQUIRED → {@link #RELOGIN_REQUIRED} — 조회 결과보다 「다시 로그인」이 먼저 할 일이다.
 *   <li>Gen:iA·OpenAI 호환 → {@link #UNLIMITED} — 조회하지 않는 종류(한도 없음).
 *   <li>한 번도 시도하지 않음 → {@link #UNKNOWN}, 마지막 시도가 실패 → {@link #CHECK_FAILED}(이전 성공 값은 응답에 함께 실린다).
 *   <li>한 창이라도 100% 이상이거나 provider 가 한도 도달을 알림 → {@link #LIMIT_REACHED}.
 *   <li>두 창 중 최대 사용률이 임박 기준 이상 → {@link #NEAR_LIMIT}, 그 밖 → {@link #OK}.
 * </ol>
 *
 * <p>초기화 시각(resetsAt)이 이미 지난 창은 한도 도달·임박 판정에서 뺀다 — 그 값은 지난 창의 것이라 지금은 이미 풀렸다(예: 14시에 풀린 100% 5시간 창,
 * 응답에서 빠져 이전 값이 남은 주간 rejected 창). 응답에는 그대로 실릴 수 있다.
 */
public final class UsageStatusCalculator {

  public static final String OK = "OK";
  public static final String NEAR_LIMIT = "NEAR_LIMIT";
  public static final String LIMIT_REACHED = "LIMIT_REACHED";
  public static final String CHECK_FAILED = "CHECK_FAILED";
  public static final String RELOGIN_REQUIRED = "RELOGIN_REQUIRED";
  public static final String UNLIMITED = "UNLIMITED";
  public static final String UNKNOWN = "UNKNOWN";

  /** 한도 도달로 보는 사용률(%). */
  private static final BigDecimal FULL = BigDecimal.valueOf(100);

  /** Claude 창 상태 헤더가 한도 도달을 알리는 값. */
  private static final String CLAUDE_REJECTED = "rejected";

  private UsageStatusCalculator() {}

  /**
   * 상태를 계산한다.
   *
   * @param provider 계정 종류(anthropic·chatgpt·genia·opencode)
   * @param accountStatus 계정 상태(ACTIVE·NEEDS_CHECK·RELOGIN_REQUIRED)
   * @param snapshots 창별 마지막 성공 값(없으면 빈 목록)
   * @param check 조회 기록(없으면 null) — 마지막 사용 시각만 쓰인 행은 시도 시각이 비어 「시도 안 함」으로 본다
   * @param nearLimitPercent 임박 판정 사용률(%)
   * @param now 지금 — 초기화 시각이 이보다 앞선 창은 판정에서 뺀다
   */
  public static String status(
      String provider,
      String accountStatus,
      List<UsageSnapshot> snapshots,
      UsageCheckRow check,
      BigDecimal nearLimitPercent,
      Instant now) {
    if (RELOGIN_REQUIRED.equals(accountStatus)) return RELOGIN_REQUIRED;
    if (AgentProviders.GENIA.equals(provider) || AgentProviders.OPENCODE.equals(provider)) {
      return UNLIMITED;
    }
    if (check == null || check.checkedAt() == null) return UNKNOWN;
    // 실패하면 error_* 가 남고 성공하면 비워지므로 errorCode 가 있으면 마지막 시도가 실패다
    if (check.errorCode() != null) return CHECK_FAILED;
    if (check.succeededAt() == null) return UNKNOWN;
    BigDecimal max = BigDecimal.ZERO;
    // 확인 단위의 limitReached 도 창 초기화 필터를 탄다 — 모든 창이 이미 초기화됐으면 지난 한도 도달이라 무시.
    boolean allReset =
        !snapshots.isEmpty()
            && snapshots.stream().allMatch(s -> s.resetsAt() != null && s.resetsAt().isBefore(now));
    boolean rejected = check.limitReached() && !allReset;
    for (UsageSnapshot s : snapshots) {
      // 이미 초기화된 창 — 지금 사용률이 아니므로 판정에 넣지 않는다.
      if (s.resetsAt() != null && s.resetsAt().isBefore(now)) continue;
      if (s.usedPercent() != null && s.usedPercent().compareTo(max) > 0) max = s.usedPercent();
      if (CLAUDE_REJECTED.equalsIgnoreCase(s.limitStatus())) rejected = true;
    }
    if (rejected || max.compareTo(FULL) >= 0) return LIMIT_REACHED;
    if (max.compareTo(nearLimitPercent) >= 0) return NEAR_LIMIT;
    return OK;
  }
}
