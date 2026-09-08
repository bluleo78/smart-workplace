package com.workplace.issue.exception;

import java.util.Set;

/**
 * SELECT/MULTI_SELECT 필드의 옵션을 삭제하려는데, 그 옵션을 참조 중인 이슈가 1건 이상 있을 때 발생. user_role 삭제 가드(#678)와 동일한 하드
 * 블록 정책 — 참조가 남은 채로 옵션이 사라지면 issue_field_value 가 화이트리스트 밖 값을 조용히 들고 있는 orphan 상태가 되므로(#707), 먼저 해당
 * 이슈들의 값을 정리해야 옵션을 삭제할 수 있도록 강제한다.
 */
public class FieldOptionInUseException extends RuntimeException {
  public FieldOptionInUseException(int issueCount, Set<String> options) {
    super("%d건의 이슈가 참조 중인 옵션은 삭제할 수 없습니다: %s".formatted(issueCount, String.join(", ", options)));
  }
}
