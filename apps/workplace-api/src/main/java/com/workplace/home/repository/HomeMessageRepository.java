package com.workplace.home.repository;

import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static com.workplace.jooq.Tables.HOME_SESSION;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.impl.DSL;
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
   * @param status COMPLETE·STOPPED·FAILED(WP-190)
   */
  public long insert(
      UUID sessionId,
      String role,
      String content,
      String widgetsJson,
      String toolCallsJson,
      String contentBlocksJson,
      String status) {
    return dsl.insertInto(HOME_MESSAGE)
        .set(HOME_MESSAGE.SESSION_ID, sessionId)
        .set(HOME_MESSAGE.ROLE, role)
        .set(HOME_MESSAGE.CONTENT, content)
        .set(HOME_MESSAGE.WIDGETS, widgetsJson == null ? null : JSONB.valueOf(widgetsJson))
        .set(HOME_MESSAGE.TOOL_CALLS, toolCallsJson == null ? null : JSONB.valueOf(toolCallsJson))
        .set(
            HOME_MESSAGE.CONTENT_BLOCKS,
            contentBlocksJson == null ? null : JSONB.valueOf(contentBlocksJson))
        .set(HOME_MESSAGE.STATUS, status)
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
            HOME_MESSAGE.STATUS,
            HOME_MESSAGE.CREATED_AT,
            HOME_MESSAGE.FOLLOWUPS)
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
                    r.get(HOME_MESSAGE.STATUS),
                    r.get(HOME_MESSAGE.CREATED_AT).toInstant(),
                    r.get(HOME_MESSAGE.FOLLOWUPS) == null
                        ? null
                        : r.get(HOME_MESSAGE.FOLLOWUPS).data()));
  }

  /**
   * 후속 질문 저장(WP-139) — 그 세션의 ASSISTANT 메시지에만. 갱신 행 수 반환(0 = 그사이 대화가 지워졌거나 다른 세션의 id).
   *
   * @param followupsJson JSON 문자열 배열
   */
  public int updateFollowups(UUID sessionId, long messageId, String followupsJson) {
    return dsl.update(HOME_MESSAGE)
        .set(HOME_MESSAGE.FOLLOWUPS, JSONB.valueOf(followupsJson))
        .where(HOME_MESSAGE.ID.eq(messageId))
        .and(HOME_MESSAGE.SESSION_ID.eq(sessionId))
        .and(HOME_MESSAGE.ROLE.eq("ASSISTANT"))
        .execute();
  }

  /**
   * 되돌리기 대상(WP-55) — 호출자 소유 세션의 ASSISTANT 메시지를 행 잠금(FOR UPDATE OF home_message)으로 읽는다. 같은 결과 줄의 동시
   * 되돌리기가 이 잠금에서 줄을 서 두 번째가 첫 번째의 undone=true 를 본다. 다른 사용자·없는 id·USER 메시지는 empty(→ 404).
   */
  public Optional<OwnedBlocks> lockOwnedAssistant(long messageId, long userId) {
    return dsl.select(HOME_MESSAGE.CONTENT_BLOCKS)
        .from(HOME_MESSAGE)
        .join(HOME_SESSION)
        .on(HOME_SESSION.ID.eq(HOME_MESSAGE.SESSION_ID))
        .where(HOME_MESSAGE.ID.eq(messageId))
        .and(HOME_SESSION.USER_ID.eq(userId))
        .and(HOME_MESSAGE.ROLE.eq("ASSISTANT"))
        .forUpdate()
        .of(HOME_MESSAGE)
        .fetchOptional(r -> new OwnedBlocks(r.value1() == null ? null : r.value1().data()));
  }

  /** content_blocks 갱신(WP-55 되돌림 표시). lockOwnedAssistant 로 잠근 같은 트랜잭션에서만 부른다. */
  public int updateContentBlocks(long messageId, String contentBlocksJson) {
    return dsl.update(HOME_MESSAGE)
        .set(HOME_MESSAGE.CONTENT_BLOCKS, JSONB.valueOf(contentBlocksJson))
        .where(HOME_MESSAGE.ID.eq(messageId))
        .execute();
  }

  /** 잠근 메시지의 표시 블록 JSON(null 가능). */
  public record OwnedBlocks(String contentBlocksJson) {}

  /**
   * 채팅 맥락용 경량 조회(WP-232) — 경계(uptoId) 이후 메시지의 id·role·content 만 생성순(findBySession 과 동일 정렬)으로 읽는다.
   * 맥락 구성은 위젯·도구단계·표시블록 JSON 이 필요 없고 요약 경계 이전 메시지는 버리므로, 전체 조회(findBySession) 대신 쓴다.
   *
   * @param uptoId 누적 요약이 덮은 마지막 메시지 id. null 이면(요약 없음) 경계 필터 없이 전체.
   */
  public List<ContextRow> findContextAfter(UUID sessionId, Long uptoId) {
    var cond = HOME_MESSAGE.SESSION_ID.eq(sessionId);
    if (uptoId != null) cond = cond.and(HOME_MESSAGE.ID.gt(uptoId));
    // WP-55: 텍스트 전에 중단·오류로 끝났지만 메모리 결과 줄 때문에 저장된 빈 답(STOPPED·FAILED + 빈 본문)은 맥락에서 뺀다 — 빈 "AI:" 줄이
    // 실리거나, ai-agent 가 그 빈 답을 "마지막 AI 답" 으로 보아 앞선 미확인 승인 결과를 본 것으로 치지 않게. 채팅 이력·요약 입력이 모두
    // 이 조회를 거치므로 한 곳에서 거른다(COMPLETE 빈 답은 기존대로 둔다).
    cond =
        cond.andNot(
            HOME_MESSAGE
                .ROLE
                .eq("ASSISTANT")
                .and(DSL.trim(HOME_MESSAGE.CONTENT).eq(""))
                .and(HOME_MESSAGE.STATUS.ne("COMPLETE")));
    return dsl.select(HOME_MESSAGE.ID, HOME_MESSAGE.ROLE, HOME_MESSAGE.CONTENT)
        .from(HOME_MESSAGE)
        .where(cond)
        // 경계 필터(ID > upto)와 같은 기준인 id 순으로만 정렬한다 — created_at 은 트랜잭션 시작 시각이라 겹친 트랜잭션에서 id 와 순서가
        // 뒤바뀔 수 있고, 그러면 경계 앞뒤가 엇갈려 어떤 메시지는 요약에도 원문에도 실리지 않는다.
        .orderBy(HOME_MESSAGE.ID.asc())
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
   * @param status 답변 종결 상태 — COMPLETE·STOPPED·FAILED(WP-190)
   * @param followupsJson null 이거나 JSON 문자열 배열(후속 질문, WP-139)
   */
  public record Row(
      long id,
      String role,
      String content,
      String widgetsJson,
      String toolCallsJson,
      String contentBlocksJson,
      String status,
      java.time.Instant createdAt,
      String followupsJson) {}
}
