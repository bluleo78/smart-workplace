package com.workplace.home.repository;

import static com.workplace.jooq.Tables.AI_MEMORY;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
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
