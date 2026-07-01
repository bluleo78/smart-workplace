package com.workplace.issue.service;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.USER;

import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import java.util.UUID;
import org.jooq.DSLContext;

/**
 * OPEN(또는 TEAM) 프로젝트 조회 경로 통합 테스트용 시나리오 헬퍼. Task 4~9 가 공유한다.
 *
 * <p>한 번의 {@code create}/{@code createTeam} 호출로 다음을 테넌트 GUC 아래에서 시드하고(반드시 @Transactional +
 * TenantContext.set 안에서 호출), id/key/number 를 노출한다:
 *
 * <ul>
 *   <li>OPEN(또는 TEAM) 프로젝트 + OWNER(멤버 role=OWNER)
 *   <li>처리팀 MEMBER(멤버 role=MEMBER)
 *   <li>reporter — 비멤버(멤버 행 없음). OPEN 이슈를 자신이 생성한 상황을 재현
 *   <li>stranger — 비멤버(멤버 행 없음)
 *   <li>reporter 가 생성한 이슈 1건(number 노출)
 * </ul>
 *
 * <p>이슈는 {@code issueService.create} 가 아닌 {@code issueRepository.insert} 로 직접 시드한다 — create() 는 여전히
 * assertMember 가드라 비멤버 reporter 로는 생성할 수 없고, reporter 가 멤버가 되면 viewerCanEditWorkflow 검증이 무의미해지기
 * 때문이다. 시스템 유형(TASK)은 {@link IssueTypeService#seedSystemTypes} 로 시드한 뒤 7-인자 insert 가 TASK 로 자동
 * fallback.
 */
public final class OpenScenario {

  private OpenScenario() {}

  /** OPEN 프로젝트 시나리오 시드. */
  public static Result create(
      DSLContext dsl,
      IssueTypeService types,
      IssueRepository issues,
      ProjectIssueSequenceRepository sequences,
      long tenantId) {
    return seed("OPEN", dsl, types, issues, sequences, tenantId);
  }

  /** TEAM 프로젝트 시나리오 시드(비멤버 접근 거부 검증용). */
  public static Result createTeam(
      DSLContext dsl,
      IssueTypeService types,
      IssueRepository issues,
      ProjectIssueSequenceRepository sequences,
      long tenantId) {
    return seed("TEAM", dsl, types, issues, sequences, tenantId);
  }

  /** 공통 시드 로직. type 만 다르다. */
  private static Result seed(
      String type,
      DSLContext dsl,
      IssueTypeService types,
      IssueRepository issues,
      ProjectIssueSequenceRepository sequences,
      long tenantId) {
    // 사용자 5인: owner / member(처리팀) / reporter(비멤버) / stranger(비멤버)
    long ownerId = seedUser(dsl, "os-owner");
    long memberId = seedUser(dsl, "os-member");
    long reporterId = seedUser(dsl, "os-reporter");
    long strangerId = seedUser(dsl, "os-stranger");

    // 프로젝트 삽입 (tenant_id 는 DEFAULT(GUC))
    ProjectRow project = insertProject(dsl, type, ownerId);

    // 멤버 행: owner=OWNER, member=MEMBER. reporter/stranger 는 멤버 행 없음(비멤버).
    insertMember(dsl, project.id(), ownerId, "OWNER");
    insertMember(dsl, project.id(), memberId, "MEMBER");

    // 시스템 유형 시드(TASK 포함) → 7-인자 insert 가 TASK 로 자동 fallback.
    types.seedSystemTypes(project.id());

    // 이슈 시퀀스 초기화(raw-DSL 프로젝트 삽입이라 create() 경로의 initialize 를 대신 호출).
    sequences.initialize(project.id());

    // reporter(비멤버)가 생성한 이슈 1건을 직접 삽입(create() 가드 우회).
    int number = sequences.allocateNext(project.id());
    var row = issues.insert(project.id(), number, "접수 문의", "본문", "MID", null, reporterId);

    return new Result(project, ownerId, memberId, reporterId, strangerId, row.id(), row.number());
  }

  /** 유니크 username HUMAN 사용자 시드. */
  private static long seedUser(DSLContext dsl, String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "-" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix)
        .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 지정 type 의 프로젝트를 삽입하고 ProjectRow 를 반환한다. key 는 유니크 자동생성. */
  private static ProjectRow insertProject(DSLContext dsl, String type, long ownerId) {
    String key =
        ("OS" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6))
            .substring(0, 8);
    var rec =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, key)
            .set(PROJECT.NAME, "시나리오-" + key)
            .set(PROJECT.OWNER_ID, ownerId)
            .set(PROJECT.TYPE, type)
            .set(PROJECT.IS_DEFAULT, false)
            .returning(
                PROJECT.ID,
                PROJECT.KEY,
                PROJECT.NAME,
                PROJECT.DESCRIPTION,
                PROJECT.OWNER_ID,
                PROJECT.TYPE,
                PROJECT.IS_DEFAULT,
                PROJECT.CREATED_AT,
                PROJECT.UPDATED_AT)
            .fetchOne();
    return new ProjectRow(
        rec.get(PROJECT.ID),
        rec.get(PROJECT.KEY),
        rec.get(PROJECT.NAME),
        rec.get(PROJECT.DESCRIPTION),
        rec.get(PROJECT.OWNER_ID),
        rec.get(PROJECT.TYPE),
        Boolean.TRUE.equals(rec.get(PROJECT.IS_DEFAULT)),
        rec.get(PROJECT.CREATED_AT).toInstant(),
        rec.get(PROJECT.UPDATED_AT).toInstant());
  }

  /** project_member 행 삽입. */
  private static void insertMember(DSLContext dsl, Long projectId, long userId, String role) {
    dsl.insertInto(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.PROJECT_ID, projectId)
        .set(PROJECT_MEMBER.USER_ID, userId)
        .set(PROJECT_MEMBER.ROLE, role)
        .execute();
  }

  /**
   * 시나리오 시드 결과. Task 5~9 재사용을 위해 필요한 식별자를 모두 노출한다.
   *
   * @param project 생성된 프로젝트 row
   * @param ownerId OWNER 멤버 user.id
   * @param memberId 처리팀 MEMBER user.id
   * @param reporterId 이슈 생성자(비멤버) user.id
   * @param strangerId 비멤버·비reporter user.id
   * @param issueId 시드된 이슈 id
   * @param issueNumber 시드된 이슈 number(프로젝트 내)
   */
  public record Result(
      ProjectRow project,
      long ownerId,
      long memberId,
      long reporterId,
      long strangerId,
      long issueId,
      int issueNumber) {
    public String projectKey() {
      return project.key();
    }
  }
}
