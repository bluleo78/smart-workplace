package com.workplace.version.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 버전(WP-888) 거절 — 사유별로 상태와 {@code errors.code} 가 달라 화면·AI 가 다음 행동을 가를 수 있다. 정적 팩토리로만 만든다.
 * GlobalExceptionHandler 의 {@link CodedException} 공용 처리기가 그대로 응답으로 옮긴다.
 */
public class VersionException extends RuntimeException implements CodedException {

  private final HttpStatus status;
  private final Map<String, String> errors;

  private VersionException(HttpStatus status, String message, String code) {
    super(message);
    this.status = status;
    this.errors = Map.of("code", code);
  }

  /** 같은 프로젝트에 같은 이름(대소문자 무시)이 이미 있다. */
  public static VersionException nameTaken(String name) {
    return new VersionException(
        HttpStatus.BAD_REQUEST, "이미 있는 버전 이름입니다: " + name, "VERSION_NAME_TAKEN");
  }

  /** 없는 버전(또는 다른 프로젝트의 버전). */
  public static VersionException notFound() {
    return new VersionException(HttpStatus.NOT_FOUND, "버전을 찾을 수 없습니다.", "VERSION_NOT_FOUND");
  }

  /** 이슈에 붙이려는 id 가 이 프로젝트에 없다(다른 프로젝트·없는 id) — 이슈 쓰기 본문의 잘못된 값이라 400. */
  public static VersionException notInProject() {
    return new VersionException(HttpStatus.BAD_REQUEST, "이 프로젝트에 없는 버전입니다.", "VERSION_NOT_FOUND");
  }

  /** 보관된 버전은 이슈에 새로 붙일 수 없다(이미 붙은 것은 그대로 둘 수 있다). */
  public static VersionException archived(String name) {
    return new VersionException(
        HttpStatus.BAD_REQUEST, "보관된 버전은 새로 붙일 수 없습니다: " + name, "VERSION_ARCHIVED");
  }

  /** 프로젝트당 버전 상한 초과. */
  public static VersionException limit(int max) {
    return new VersionException(
        HttpStatus.BAD_REQUEST, "버전은 프로젝트당 최대 " + max + "개까지 추가할 수 있습니다.", "VERSION_LIMIT");
  }

  /** 시작일이 출시 예정일보다 늦다. */
  public static VersionException invalidDates() {
    return new VersionException(
        HttpStatus.BAD_REQUEST, "시작일은 출시 예정일보다 늦을 수 없습니다.", "VERSION_INVALID_DATES");
  }

  /** 보관하지 않은 버전은 지울 수 없다 — 먼저 보관해야 한다(화면과 서버가 같이 막는다). */
  public static VersionException notArchived() {
    return new VersionException(
        HttpStatus.BAD_REQUEST, "보관한 버전만 삭제할 수 있습니다.", "VERSION_NOT_ARCHIVED");
  }

  /** 보관된 버전은 출시할 수 없다 — 먼저 복원해야 한다(출시 시각만 채워져 상태가 어긋나는 것을 막는다). */
  public static VersionException archived() {
    return new VersionException(
        HttpStatus.BAD_REQUEST, "보관된 버전은 출시할 수 없습니다. 먼저 복원하세요.", "VERSION_ARCHIVED");
  }

  /** 출시·삭제 때 이슈를 옮길 대상이 잘못됐다(자기 자신·다른 프로젝트·보관됨, 출시 때는 이미 출시됨). */
  public static VersionException moveTargetInvalid() {
    return new VersionException(
        HttpStatus.BAD_REQUEST, "이슈를 옮길 수 없는 버전입니다.", "VERSION_MOVE_TARGET_INVALID");
  }

  /** 개인 프로젝트에는 버전을 만들 수 없다. */
  public static VersionException personalProject() {
    return new VersionException(
        HttpStatus.BAD_REQUEST, "개인 프로젝트에는 버전을 추가할 수 없습니다.", "PERSONAL_PROJECT_UNSUPPORTED");
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
