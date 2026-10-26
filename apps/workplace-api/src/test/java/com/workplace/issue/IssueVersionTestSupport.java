package com.workplace.issue;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.test.web.servlet.ResultActions;

/** 이슈 버전(WP-888) 통합 테스트 공용 바탕 — 구성요소 테스트의 프로젝트·계정·이슈 헬퍼를 그대로 쓰고, 버전 시드·보관·교체 헬퍼를 더한다. */
abstract class IssueVersionTestSupport extends IssueComponentTestSupport {

  /** 버전 시드(관리 API 는 별도 테스트가 검증했으므로 여기선 직접 넣는다). */
  long version(String name) {
    return dsl.fetchOne(
            "INSERT INTO project_version (project_id, name) VALUES (?, ?) RETURNING id",
            projectId,
            name)
        .get(0, Long.class);
  }

  /** 버전 보관. */
  void archiveVersion(long id) {
    dsl.execute("UPDATE project_version SET archived_at = now() WHERE id = ?", id);
  }

  /** 버전 출시. */
  void releaseVersion(long id) {
    dsl.execute("UPDATE project_version SET released_at = now() WHERE id = ?", id);
  }

  /** PUT /issues/{number}/versions — null 인 종류는 키를 보내지 않는다(그 종류 유지). */
  ResultActions replaceVersions(long caller, int number, List<Long> fix, List<Long> affects)
      throws Exception {
    var body = new LinkedHashMap<String, Object>();
    if (fix != null) body.put("fixVersionIds", fix);
    if (affects != null) body.put("affectsVersionIds", affects);
    return call(
        put("/api/v1/projects/" + key + "/issues/" + number + "/versions")
            .content(om.writeValueAsString(Map.copyOf(body))),
        caller);
  }
}
