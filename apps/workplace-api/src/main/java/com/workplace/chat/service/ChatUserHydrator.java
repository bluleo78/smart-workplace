package com.workplace.chat.service;

import static com.workplace.jooq.Tables.USER;

import com.workplace.global.dto.UserSummary;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

/** mention userIds → UserSummary[] hydration. USER 테이블 일괄 조회. */
@Component
@RequiredArgsConstructor
public class ChatUserHydrator {

  private final DSLContext dsl;

  /** 단건 UserSummary 조회. */
  public UserSummary summaryOf(long userId) {
    return dsl.select(USER.ID, USER.USERNAME, USER.NAME, USER.KIND)
        .from(USER)
        .where(USER.ID.eq(userId))
        .fetchOptional(
            r ->
                new UserSummary(
                    r.get(USER.ID), r.get(USER.USERNAME), r.get(USER.NAME), r.get(USER.KIND)))
        .orElseThrow(() -> new IllegalStateException("user not found: " + userId));
  }

  /** 다건 UserSummary 조회. 입력 순서는 보존하지 않음. */
  public List<UserSummary> summariesOf(List<Long> userIds) {
    if (userIds == null || userIds.isEmpty()) return List.of();
    return dsl.select(USER.ID, USER.USERNAME, USER.NAME, USER.KIND)
        .from(USER)
        .where(USER.ID.in(userIds))
        .fetch(
            r ->
                new UserSummary(
                    r.get(USER.ID), r.get(USER.USERNAME), r.get(USER.NAME), r.get(USER.KIND)));
  }
}
