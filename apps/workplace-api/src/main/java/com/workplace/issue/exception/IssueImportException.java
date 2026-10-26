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

  /** 프로젝트에 없는 구성요소 이름(WP-933) — 라벨과 달리 가져오기가 만들지 않으므로 먼저 일반 API 로 만들어 두어야 한다. */
  public static IssueImportException unknownComponents(List<String> names) {
    String joined = String.join(",", names);
    return new IssueImportException(
        HttpStatus.BAD_REQUEST,
        "프로젝트에 없는 구성요소가 있습니다: " + joined,
        Map.of("reason", "IMPORT_UNKNOWN_COMPONENTS", "components", joined));
  }

  /** 프로젝트에 없는 버전 이름(WP-888) — 가져오기가 만들지 않으므로 먼저 버전 API 로 만들어 두어야 한다. */
  public static IssueImportException unknownVersions(List<String> names) {
    String joined = String.join(",", names);
    return new IssueImportException(
        HttpStatus.BAD_REQUEST,
        "프로젝트에 없는 버전이 있습니다: " + joined,
        Map.of("reason", "IMPORT_UNKNOWN_VERSIONS", "versions", joined));
  }

  /** 외부 링크의 관계 유형 이름·코드를 찾을 수 없다. */
  public static IssueImportException unknownRelationType(String type) {
    return new IssueImportException(
        HttpStatus.BAD_REQUEST,
        "관계 유형을 찾을 수 없습니다: " + type,
        Map.of("reason", "IMPORT_UNKNOWN_RELATION_TYPE", "type", type));
  }

  /** 같은 요청 안에 같은 주소가 다른 유형·방향으로 두 번 나왔다 — 어느 쪽이 맞는지 알 수 없어 이슈를 만들기 전에 거절. */
  public static IssueImportException duplicateExternalLink(String url) {
    return new IssueImportException(
        HttpStatus.BAD_REQUEST,
        "같은 주소의 외부 링크가 서로 다른 유형·방향으로 중복되었습니다: " + url,
        Map.of("reason", "IMPORT_DUPLICATE_EXTERNAL_LINK", "url", url));
  }

  /** 외부 링크의 방향이 이 유형에서 쓸 수 없다 — 상대 쪽 말이 없는 방향 있는 유형(예: 상위 에픽)은 이 이슈가 A 쪽(source)으로만 건다. */
  public static IssueImportException relationSideNotAllowed(String type) {
    return new IssueImportException(
        HttpStatus.BAD_REQUEST,
        "이 관계 유형은 target 방향으로 걸 수 없습니다: " + type,
        Map.of("reason", "IMPORT_RELATION_SIDE_NOT_ALLOWED", "type", type));
  }

  /**
   * 관계 일괄의 틀린 줄들 — 전부 모아 한 번에 알린다. {@code rows} 는 {@code [{"index":4,"reason":"..."}]} 모양의 JSON
   * 문자열이다(응답 errors 는 문자열 값만 받는다). 하나라도 틀리면 아무것도 쓰지 않는다.
   */
  public static IssueImportException invalidRelations(String rowsJson, int count) {
    return new IssueImportException(
        HttpStatus.BAD_REQUEST,
        "올바르지 않은 관계가 " + count + "건 있습니다. 아무것도 가져오지 않았습니다.",
        Map.of("reason", "IMPORT_INVALID_RELATIONS", "rows", rowsJson));
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
