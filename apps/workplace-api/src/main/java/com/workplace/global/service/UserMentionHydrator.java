package com.workplace.global.service;

import static com.workplace.jooq.Tables.USER;

import com.workplace.global.dto.MentionResponse;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

/** mention userIds → 검증/hydrate. USER 테이블 일괄 조회. chat·messaging 공용. */
@Component
@RequiredArgsConstructor
public class UserMentionHydrator {

  private final DSLContext dsl;

  /** mention id 후보 중 실제 존재하는 user.id 만 통과 (입력 순서 보존). */
  public List<Long> filterExistingUserIds(List<Long> ids) {
    if (ids == null || ids.isEmpty()) return List.of();
    Set<Long> existing = dsl.select(USER.ID).from(USER).where(USER.ID.in(ids)).fetchSet(USER.ID);
    return ids.stream().filter(existing::contains).toList();
  }

  /** mention id list → MentionResponse list (입력 순서 보존). 미존재 id 는 제외. */
  public List<MentionResponse> asMentionResponses(List<Long> userIds) {
    if (userIds == null || userIds.isEmpty()) return List.of();
    List<Long> normalized = userIds.stream().map(n -> ((Number) n).longValue()).toList();
    Map<Long, MentionResponse> map =
        dsl
            .select(USER.ID, USER.USERNAME, USER.NAME, USER.KIND)
            .from(USER)
            .where(USER.ID.in(normalized))
            .fetch(
                r ->
                    new MentionResponse(
                        r.get(USER.ID), r.get(USER.USERNAME), r.get(USER.NAME), r.get(USER.KIND)))
            .stream()
            .collect(Collectors.toMap(MentionResponse::id, Function.identity()));
    return normalized.stream().map(map::get).filter(Objects::nonNull).toList();
  }
}
