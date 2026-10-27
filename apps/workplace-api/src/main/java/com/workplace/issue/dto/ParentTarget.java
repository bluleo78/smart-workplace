package com.workplace.issue.dto;

import com.workplace.issue.domain.IssueKeys;
import com.workplace.issue.exception.InvalidParentException;

/**
 * 부모로 지정할 이슈 — 같은 프로젝트 번호(parentNumber) 또는 이슈 키(parentKey, 다른 프로젝트 에픽 지정용, WP-1038)를 한 모양으로 모은다.
 *
 * @param projectKey 부모가 다른 프로젝트에 있으면 그 키(대문자). 같은 프로젝트면 null — 키로 받았더라도 자식과 같은 프로젝트면 null 로 맞춰, 같은
 *     프로젝트 부모 검증이 예전과 똑같이 돌게 한다
 * @param number 부모 이슈 번호
 */
public record ParentTarget(String projectKey, int number) {

  /** 부모가 자식과 다른 프로젝트에 있는가. */
  public boolean crossProject() {
    return projectKey != null;
  }

  /**
   * 요청의 parentNumber·parentKey 를 하나로 합친다. 둘 다 없으면 null(부모 없음·해제). 둘 다 오면 같은 이슈(자식 프로젝트의 그 번호)를 가리켜야
   * 한다 — 서로 다른 이슈면 어느 쪽을 따를지 알 수 없어 400.
   *
   * @param childProjectKey 자식 이슈의 프로젝트 키 — 같은 프로젝트 키로 온 parentKey 를 번호 지정으로 맞추는 데 쓴다
   */
  public static ParentTarget of(Integer parentNumber, String parentKey, String childProjectKey) {
    if (parentKey == null || parentKey.isBlank()) {
      return parentNumber == null ? null : new ParentTarget(null, parentNumber);
    }
    var key =
        IssueKeys.parse(parentKey.strip())
            .orElseThrow(
                () -> new InvalidParentException("부모 이슈 키가 올바르지 않습니다: " + parentKey.strip()));
    boolean sameProject = key.projectKey().equalsIgnoreCase(childProjectKey);
    if (parentNumber != null && (!sameProject || parentNumber != key.number())) {
      throw new InvalidParentException("parentNumber 와 parentKey 가 서로 다른 이슈를 가리킵니다");
    }
    return new ParentTarget(sameProject ? null : key.projectKey(), key.number());
  }
}
