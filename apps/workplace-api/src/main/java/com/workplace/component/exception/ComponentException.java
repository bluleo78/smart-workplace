package com.workplace.component.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 구성요소(WP-933) 거절 — 사유별로 상태와 {@code errors.code} 가 달라 화면·AI·가져오기 스크립트가 다음 행동을 가를 수 있다. 정적 팩토리로만
 * 만든다. GlobalExceptionHandler 의 {@link CodedException} 공용 처리기가 그대로 응답으로 옮긴다.
 */
public class ComponentException extends RuntimeException implements CodedException {

  private final HttpStatus status;
  private final Map<String, String> errors;

  private ComponentException(HttpStatus status, String message, String code) {
    super(message);
    this.status = status;
    this.errors = Map.of("code", code);
  }

  /** 같은 프로젝트에 같은 이름(대소문자 무시)이 이미 있다. */
  public static ComponentException nameTaken(String name) {
    return new ComponentException(
        HttpStatus.BAD_REQUEST, "이미 있는 구성요소 이름입니다: " + name, "COMPONENT_NAME_TAKEN");
  }

  /** 보관된 구성요소는 이슈에 새로 붙일 수 없다. */
  public static ComponentException archived(String name) {
    return new ComponentException(
        HttpStatus.BAD_REQUEST, "보관된 구성요소는 새로 붙일 수 없습니다: " + name, "COMPONENT_ARCHIVED");
  }

  /** 담당자는 프로젝트 멤버이면서 활성 상태인 사람이어야 한다(AI 제외). */
  public static ComponentException assigneeInvalid() {
    return new ComponentException(
        HttpStatus.BAD_REQUEST, "담당자는 프로젝트 구성원이면서 활성 상태인 사람이어야 합니다.", "COMPONENT_ASSIGNEE_INVALID");
  }

  /** 없는 구성요소(또는 다른 프로젝트의 구성요소). */
  public static ComponentException notFound() {
    return new ComponentException(HttpStatus.NOT_FOUND, "구성요소를 찾을 수 없습니다.", "COMPONENT_NOT_FOUND");
  }

  /**
   * 이슈에 붙이려는(또는 이슈를 만들며 고른) 구성요소 id 가 그 프로젝트에 없다 — 요청 본문의 값이 잘못된 것이라 404 가 아닌 400 이다(라벨의 「다른 프로젝트
   * 라벨」 거절과 같은 결). 코드는 {@link #notFound()} 와 같아 클라이언트가 한 코드로 처리한다.
   */
  public static ComponentException notInProject() {
    return new ComponentException(
        HttpStatus.BAD_REQUEST, "이 프로젝트에 없는 구성요소입니다.", "COMPONENT_NOT_FOUND");
  }

  /** 프로젝트당 구성요소 상한 초과. */
  public static ComponentException limit(int max) {
    return new ComponentException(
        HttpStatus.BAD_REQUEST, "구성요소는 프로젝트당 최대 " + max + "개까지 추가할 수 있습니다.", "COMPONENT_LIMIT");
  }

  /** 개인 프로젝트에는 구성요소를 만들 수 없다(혼자 쓰는 프로젝트라 영역 담당자가 의미 없다). */
  public static ComponentException personalProject() {
    return new ComponentException(
        HttpStatus.BAD_REQUEST, "개인 프로젝트에는 구성요소를 추가할 수 없습니다.", "PERSONAL_PROJECT_UNSUPPORTED");
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
