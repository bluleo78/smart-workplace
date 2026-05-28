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

  /** username[] → user.id[] (active 만, 같은 프로젝트 한정은 caller 가 별도 필터 책임). */
  public List<Long> resolveUsernamesToIds(List<String> usernames) {
    if (usernames == null || usernames.isEmpty()) return List.of();
    return dsl.select(USER.ID)
        .from(USER)
        .where(USER.USERNAME.in(usernames))
        .fetch(r -> r.get(USER.ID));
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
