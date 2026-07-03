package com.workplace.project.repository;

import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static org.jooq.impl.DSL.count;

import com.workplace.project.dto.MemberResponse;
import com.workplace.project.dto.MemberRow;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/** project_member 테이블 리포지토리. */
@Repository
@RequiredArgsConstructor
public class ProjectMemberRepository {

  private final DSLContext dsl;

  /** SELECT 결과 → MemberRow (USER JOIN 없음). */
  private MemberRow mapToRow(Record r) {
    OffsetDateTime created = r.get(PROJECT_MEMBER.CREATED_AT);
    return new MemberRow(
        r.get(PROJECT_MEMBER.PROJECT_ID),
        r.get(PROJECT_MEMBER.USER_ID),
        r.get(PROJECT_MEMBER.ROLE),
        created != null ? created.toInstant() : null);
  }

  /** 특정 프로젝트의 단일 멤버 조회. */
  public Optional<MemberRow> find(Long projectId, Long userId) {
    return dsl.select(
            PROJECT_MEMBER.PROJECT_ID,
            PROJECT_MEMBER.USER_ID,
            PROJECT_MEMBER.ROLE,
            PROJECT_MEMBER.CREATED_AT)
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .fetchOptional(this::mapToRow);
  }

  /** USER JOIN 결과 → MemberResponse. findAllByProject / findMemberWithUser 공유. */
  private MemberResponse mapToMemberResponse(Record r) {
    OffsetDateTime created = r.get(PROJECT_MEMBER.CREATED_AT);
    return new MemberResponse(
        r.get(PROJECT_MEMBER.USER_ID),
        r.get(USER.USERNAME),
        r.get(USER.NAME),
        r.get(USER.KIND),
        r.get(PROJECT_MEMBER.ROLE),
        created != null ? created.toInstant() : null,
        r.get(USER.IS_ACTIVE));
  }

  /** 프로젝트의 전체 멤버를 USER JOIN 하여 username/name/kind/active 포함된 응답으로 조회. created_at 오름차순. */
  public List<MemberResponse> findAllByProject(Long projectId) {
    return dsl.select(
            PROJECT_MEMBER.USER_ID,
            USER.USERNAME,
            USER.NAME,
            USER.KIND,
            PROJECT_MEMBER.ROLE,
            PROJECT_MEMBER.CREATED_AT,
            USER.IS_ACTIVE)
        .from(PROJECT_MEMBER)
        .join(USER)
        .on(USER.ID.eq(PROJECT_MEMBER.USER_ID))
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId))
        .orderBy(PROJECT_MEMBER.CREATED_AT.asc())
        .fetch(this::mapToMemberResponse);
  }

  /** username/name/kind/active 까지 채워진 멤버 단건 조회. addMember/updateMemberRole 응답에 사용. */
  public Optional<MemberResponse> findMemberWithUser(Long projectId, Long userId) {
    return dsl.select(
            PROJECT_MEMBER.USER_ID,
            USER.USERNAME,
            USER.NAME,
            USER.KIND,
            PROJECT_MEMBER.ROLE,
            PROJECT_MEMBER.CREATED_AT,
            USER.IS_ACTIVE)
        .from(PROJECT_MEMBER)
        .join(USER)
        .on(USER.ID.eq(PROJECT_MEMBER.USER_ID))
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .fetchOptional(this::mapToMemberResponse);
  }

  /** 멤버 추가. */
  public void insert(Long projectId, Long userId, String role) {
    dsl.insertInto(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.PROJECT_ID, projectId)
        .set(PROJECT_MEMBER.USER_ID, userId)
        .set(PROJECT_MEMBER.ROLE, role)
        .execute();
  }

  /** 멤버 역할 변경. */
  public void updateRole(Long projectId, Long userId, String role) {
    dsl.update(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.ROLE, role)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /** 멤버 제거. */
  public void delete(Long projectId, Long userId) {
    dsl.deleteFrom(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /** 프로젝트의 OWNER 멤버 수. 마지막 OWNER 보호 체크에 사용. */
  public long countOwners(Long projectId) {
    return dsl.select(count())
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.ROLE.eq("OWNER")))
        .fetchOne(0, Long.class);
  }

  /** 프로젝트 멤버의 user_id 목록. 담당자 멤버십 검증 등에서 IN 셋 비교에 사용. */
  public List<Long> findUserIdsByProject(Long projectId) {
    return dsl.select(PROJECT_MEMBER.USER_ID)
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId))
        .fetch(PROJECT_MEMBER.USER_ID);
  }

  /** 사용자의 프로젝트 멤버 여부. */
  public boolean isMember(Long projectId, Long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(PROJECT_MEMBER)
            .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId))));
  }

  /**
   * 여러 프로젝트의 멤버 이름을 created_at asc 순으로 한 쿼리에 모은다(N+1 회피).
   *
   * @return projectId → 멤버 이름 리스트(가입순)
   */
  public java.util.Map<Long, java.util.List<String>> findMemberNamesByProjects(
      java.util.List<Long> projectIds) {
    java.util.Map<Long, java.util.List<String>> result = new java.util.LinkedHashMap<>();
    if (projectIds.isEmpty()) return result;
    dsl.select(PROJECT_MEMBER.PROJECT_ID, USER.NAME)
        .from(PROJECT_MEMBER)
        .join(USER)
        .on(USER.ID.eq(PROJECT_MEMBER.USER_ID))
        .where(PROJECT_MEMBER.PROJECT_ID.in(projectIds))
        .orderBy(PROJECT_MEMBER.PROJECT_ID.asc(), PROJECT_MEMBER.CREATED_AT.asc())
        .fetch()
        .forEach(
            r ->
                result
                    .computeIfAbsent(
                        r.get(PROJECT_MEMBER.PROJECT_ID), k -> new java.util.ArrayList<>())
                    .add(r.get(USER.NAME)));
    return result;
  }
}
