package com.workplace.issue.repository;

import static com.workplace.jooq.tables.IssueAiSummary.ISSUE_AI_SUMMARY;

import com.workplace.issue.dto.IssueAiSummaryRecord;
import java.util.Optional;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * issue_ai_summary 테이블 jOOQ 접근.
 *
 * <p>tenant_id 는 INSERT 시 DB의 GUC DEFAULT(app.tenant_id)가 자동으로 채운다. 애플리케이션에서 명시하지 않는다(V103 calendar
 * 패턴). RLS FORCE 로 인해 GUC 가 주입된 트랜잭션 안에서만 읽기/쓰기 가능.
 */
@Repository
public class IssueAiSummaryRepository {

  private final DSLContext dsl;

  public IssueAiSummaryRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /**
   * 이슈당 1행 upsert. 이미 행이 있으면 summary/next_action/generated_at 을 덮어쓴다. tenant_id 는 INSERT 시 GUC
   * DEFAULT 로 채워지며, ON CONFLICT 경로에서도 변경하지 않는다.
   *
   * @param issueId 대상 이슈 PK
   * @param summary AI 생성 요약
   * @param nextAction AI 추천 다음 행동 (null 허용)
   */
  public void upsert(long issueId, String summary, String nextAction) {
    dsl.insertInto(ISSUE_AI_SUMMARY)
        .set(ISSUE_AI_SUMMARY.ISSUE_ID, issueId)
        .set(ISSUE_AI_SUMMARY.SUMMARY, summary)
        .set(ISSUE_AI_SUMMARY.NEXT_ACTION, nextAction)
        .onConflict(ISSUE_AI_SUMMARY.ISSUE_ID)
        .doUpdate()
        .set(ISSUE_AI_SUMMARY.SUMMARY, summary)
        .set(ISSUE_AI_SUMMARY.NEXT_ACTION, nextAction)
        .set(ISSUE_AI_SUMMARY.GENERATED_AT, DSL.currentOffsetDateTime())
        .execute();
  }

  /**
   * 이슈 요약 단건 조회. GUC 미주입 시 RLS 가 행을 가려 empty 반환.
   *
   * @param issueId 조회할 이슈 PK
   * @return 저장된 요약(없으면 empty)
   */
  public Optional<IssueAiSummaryRecord> find(long issueId) {
    return dsl.selectFrom(ISSUE_AI_SUMMARY)
        .where(ISSUE_AI_SUMMARY.ISSUE_ID.eq(issueId))
        .fetchOptional()
        .map(
            r ->
                new IssueAiSummaryRecord(
                    r.getIssueId(),
                    r.getSummary(),
                    r.getNextAction(),
                    r.getGeneratedAt().toInstant()));
  }

  /**
   * 이슈 삭제 시 연쇄 삭제(ON DELETE CASCADE)로 자동 처리되나, 테스트 정리용 명시적 삭제도 제공한다.
   *
   * @param issueId 삭제할 이슈 PK
   */
  public void deleteByIssue(long issueId) {
    dsl.deleteFrom(ISSUE_AI_SUMMARY).where(ISSUE_AI_SUMMARY.ISSUE_ID.eq(issueId)).execute();
  }
}
