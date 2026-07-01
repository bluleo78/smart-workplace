package com.workplace.project.service;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;

import com.workplace.project.dto.ProjectRow;
import java.util.UUID;
import org.jooq.DSLContext;

/**
 * OPEN 프로젝트 관련 통합 테스트용 픽스처 헬퍼. 테넌트 GUC 가 주입된 트랜잭션 안에서 호출해야 RLS 를 통과한다(@Transactional 테스트 안에서 사용).
 */
public final class OpenFixtures {

  private OpenFixtures() {}

  /**
   * 지정 ownerId 소유의 OPEN 프로젝트를 삽입하고 결과를 반환한다. key 는 자동 생성(유니크)하여 병렬 테스트 간 충돌을 방지한다.
   *
   * @param dsl jOOQ DSLContext (테스트 스프링 컨텍스트에서 주입받은 것)
   * @param tenantId 현재 테넌트 ID (RLS GUC 에 이미 세팅되어 있어야 함)
   * @param ownerId 소유자 user.id
   * @return ProjectRow 와 key 를 담은 FixtureResult
   */
  public static FixtureResult openProject(DSLContext dsl, long tenantId, long ownerId) {
    String key =
        ("OP" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6))
            .substring(0, 8);
    // project.tenant_id 는 DEFAULT(GUC) 사용 — RLS 가 올바른 테넌트에 배치
    var rec =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, key)
            .set(PROJECT.NAME, "공개접수함-" + key)
            .set(PROJECT.OWNER_ID, ownerId)
            .set(PROJECT.TYPE, "OPEN")
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

    ProjectRow row =
        new ProjectRow(
            rec.get(PROJECT.ID),
            rec.get(PROJECT.KEY),
            rec.get(PROJECT.NAME),
            rec.get(PROJECT.DESCRIPTION),
            rec.get(PROJECT.OWNER_ID),
            rec.get(PROJECT.TYPE),
            Boolean.TRUE.equals(rec.get(PROJECT.IS_DEFAULT)),
            rec.get(PROJECT.CREATED_AT).toInstant(),
            rec.get(PROJECT.UPDATED_AT).toInstant());

    return new FixtureResult(row);
  }

  /**
   * 어떤 프로젝트에도 소속되지 않은 일반 사용자를 삽입하고 ID 를 반환한다. 비멤버 유저 역할 검증에 사용한다.
   *
   * @param dsl jOOQ DSLContext
   * @param tenantId 현재 테넌트 ID (user 테이블은 RLS 없이 tenant_id 컬럼으로 격리됨)
   * @return 생성된 user.id
   */
  public static long member(DSLContext dsl, long tenantId) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "open-u-" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "오픈유저-" + suffix)
        .set(USER.EMAIL, "open-u-" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** openProject() 결과 보관 레코드. */
  public record FixtureResult(ProjectRow row) {
    public String key() {
      return row.key();
    }
  }
}
