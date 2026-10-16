package com.workplace.home.repository;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static com.workplace.jooq.Tables.AI_MEMORY_FORGOTTEN;
import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static com.workplace.jooq.Tables.SHARED_AI_MEMORY;
import static com.workplace.jooq.Tables.SHARED_AI_MEMORY_FORGOTTEN;

import com.workplace.global.util.Texts;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * 임베딩 채우기용 접근(WP-383·384) — 임베딩할 텍스트 읽기·벡터 쓰기·백필 대상 찾기. RLS 가 테넌트를 거르므로 테넌트 트랜잭션 안에서 부른다. 벡터 컬럼은
 * jOOQ 가 Object 로 생성해 plain SQL {@code cast(? as vector)} 로 쓴다(WorkerJobRepository.applyEmbedResult
 * 와 같은 이유). search_tv 는 GENERATED 라 절대 쓰지 않는다.
 */
@Repository
@RequiredArgsConstructor
public class TextEmbeddingRepository {

  private final DSLContext dsl;

  /** 임베딩이 빈 메모리의 내용 — 이미 채웠거나 지워졌으면 null. */
  public String memoryText(long id) {
    return dsl.select(AI_MEMORY.CONTENT)
        .from(AI_MEMORY)
        .where(AI_MEMORY.ID.eq(id))
        .and(AI_MEMORY.EMBEDDING.isNull())
        .fetchOne(AI_MEMORY.CONTENT);
  }

  /** 메모리 임베딩 쓰기 — 내용이 읽은 그대로이고 아직 비어 있을 때만(그사이 고쳐졌으면 늦은 옛 임베딩을 버리고, 이미 채워졌으면 두 번 쓰지 않는다). 쓴 행 수. */
  public int writeMemory(long id, String content, String vectorLiteral) {
    return dsl.execute(
        "UPDATE ai_memory SET embedding = cast(? as vector)"
            + " WHERE id = ? AND content = ? AND embedding IS NULL",
        vectorLiteral,
        id,
        content);
  }

  /** 임베딩이 빈 메모리 id 오래된 순 limit 개 — 부분 인덱스 ai_memory_embedding_pending_idx. */
  public List<Long> pendingMemoryIds(int limit) {
    return dsl.select(AI_MEMORY.ID)
        .from(AI_MEMORY)
        .where(AI_MEMORY.EMBEDDING.isNull())
        .orderBy(AI_MEMORY.ID.asc())
        .limit(limit)
        .fetch(AI_MEMORY.ID);
  }

  /** 임베딩이 빈 지운 기록의 내용(WP-385) — 이미 채웠거나 지워졌으면 null. */
  public String forgottenText(long id) {
    return dsl.select(AI_MEMORY_FORGOTTEN.CONTENT)
        .from(AI_MEMORY_FORGOTTEN)
        .where(AI_MEMORY_FORGOTTEN.ID.eq(id))
        .and(AI_MEMORY_FORGOTTEN.EMBEDDING.isNull())
        .fetchOne(AI_MEMORY_FORGOTTEN.CONTENT);
  }

  /** 지운 기록 임베딩 쓰기 — 내용이 그대로이고 아직 비어 있을 때만. 쓴 행 수. */
  public int writeForgotten(long id, String content, String vectorLiteral) {
    return dsl.execute(
        "UPDATE ai_memory_forgotten SET embedding = cast(? as vector)"
            + " WHERE id = ? AND content = ? AND embedding IS NULL",
        vectorLiteral,
        id,
        content);
  }

  /** 임베딩이 빈 지운 기록 id 오래된 순 limit 개 — 부분 인덱스 ai_memory_forgotten_embedding_pending_idx. */
  public List<Long> pendingForgottenIds(int limit) {
    return dsl.select(AI_MEMORY_FORGOTTEN.ID)
        .from(AI_MEMORY_FORGOTTEN)
        .where(AI_MEMORY_FORGOTTEN.EMBEDDING.isNull())
        .orderBy(AI_MEMORY_FORGOTTEN.ID.asc())
        .limit(limit)
        .fetch(AI_MEMORY_FORGOTTEN.ID);
  }

  /** 임베딩이 빈 공용 메모리의 내용(WP-386) — 이미 채웠거나 지워졌으면 null. */
  public String sharedMemoryText(long id) {
    return dsl.select(SHARED_AI_MEMORY.CONTENT)
        .from(SHARED_AI_MEMORY)
        .where(SHARED_AI_MEMORY.ID.eq(id))
        .and(SHARED_AI_MEMORY.EMBEDDING.isNull())
        .fetchOne(SHARED_AI_MEMORY.CONTENT);
  }

  /** 공용 메모리 임베딩 쓰기 — 내용이 그대로이고 아직 비어 있을 때만. 쓴 행 수. */
  public int writeSharedMemory(long id, String content, String vectorLiteral) {
    return dsl.execute(
        "UPDATE shared_ai_memory SET embedding = cast(? as vector)"
            + " WHERE id = ? AND content = ? AND embedding IS NULL",
        vectorLiteral,
        id,
        content);
  }

