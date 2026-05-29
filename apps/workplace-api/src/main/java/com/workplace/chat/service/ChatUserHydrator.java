package com.workplace.chat.service;

import static com.workplace.jooq.Tables.USER;

import com.workplace.chat.dto.ChatMentionResponse;
import com.workplace.global.dto.UserSummary;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

/** mention userIds → ChatMentionResponse[] / UserSummary[] hydration. USER 테이블 일괄 JOIN. */
@Component
@RequiredArgsConstructor
public class ChatUserHydrator {

  private final DSLContext dsl;

  /** mention id list → ChatMentionResponse list (입력 순서 보존). 미존재 id 는 결과에서 제외. */
  public List<ChatMentionResponse> asMentionResponses(List<Long> userIds) {
    if (userIds == null || userIds.isEmpty()) return List.of();
    // Number → Long 안전 변환 (Jackson 으로 역직렬화된 mention id 가 Integer 일 수 있음)
    List<Long> normalized = userIds.stream().map(n -> ((Number) n).longValue()).toList();
    Map<Long, ChatMentionResponse> map =
        dsl
            .select(USER.ID, USER.USERNAME, USER.NAME, USER.KIND)
            .from(USER)
            .where(USER.ID.in(normalized))
            .fetch(
                r ->
                    new ChatMentionResponse(
                        r.get(USER.ID), r.get(USER.USERNAME), r.get(USER.NAME), r.get(USER.KIND)))
            .stream()
            .collect(Collectors.toMap(ChatMentionResponse::id, Function.identity()));
    return normalized.stream().map(map::get).filter(Objects::nonNull).toList();
  }

  /** mention id 후보 중 실제 존재하는 user.id 만 통과 (입력 순서 보존, 입력은 파서가 이미 dedup). */
  public List<Long> filterExistingUserIds(List<Long> ids) {
    if (ids == null || ids.isEmpty()) return List.of();
    java.util.Set<Long> existing =
        dsl.select(USER.ID).from(USER).where(USER.ID.in(ids)).fetchSet(USER.ID);
    return ids.stream().filter(existing::contains).toList();
  }

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
