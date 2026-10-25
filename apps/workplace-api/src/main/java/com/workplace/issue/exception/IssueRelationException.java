package com.workplace.issue.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 이슈 관계 유형·관계(WP-887) 거절 — 사유별로 상태와 {@code errors.code} 가 달라 관리 화면이 다음 행동(예: 「사용 중 — 옮기기/함께 삭제
 * 고르기」)을 가를 수 있다. 정적 팩토리로만 만든다.
 */
public class IssueRelationException extends RuntimeException implements CodedException {

  private final HttpStatus status;
  private final Map<String, String> errors;

  private IssueRelationException(HttpStatus status, String message, String code) {
    super(message);
    this.status = status;
    this.errors = Map.of("code", code);
  }

  /** 같은 이름(대소문자 무시, 기본 유형 이름 포함)이 이미 있다. */
  public static IssueRelationException nameTaken(String name) {
    return new IssueRelationException(
        HttpStatus.CONFLICT, "이미 있는 관계 유형 이름입니다: " + name, "RELATION_TYPE_NAME_TAKEN");
  }

  /** 사용자 정의 유형 상한(워크스페이스당 50개) 초과. */
  public static IssueRelationException limit(int max) {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST, "관계 유형은 최대 " + max + "개까지 추가할 수 있습니다.", "RELATION_TYPE_LIMIT");
  }

  /** 기본 유형은 편집·삭제할 수 없다(AI·MCP·가져오기가 코드로 부른다). */
  public static IssueRelationException builtIn() {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST, "기본 관계 유형은 편집하거나 삭제할 수 없습니다.", "RELATION_TYPE_BUILT_IN");
  }

  /** 차단(BLOCKS)은 숨길 수 없다 — 의존성 저장·블로커 계산이 이 유형에 기대고 있다. */
  public static IssueRelationException blocksLocked() {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST, "차단 유형은 숨길 수 없습니다.", "RELATION_TYPE_BLOCKS_LOCKED");
  }

  /** 쓰이는 관계가 있는 유형의 방향(있음↔없음)은 바꿀 수 없다. */
  public static IssueRelationException directionLocked() {
    return new IssueRelationException(
        HttpStatus.CONFLICT, "이미 쓰이는 관계 유형은 방향을 바꿀 수 없습니다.", "RELATION_TYPE_DIRECTION_LOCKED");
  }

  /** 쓰이는 관계가 있는데 옮길 곳도, 함께 삭제도 고르지 않았다. */
  public static IssueRelationException inUse(long count) {
    return new IssueRelationException(
        HttpStatus.CONFLICT,
        "이 유형을 쓰는 관계가 " + count + "건 있습니다. 다른 유형으로 옮기거나 관계도 함께 삭제하세요.",
        "RELATION_TYPE_IN_USE");
  }

  /** 옮길 대상이 올바르지 않다(자기 자신·차단·외부 전용·숨김·없음, 또는 옮기기와 함께 삭제를 동시에 지정). */
  public static IssueRelationException badMoveTarget(String reason) {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST, "옮길 수 없는 유형입니다: " + reason, "RELATION_TYPE_BAD_MOVE_TARGET");
  }

  /** 방향 없는 유형의 관계를 방향 있는 유형으로 옮기려 했다 — 방향이 임의로 정해지므로 거절. */
  public static IssueRelationException moveDirection() {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST,
        "방향 없는 유형의 관계는 방향 있는 유형으로 옮길 수 없습니다.",
        "RELATION_TYPE_MOVE_DIRECTION");
  }

  /** 방향 있는 유형인데 B 쪽 말이 비었다. */
  public static IssueRelationException inwardLabelRequired() {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST, "방향이 있는 유형은 상대 쪽 말이 필요합니다.", "RELATION_TYPE_INWARD_LABEL_REQUIRED");
  }

  /** 없는 관계 유형. */
  public static IssueRelationException notFound() {
    return new IssueRelationException(
        HttpStatus.NOT_FOUND, "관계 유형을 찾을 수 없습니다.", "RELATION_TYPE_NOT_FOUND");
  }

  // ── 관계 걸기·지우기(이슈 사이) ──────────────────────────────────────────────────────────

  /** 이슈 자신과는 관계를 걸 수 없다. */
  public static IssueRelationException self() {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST, "이슈 자신과는 관계를 걸 수 없습니다.", "RELATION_SELF");
  }

  /**
   * 상대 이슈가 없다 — 없는 프로젝트·번호, 삭제된 이슈, 읽을 수 없는 프로젝트의 이슈 모두 같은 말로 답한다(읽을 수 없는 프로젝트에 그 이슈가 있는지 드러내지
   * 않으려고).
   */
  public static IssueRelationException targetNotFound() {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST, "관계를 걸 이슈를 찾을 수 없습니다.", "RELATION_TARGET_NOT_FOUND");
  }

  /** 숨긴 유형으로는 새로 걸 수 없다(이미 걸린 관계는 그대로 보인다). */
  public static IssueRelationException typeHidden() {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST, "숨긴 관계 유형으로는 새로 걸 수 없습니다.", "RELATION_TYPE_HIDDEN");
  }

  /** 차단은 의존성(선행·후행)으로 건다 — 블로커 계산이 의존성 저장에 기대고 있어 관계 행으로 두지 않는다. */
  public static IssueRelationException typeBlocks() {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST, "차단 관계는 여기서 걸 수 없습니다. 의존성(선행·후행) 추가를 쓰세요.", "RELATION_TYPE_BLOCKS");
  }

  /** 외부 링크에만 쓰는 유형(상위 에픽)은 이슈 사이에 걸 수 없다. */
  public static IssueRelationException typeExternalOnly() {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST, "이 관계 유형은 외부 링크에만 쓸 수 있습니다.", "RELATION_TYPE_EXTERNAL_ONLY");
  }

  /** 개인 프로젝트 이슈는 같은 프로젝트 안에서만 관계를 맺는다(어느 쪽 끝도 다른 프로젝트일 수 없다). */
  public static IssueRelationException crossProjectNotAllowed() {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST,
        "개인 프로젝트 이슈는 같은 프로젝트 이슈와만 관계를 걸 수 있습니다.",
        "RELATION_CROSS_PROJECT_NOT_ALLOWED");
  }

  /** side 값은 source·target 만 받는다 — 오타가 반대 방향 관계로 저장되지 않게(WP-586 과 같은 이유). */
  public static IssueRelationException sideInvalid() {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST, "관계 방향은 source 또는 target 만 쓸 수 있습니다.", "RELATION_SIDE_INVALID");
  }

  /**
   * 방향 있는 유형인데 B 쪽 말이 없어(상위 에픽 등) 이 이슈를 B 쪽(side=target)으로 둘 수 없다 — 저장하면 이 이슈 쪽 말이 비어 화면·이력에 그릴 말이
   * 없다. 코드는 방향 값 오류와 같은 {@code RELATION_SIDE_INVALID}(화면은 방향을 고쳐 다시 보내면 된다).
   */
  public static IssueRelationException targetSideNotAllowed() {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST, "이 관계 유형은 상대 쪽(target)으로 걸 수 없습니다.", "RELATION_SIDE_INVALID");
  }

  // ── 외부 링크 ───────────────────────────────────────────────────────────────────────────

  /** 외부 링크 주소가 http/https 가 아니거나 호스트가 없거나 형식이 틀렸다(javascript:·data: 등이 저장되지 않게). */
  public static IssueRelationException externalLinkUrlInvalid() {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST, "외부 링크 주소는 http 또는 https 주소여야 합니다.", "EXTERNAL_LINK_URL_INVALID");
  }

  /** 같은 이슈에 같은 주소가 이미 다른 유형·방향으로 붙어 있다. */
  public static IssueRelationException externalLinkConflict() {
    return new IssueRelationException(
        HttpStatus.CONFLICT, "이미 같은 주소가 다른 관계로 붙어 있습니다. 그 링크를 수정하세요.", "EXTERNAL_LINK_CONFLICT");
  }

  /** 이슈당 외부 링크 상한(50개) 초과. */
  public static IssueRelationException externalLinkLimit(int max) {
    return new IssueRelationException(
        HttpStatus.BAD_REQUEST, "외부 링크는 이슈당 최대 " + max + "개까지 붙일 수 있습니다.", "EXTERNAL_LINK_LIMIT");
  }

  /** 없는 외부 링크(수정 대상). */
  public static IssueRelationException externalLinkNotFound() {
    return new IssueRelationException(
        HttpStatus.NOT_FOUND, "외부 링크를 찾을 수 없습니다.", "EXTERNAL_LINK_NOT_FOUND");
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
