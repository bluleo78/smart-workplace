package com.workplace.issue.exception;

/**
 * EPIC 이슈를 완료(DONE)로 전이하려는데 미완료 자식 이슈가 남아있을 때 발생 (#710). 자식 유형과 무관하게(SUBTASK 뿐 아니라 TASK 등 전체) 하나라도
 * 미완료면 차단한다 — silent-cascade 대신 hard-block 정책(#678, #707 선례와 동일).
 */
public class EpicHasIncompleteChildrenException extends RuntimeException {
  public EpicHasIncompleteChildrenException(String message) {
    super(message);
  }
}
