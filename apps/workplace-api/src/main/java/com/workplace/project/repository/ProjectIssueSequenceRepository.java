package com.workplace.project.repository;

import static com.workplace.jooq.Tables.PROJECT_ISSUE_SEQUENCE;

import com.workplace.project.exception.ProjectNotFoundException;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** project_issue_sequence 리포지토리. 프로젝트별 이슈 번호 카운터 발급. */
@Repository
@RequiredArgsConstructor
public class ProjectIssueSequenceRepository {

  private final DSLContext dsl;

  /** 프로젝트 생성 시 시퀀스 초기화 (next_number = 1). */
  public void initialize(Long projectId) {
    dsl.insertInto(PROJECT_ISSUE_SEQUENCE)
        .set(PROJECT_ISSUE_SEQUENCE.PROJECT_ID, projectId)
        .set(PROJECT_ISSUE_SEQUENCE.NEXT_NUMBER, 1)
        .execute();
  }

  /**
   * 다음 이슈 번호 발급. UPDATE ... RETURNING 으로 원자적 증가. 반환값은 발급된 번호(증가 후 - 1).
   *
   * @param projectId 프로젝트 ID
   * @return 발급된 이슈 번호
   */
  public int allocateNext(Long projectId) {
    return dsl.update(PROJECT_ISSUE_SEQUENCE)
            .set(PROJECT_ISSUE_SEQUENCE.NEXT_NUMBER, PROJECT_ISSUE_SEQUENCE.NEXT_NUMBER.plus(1))
            .where(PROJECT_ISSUE_SEQUENCE.PROJECT_ID.eq(projectId))
            .returning(PROJECT_ISSUE_SEQUENCE.NEXT_NUMBER)
            .fetchOptional()
            .orElseThrow(() -> new ProjectNotFoundException("이슈 시퀀스를 찾을 수 없습니다"))
            .getNextNumber()
        - 1;
  }
}
