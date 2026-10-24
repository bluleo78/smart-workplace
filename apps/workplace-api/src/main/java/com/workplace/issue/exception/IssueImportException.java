package com.workplace.issue.exception;

import com.workplace.global.exception.CodedException;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 이슈 가져오기(WP-883·884) 거절 — 사유별로 상태와 {@code errors.reason} 이 달라 호출자(이관 스크립트)가 다음 행동을 가를 수 있다. 정적
 * 팩토리로만 만든다.
 */
public class IssueImportException extends RuntimeException implements CodedException {

  private final HttpStatus status;
  private final Map<String, String> errors;

  private IssueImportException(HttpStatus status, String message, Map<String, String> errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }

  /** 관리자가 아니다. */
  public static IssueImportException forbidden() {
    return new IssueImportException(
        HttpStatus.FORBIDDEN, "이슈 가져오기는 관리자만 할 수 있습니다.", Map.of("reason", "IMPORT_ADMIN_ONLY"));
  }

  /** 개인 프로젝트에는 가져올 수 없다. */
  public static IssueImportException personalProject() {
    return new IssueImportException(
        HttpStatus.BAD_REQUEST,
        "개인 프로젝트에는 이슈를 가져올 수 없습니다.",
        Map.of("reason", "IMPORT_PERSONAL_PROJECT"));
  }

  /** 이 프로젝트 멤버가 아니거나 이 워크스페이스에서 활성이 아닌 username — 맞지 않은 것을 모두 담는다. */
  public static IssueImportException unknownUsers(List<String> usernames) {
    String joined = String.join(",", usernames);
    return new IssueImportException(
        HttpStatus.BAD_REQUEST,
        "프로젝트 멤버가 아니거나 활성이 아닌 사용자가 있습니다: " + joined,
        Map.of("reason", "IMPORT_UNKNOWN_USERS", "usernames", joined));
  }

  /** 지정한 이슈 번호가 이미 쓰이고 있다. */
  public static IssueImportException numberTaken(int number) {
    return new IssueImportException(
        HttpStatus.CONFLICT,
        "이미 사용 중인 이슈 번호입니다: " + number,
        Map.of("reason", "IMPORT_NUMBER_TAKEN", "number", String.valueOf(number)));
  }

  /** 같은 원본 키로 이미 가져온 이슈가 있다. */
  public static IssueImportException sourceKeyTaken(String sourceKey) {
    return new IssueImportException(
        HttpStatus.CONFLICT,
        "이미 가져온 원본 키입니다: " + sourceKey,
        Map.of("reason", "IMPORT_SOURCE_KEY_TAKEN", "sourceKey", sourceKey));
  }

  /** 시각 값이 서로 맞지 않는다(예: 수정 시각이 생성 시각보다 앞). */
  public static IssueImportException invalidTimes(String detail) {
    return new IssueImportException(
        HttpStatus.BAD_REQUEST,
        "시각 값이 올바르지 않습니다: " + detail,
        Map.of("reason", "IMPORT_INVALID_TIMES", "detail", detail));
  }

  /** 변경 이력 항목이 올바르지 않다 — 몇 번째인지 함께 알린다(0부터). */
  public static IssueImportException invalidHistory(int index, String detail) {
    return new IssueImportException(
        HttpStatus.BAD_REQUEST,
        "변경 이력 " + index + "번째 항목이 올바르지 않습니다: " + detail,
        Map.of(
            "reason", "IMPORT_INVALID_HISTORY", "index", String.valueOf(index), "detail", detail));
  }

  /** 프로젝트에 없는 라벨 이름. */
  public static IssueImportException unknownLabels(List<String> names) {
    String joined = String.join(",", names);
    return new IssueImportException(
        HttpStatus.BAD_REQUEST,
        "프로젝트에 없는 라벨이 있습니다: " + joined,
        Map.of("reason", "IMPORT_UNKNOWN_LABELS", "labels", joined));
  }

  @Override
  public HttpStatus status() {
    return status;
  }

  @Override
  public Map<String, String> errors() {
    return errors;
  }
}
