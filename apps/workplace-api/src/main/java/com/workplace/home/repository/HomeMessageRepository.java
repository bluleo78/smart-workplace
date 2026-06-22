package com.workplace.home.repository;

import static com.workplace.jooq.Tables.HOME_MESSAGE;

import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.springframework.stereotype.Repository;

/** home_message 접근. widgets 는 raw JSON 문자열로 입출력(상위에서 직렬화). */
@Repository
@RequiredArgsConstructor
public class HomeMessageRepository {
  private final DSLContext dsl;

  /**
   * 메시지 삽입 후 생성된 id(bigserial) 반환.
   *
   * @param widgetsJson 위젯 스펙 JSON(ASSISTANT 전용). null 이면 widgets 컬럼을 null 로 저장.
   * @param toolCallsJson AI 도구 호출/위임 단계 JSON(ASSISTANT 전용). null 이면 tool_calls 컬럼을 null 로 저장.
   */
  public long insert(
      UUID sessionId, String role, String content, String widgetsJson, String toolCallsJson) {
    return dsl.insertInto(HOME_MESSAGE)
        .set(HOME_MESSAGE.SESSION_ID, sessionId)
        .set(HOME_MESSAGE.ROLE, role)
        .set(HOME_MESSAGE.CONTENT, content)
        .set(HOME_MESSAGE.WIDGETS, widgetsJson == null ? null : JSONB.valueOf(widgetsJson))
        .set(HOME_MESSAGE.TOOL_CALLS, toolCallsJson == null ? null : JSONB.valueOf(toolCallsJson))
        .returning(HOME_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /** 세션 내 메시지를 생성순(created_at asc, id asc)으로 전체 조회. */
  public List<Row> findBySession(UUID sessionId) {
    return dsl.select(
            HOME_MESSAGE.ID,
            HOME_MESSAGE.ROLE,
            HOME_MESSAGE.CONTENT,
            HOME_MESSAGE.WIDGETS,
            HOME_MESSAGE.TOOL_CALLS,
            HOME_MESSAGE.CREATED_AT)
        .from(HOME_MESSAGE)
        .where(HOME_MESSAGE.SESSION_ID.eq(sessionId))
        .orderBy(HOME_MESSAGE.CREATED_AT.asc(), HOME_MESSAGE.ID.asc())
        .fetch(
            r ->
                new Row(
                    r.get(HOME_MESSAGE.ID),
                    r.get(HOME_MESSAGE.ROLE),
                    r.get(HOME_MESSAGE.CONTENT),
                    r.get(HOME_MESSAGE.WIDGETS) == null ? null : r.get(HOME_MESSAGE.WIDGETS).data(),
                    r.get(HOME_MESSAGE.TOOL_CALLS) == null
                        ? null
                        : r.get(HOME_MESSAGE.TOOL_CALLS).data(),
                    r.get(HOME_MESSAGE.CREATED_AT).toInstant()));
  }

  /**
   * 메시지 단건 row.
   *
   * @param widgetsJson null 이거나 JSON 배열 문자열(위젯 스펙)
   * @param toolCallsJson null 이거나 JSON 배열 문자열(AI 도구 호출/위임 단계)
   */
  public record Row(
      long id,
      String role,
      String content,
      String widgetsJson,
      String toolCallsJson,
      java.time.Instant createdAt) {}
}
