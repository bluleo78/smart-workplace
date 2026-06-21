// IssueDriveLinkSourceResolver.java — ISSUE 백링크 라벨/딥링크/접근여부 해석
package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static org.jooq.impl.DSL.exists;
import static org.jooq.impl.DSL.selectOne;

import com.workplace.drive.api.DriveLinkSourceResolver;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * ISSUE 백링크 해석기. 라벨="KEY-번호 제목", 딥링크="/projects/KEY/issues/번호". accessible = 호출자가 해당 프로젝트 멤버인지
 * 여부(SELECT 절 EXISTS 산출 — WHERE 필터 아님). 미존재/soft-deleted 이슈는 결과 맵에서 제외(호출측에서 접근 불가로 처리).
 */
@Component
@RequiredArgsConstructor
public class IssueDriveLinkSourceResolver implements DriveLinkSourceResolver {

  private final DSLContext dsl;

  @Override
  public String sourceType() {
    return "ISSUE";
  }

  @Override
  @Transactional(readOnly = true)
  public Map<Long, Resolved> resolve(long callerId, Collection<Long> sourceIds) {
    if (sourceIds == null || sourceIds.isEmpty()) return Map.of();

    // accessible 은 SELECT 절 EXISTS 로 산출 — WHERE 필터가 아님(비멤버는 accessible=false 로 반환)
    Field<Boolean> accessible =
        DSL.field(
            exists(
                selectOne()
                    .from(PROJECT_MEMBER)
                    .where(
                        PROJECT_MEMBER
                            .PROJECT_ID
                            .eq(ISSUE.PROJECT_ID)
                            .and(PROJECT_MEMBER.USER_ID.eq(callerId)))));

    List<Long> ids = List.copyOf(sourceIds);
    Map<Long, Resolved> out = new HashMap<>();

    dsl.select(ISSUE.ID, PROJECT.KEY, ISSUE.NUMBER, ISSUE.TITLE, accessible)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(ISSUE.ID.in(ids))
        .and(ISSUE.DELETED_AT.isNull())
        .fetch(
            r -> {
              long issueId = r.get(ISSUE.ID);
              String key = r.get(PROJECT.KEY);
              int num = r.get(ISSUE.NUMBER);
              String title = r.get(ISSUE.TITLE);
              boolean acc = Boolean.TRUE.equals(r.get(accessible));
              String label = key + "-" + num + " " + title;
              String deepLink = "/projects/" + key + "/issues/" + num;
              out.put(issueId, new Resolved(label, deepLink, acc));
              return null;
            });

    return out;
  }
}
