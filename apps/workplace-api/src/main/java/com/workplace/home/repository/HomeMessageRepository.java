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
   * @param contentBlocksJson 표시 블록 순서 JSON(ASSISTANT 전용, WP-158). null 이면 content_blocks 컬럼을 null 로
   *     저장.
   */
  public long insert(
      UUID sessionId,
      String role,
      String content,
      String widgetsJson,
      String toolCallsJson,
      String contentBlocksJson) {
    return dsl.insertInto(HOME_MESSAGE)
        .set(HOME_MESSAGE.SESSION_ID, sessionId)
        .set(HOME_MESSAGE.ROLE, role)
        .set(HOME_MESSAGE.CONTENT, content)
        .set(HOME_MESSAGE.WIDGETS, widgetsJson == null ? null : JSONB.valueOf(widgetsJson))
        .set(HOME_MESSAGE.TOOL_CALLS, toolCallsJson == null ? null : JSONB.valueOf(toolCallsJson))
        .set(
            HOME_MESSAGE.CONTENT_BLOCKS,
            contentBlocksJson == null ? null : JSONB.valueOf(contentBlocksJson))
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
            HOME_MESSAGE.CONTENT_BLOCKS,
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
                    r.get(HOME_MESSAGE.CONTENT_BLOCKS) == null
                        ? null
                        : r.get(HOME_MESSAGE.CONTENT_BLOCKS).data(),
                    r.get(HOME_MESSAGE.CREATED_AT).toInstant()));
  }

  /**
   * 채팅 맥락용 경량 조회(WP-232) — 경계(uptoId) 이후 메시지의 id·role·content 만 생성순(findBySession 과 동일 정렬)으로 읽는다.
   * 맥락 구성은 위젯·도구단계·표시블록 JSON 이 필요 없고 요약 경계 이전 메시지는 버리므로, 전체 조회(findBySession) 대신 쓴다.
   *
   * @param uptoId 누적 요약이 덮은 마지막 메시지 id. null 이면(요약 없음) 경계 필터 없이 전체.
   */
  public List<ContextRow> findContextAfter(UUID sessionId, Long uptoId) {
    var cond = HOME_MESSAGE.SESSION_ID.eq(sessionId);
    if (uptoId != null) cond = cond.and(HOME_MESSAGE.ID.gt(uptoId));
    return dsl.select(HOME_MESSAGE.ID, HOME_MESSAGE.ROLE, HOME_MESSAGE.CONTENT)
        .from(HOME_MESSAGE)
        .where(cond)
        .orderBy(HOME_MESSAGE.CREATED_AT.asc(), HOME_MESSAGE.ID.asc())
        .fetch(r -> new ContextRow(r.value1(), r.value2(), r.value3()));
  }

  /** 채팅 맥락용 메시지 row(WP-232) — 맥락 구성에 필요한 필드만. */
  public record ContextRow(long id, String role, String content) {}

  /**
   * 메시지 단건 row.
   *
   * @param widgetsJson null 이거나 JSON 배열 문자열(위젯 스펙)
   * @param toolCallsJson null 이거나 JSON 배열 문자열(AI 도구 호출/위임 단계)
   * @param contentBlocksJson null 이거나 JSON 배열 문자열(표시 블록 순서, WP-158)
   */
  public record Row(
      long id,
      String role,
      String content,
      String widgetsJson,
      String toolCallsJson,
      String contentBlocksJson,
      java.time.Instant createdAt) {}
}
