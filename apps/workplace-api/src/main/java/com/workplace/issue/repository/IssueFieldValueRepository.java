package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE_FIELD_DEF;
import static com.workplace.jooq.Tables.ISSUE_FIELD_VALUE;
import static org.jooq.impl.DSL.count;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.issue.dto.IssueFieldEntry;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.springframework.stereotype.Repository;

/**
 * issue_field_value jOOQ 리포지토리. JSONB ↔ JsonNode 변환을 캡슐화하고 단일 이슈 diff 조회, upsert/delete, 다중 이슈
 * batch 조회(N+1 회피) 를 제공한다.
 */
@Repository
@RequiredArgsConstructor
public class IssueFieldValueRepository {

  private final DSLContext dsl;
  private final ObjectMapper objectMapper;

  /** 단일 이슈의 모든 (defId → value) 맵 — diff 계산용. */
  public Map<Long, JsonNode> findValuesByIssue(Long issueId) {
    Map<Long, JsonNode> result = new HashMap<>();
    dsl.select(ISSUE_FIELD_VALUE.FIELD_DEF_ID, ISSUE_FIELD_VALUE.VALUE)
        .from(ISSUE_FIELD_VALUE)
        .where(ISSUE_FIELD_VALUE.ISSUE_ID.eq(issueId))
        .fetch()
        .forEach(
            r -> {
              try {
                result.put(r.value1(), objectMapper.readTree(r.value2().data()));
              } catch (Exception ignored) {
                // 파싱 실패 한 row 는 결과에서 제외 — diff 계산이 false-positive 가 되는 것을 막는다.
              }
            });
    return result;
  }

  /** ON CONFLICT 기반 upsert — (issueId, defId) PK 충돌 시 value 갱신. */
  public void upsert(Long issueId, Long defId, JsonNode value) {
    JSONB jsonb = JSONB.valueOf(value.toString());
    dsl.insertInto(ISSUE_FIELD_VALUE)
        .set(ISSUE_FIELD_VALUE.ISSUE_ID, issueId)
        .set(ISSUE_FIELD_VALUE.FIELD_DEF_ID, defId)
        .set(ISSUE_FIELD_VALUE.VALUE, jsonb)
        .set(ISSUE_FIELD_VALUE.UPDATED_AT, OffsetDateTime.now())
        .onConflict(ISSUE_FIELD_VALUE.ISSUE_ID, ISSUE_FIELD_VALUE.FIELD_DEF_ID)
        .doUpdate()
        .set(ISSUE_FIELD_VALUE.VALUE, jsonb)
        .set(ISSUE_FIELD_VALUE.UPDATED_AT, OffsetDateTime.now())
        .execute();
  }

  /** 단건 삭제. */
  public void delete(Long issueId, Long defId) {
    dsl.deleteFrom(ISSUE_FIELD_VALUE)
        .where(ISSUE_FIELD_VALUE.ISSUE_ID.eq(issueId).and(ISSUE_FIELD_VALUE.FIELD_DEF_ID.eq(defId)))
        .execute();
  }

  /**
   * N+1 회피 — issueIds → 각 이슈의 필드 엔트리 리스트. def join 으로 name/type 동시 fetch. 입력에 들어온 모든 issueId 에 대해 빈
   * 리스트로 초기화 후 채운다.
   */
  public Map<Long, List<IssueFieldEntry>> findByIssueIds(List<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    Map<Long, List<IssueFieldEntry>> result = new HashMap<>();
    for (Long id : issueIds) result.put(id, new ArrayList<>());
    dsl.select(
            ISSUE_FIELD_VALUE.ISSUE_ID,
            ISSUE_FIELD_VALUE.FIELD_DEF_ID,
            ISSUE_FIELD_VALUE.VALUE,
            ISSUE_FIELD_DEF.NAME,
            ISSUE_FIELD_DEF.TYPE)
        .from(ISSUE_FIELD_VALUE)
        .join(ISSUE_FIELD_DEF)
        .on(ISSUE_FIELD_DEF.ID.eq(ISSUE_FIELD_VALUE.FIELD_DEF_ID))
        .where(ISSUE_FIELD_VALUE.ISSUE_ID.in(issueIds))
        .orderBy(ISSUE_FIELD_DEF.POSITION.asc(), ISSUE_FIELD_DEF.ID.asc())
        .fetch()
        .forEach(
            r -> {
              try {
                JsonNode node = objectMapper.readTree(r.get(ISSUE_FIELD_VALUE.VALUE).data());
                result
                    .get(r.get(ISSUE_FIELD_VALUE.ISSUE_ID))
                    .add(
                        new IssueFieldEntry(
                            r.get(ISSUE_FIELD_VALUE.FIELD_DEF_ID),
                            r.get(ISSUE_FIELD_DEF.NAME),
                            r.get(ISSUE_FIELD_DEF.TYPE),
                            node));
              } catch (Exception ignored) {
                // 파싱 실패 row 는 응답에서 누락 — UI 에 깨진 값 노출 방지.
              }
            });
    return result;
  }

  /** 정의 사용 카운트 — 삭제 가드/통계용. */
  public int countByDef(Long defId) {
    Integer c =
        dsl.select(count())
            .from(ISSUE_FIELD_VALUE)
            .where(ISSUE_FIELD_VALUE.FIELD_DEF_ID.eq(defId))
            .fetchOne(0, Integer.class);
    return c == null ? 0 : c;
  }
}