  /** 임베딩이 빈 공용 메모리 id 오래된 순 limit 개 — 부분 인덱스 shared_ai_memory_embedding_pending_idx. */
  public List<Long> pendingSharedMemoryIds(int limit) {
    return dsl.select(SHARED_AI_MEMORY.ID)
        .from(SHARED_AI_MEMORY)
        .where(SHARED_AI_MEMORY.EMBEDDING.isNull())
        .orderBy(SHARED_AI_MEMORY.ID.asc())
        .limit(limit)
        .fetch(SHARED_AI_MEMORY.ID);
  }

  /** 임베딩이 빈 공간 지운 기록의 내용(WP-386) — 이미 채웠거나 지워졌으면 null. */
  public String sharedForgottenText(long id) {
    return dsl.select(SHARED_AI_MEMORY_FORGOTTEN.CONTENT)
        .from(SHARED_AI_MEMORY_FORGOTTEN)
        .where(SHARED_AI_MEMORY_FORGOTTEN.ID.eq(id))
        .and(SHARED_AI_MEMORY_FORGOTTEN.EMBEDDING.isNull())
        .fetchOne(SHARED_AI_MEMORY_FORGOTTEN.CONTENT);
  }

  /** 공간 지운 기록 임베딩 쓰기 — 내용이 그대로이고 아직 비어 있을 때만. 쓴 행 수. */
  public int writeSharedForgotten(long id, String content, String vectorLiteral) {
    return dsl.execute(
        "UPDATE shared_ai_memory_forgotten SET embedding = cast(? as vector)"
            + " WHERE id = ? AND content = ? AND embedding IS NULL",
        vectorLiteral,
        id,
        content);
  }

  /** 임베딩이 빈 공간 지운 기록 id 오래된 순 limit 개 — 부분 인덱스 shared_ai_memory_forgotten_embedding_pending_idx. */
  public List<Long> pendingSharedForgottenIds(int limit) {
    return dsl.select(SHARED_AI_MEMORY_FORGOTTEN.ID)
        .from(SHARED_AI_MEMORY_FORGOTTEN)
        .where(SHARED_AI_MEMORY_FORGOTTEN.EMBEDDING.isNull())
        .orderBy(SHARED_AI_MEMORY_FORGOTTEN.ID.asc())
        .limit(limit)
        .fetch(SHARED_AI_MEMORY_FORGOTTEN.ID);
  }

  /** 대화 턴 임베딩 입력 상한(WP-384) — 답이 길어도 앞부분이 질문과 답의 주제를 담는다. */
  public static final int TURN_INPUT_CHARS = 2_000;

  /** 대화 턴 임베딩 입력(WP-384) — 완료된 ASSISTANT 답과 같은 대화의 직전 USER 질문. 이미 채웠거나 대상(완료·비지 않은 답)이 아니면 null. */
  public String turnText(long messageId) {
    Record r =
        dsl.fetchOne(
            """
            SELECT a.content AS answer,
                   (SELECT u.content FROM home_message u
                     WHERE u.session_id = a.session_id AND u.role = 'USER' AND u.id < a.id
                     ORDER BY u.id DESC LIMIT 1) AS question
            FROM home_message a
            WHERE a.id = ? AND a.role = 'ASSISTANT' AND a.status = 'COMPLETE'
              AND a.embedding IS NULL AND a.content <> ''
            """,
            messageId);
    return r == null
        ? null
        : turnInput(r.get("question", String.class), r.get("answer", String.class));
  }

  /** 턴 입력 문자열 — "질문: {질문}\n답: {답}" 앞 2,000자(서로게이트 쌍을 가르지 않는다). */
  public static String turnInput(String question, String answer) {
    return Texts.headUtf16(
        "질문: " + (question == null ? "" : question) + "\n답: " + answer, TURN_INPUT_CHARS);
  }

  /** 턴 임베딩 쓰기 — 아직 비어 있을 때만(완료 답은 내용이 바뀌지 않으니 내용 조건은 없다). 쓴 행 수. */
  public int writeTurn(long messageId, String vectorLiteral) {
    return dsl.execute(
        "UPDATE home_message SET embedding = cast(? as vector) WHERE id = ? AND embedding IS NULL",
        vectorLiteral,
        messageId);
  }

  /** 임베딩이 빈 완료 답 id 오래된 순 limit 개 — 부분 인덱스 home_message_embedding_pending_idx. 빈 답은 대상이 아니다. */
  public List<Long> pendingTurnIds(int limit) {
    return dsl.select(HOME_MESSAGE.ID)
        .from(HOME_MESSAGE)
        .where(HOME_MESSAGE.ROLE.eq("ASSISTANT"))
        .and(HOME_MESSAGE.STATUS.eq("COMPLETE"))
        .and(HOME_MESSAGE.EMBEDDING.isNull())
        .and(HOME_MESSAGE.CONTENT.ne(""))
        .orderBy(HOME_MESSAGE.ID.asc())
        .limit(limit)
        .fetch(HOME_MESSAGE.ID);
  }

  /** float[] → pgvector 텍스트 리터럴 "[v1,v2,…]"(cast(? as vector) 바인딩용). */
  public static String vectorLiteral(float[] v) {
    StringBuilder sb = new StringBuilder("[");
    for (int i = 0; i < v.length; i++) {
      if (i > 0) sb.append(',');
      sb.append(v[i]);
    }
    return sb.append(']').toString();
  }
}
