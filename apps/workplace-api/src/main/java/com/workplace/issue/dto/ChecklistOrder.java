package com.workplace.issue.dto;

import com.workplace.issue.exception.InvalidIssueFilterException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Locale;

/**
 * 개인 작업 목록용 opt-in 정렬(WP-918, {@code order=checklist}). 화면 섹션 순서(마감 버킷·상태·우선순위)로 먼저 정렬해 클라이언트가 페이지를
 * 이어 붙여도 섹션이 되돌아가지 않게 한다.
 *
 * <p>마감 버킷 경계(today·weekEnd)는 클라이언트 로컬 날짜를 그대로 받는다 — 서버가 시간대를 골라 스스로 계산하면 클라이언트 {@code groupByDue}
 * 와 경계가 어긋날 수 있다. weekEnd 는 DUE 에서만 쓴다.
 *
 * @param mode 섹션 기준
 * @param today 클라이언트 로컬 오늘(DUE 에서만, 그 밖은 null)
 * @param weekEnd 클라이언트 로컬 이번 주 마지막 날(DUE 에서만, 그 밖은 null)
 */
public record ChecklistOrder(Mode mode, LocalDate today, LocalDate weekEnd) {

  /** 섹션 기준 — 개인 목록 화면의 묶음 방식과 같다. */
  public enum Mode {
    /** 지남 → 오늘 → 이번 주 → 예정 → 마감 없음 → 닫힘. */
    DUE,
    /** 할 일 → 진행 중 → 완료 → 취소. */
    STATUS,
    /** 취소 아닌 것 → 취소(섹션 안은 우선순위 순). */
    PRIORITY
  }

  /**
   * 파라미터 해석 — order 가 없으면 null(기존 정렬). order 가 checklist 가 아니거나, mode 가 없거나 틀리거나, DUE 인데
   * today·weekEnd 가 없거나 형식이 틀리거나 weekEnd 가 today 보다 앞서면 {@link InvalidIssueFilterException}(400,
   * 필드별 사유).
   */
  public static ChecklistOrder parse(String order, String mode, String today, String weekEnd) {
    if (order == null || order.isBlank()) return null;
    if (!"checklist".equalsIgnoreCase(order.trim())) {
      throw new InvalidIssueFilterException("order", "order 는 checklist 만 받습니다: " + order);
    }
    Mode m = parseMode(mode);
    if (m != Mode.DUE) return new ChecklistOrder(m, null, null);
    LocalDate t = requiredDate("today", today);
    LocalDate w = requiredDate("weekEnd", weekEnd);
    // 이번 주 마지막 날은 오늘이거나 그 뒤다(일요일이면 같은 날) — 거꾸로면 「이번 주」 버킷 정렬이 뜻을 잃으므로 거부한다.
    if (w.isBefore(t)) {
      throw new InvalidIssueFilterException("weekEnd", "weekEnd 는 today 보다 앞설 수 없습니다: " + weekEnd);
    }
    return new ChecklistOrder(m, t, w);
  }

  private static Mode parseMode(String raw) {
    if (raw == null || raw.isBlank()) {
      throw new InvalidIssueFilterException(
          "mode", "order=checklist 에는 mode(due·status·priority)가 필요합니다");
    }
    return switch (raw.trim().toLowerCase(Locale.ROOT)) {
      case "due" -> Mode.DUE;
      case "status" -> Mode.STATUS;
      case "priority" -> Mode.PRIORITY;
      default ->
          throw new InvalidIssueFilterException(
              "mode", "mode 는 due·status·priority 중 하나여야 합니다: " + raw);
    };
  }

  private static LocalDate requiredDate(String name, String raw) {
    if (raw == null || raw.isBlank()) {
      throw new InvalidIssueFilterException(name, "mode=due 에는 " + name + "(YYYY-MM-DD)가 필요합니다");
    }
    try {
      return LocalDate.parse(raw.trim());
    } catch (DateTimeParseException e) {
      throw new InvalidIssueFilterException(name, name + " 날짜 형식 오류: " + raw);
    }
  }
}
