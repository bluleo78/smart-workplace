package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.WIKI_SPACE;

import com.workplace.global.share.WikiSpaceMembership;
import com.workplace.wiki.dto.WikiSpaceResponse;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** wiki_space 접근. */
@Repository
@RequiredArgsConstructor
public class WikiSpaceRepository {
  private final DSLContext dsl;

  public long insert(String type, String name, long ownerId) {
    return dsl.insertInto(WIKI_SPACE)
        .set(WIKI_SPACE.TYPE, type)
        .set(WIKI_SPACE.NAME, name)
        .set(WIKI_SPACE.OWNER_ID, ownerId)
        .returning(WIKI_SPACE.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 삭제할 공간 행을 잠근다(WP-580) — 페이지 생성(wiki_page.space_id FK 가 공간 행에 KEY SHARE 를 건다)과 FOR UPDATE 가
   * 충돌하므로, 진행 중인 생성은 커밋을 기다렸다가 보고 새 생성은 삭제가 끝날 때까지 막혔다가 FK 위반으로 실패한다. 그래서 이어 모으는 페이지·첨부 목록에 빠지는 것이
   * 없다.
   */
  public void lockForDelete(long spaceId) {
    dsl.select(WIKI_SPACE.ID)
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.ID.eq(spaceId))
        .forUpdate()
        .execute();
  }

  /**
   * 공유 변경 전에 공간 행을 KEY SHARE 로 잠근다(WP-579). 스페이스 삭제(lockForDelete 의 FOR UPDATE)와만 충돌하고 공간 행의 다른
   * 갱신과는 충돌하지 않는다 — 삭제가 먼저면 그 커밋을 기다렸다 없는 공간으로 끝나고, 저장이 먼저면 삭제가 이 커밋을 기다린다. 첫 공유 저장이 FK 로 공간 행에 KEY
   * SHARE 를 거는 시점이 공유 행 잠금보다 늦어 삭제(공간 → 공유 순)와 교착하던 순서를 맨 앞으로 당긴다.
   */
  public void lockForKeyShare(long spaceId) {
    dsl.select(WIKI_SPACE.ID)
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.ID.eq(spaceId))
        .forKeyShare()
        .execute();
  }

  /** 공간 행 삭제 — 멤버·페이지와 그 하위 행(판·참조·첨부 매핑·동기화 문서·본문 기록)은 FK CASCADE 로 함께 지워진다(WP-580). */
  public void delete(long spaceId) {
    dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.ID.eq(spaceId)).execute();
  }

  private static final int TEAM_NAME_LOCK_CLASS = 7720;

  /**
   * 같은 이름의 TEAM 공간 만들기를 차례로 세우는 잠금(WP-772, 트랜잭션 종료 시 해제) — 드라이브 {@code
   * DriveSpaceRepository#lockTeamSpaceName} 과 같은 이유. 키는 검사와 같은 다듬은·대소문자 무시 이름. classId 는 드라이브(772)와
   * 겹치지 않게 7720.
   */
  public void lockTeamSpaceName(String name) {
    dsl.execute(
        "SELECT pg_advisory_xact_lock(?, hashtext(?))",
        TEAM_NAME_LOCK_CLASS,
        name.strip().toLowerCase());
  }

  /**
   * callerId 가 볼 수 있는(실효 멤버인 — 직접 또는 조직도 부서, WP-1052) TEAM 공간 중 같은 이름이 있는지(대소문자 무시, #696). 볼 수 없는
   * 공간까지 견주면 거절 여부로 남의 비공개 스페이스 존재·이름이 드러난다(WP-693 — 채널 WP-590 과 같은 범위). excludeId 는 이름변경 시 자기 자신
   * 제외용(현재 TEAM 공간은 이름변경 API 가 없어 항상 null).
   */
  public boolean existsVisibleTeamSpaceName(String name, long callerId, Long excludeId) {
    // 저장값도 다듬어 비교한다 — WP-562 이전에 공백째 저장된 옛 이름도 같은 이름으로 본다.
    var cond =
        WIKI_SPACE
            .TYPE
            .eq("TEAM")
            .and(DSL.lower(DSL.trim(WIKI_SPACE.NAME)).eq(name.strip().toLowerCase()))
            // 볼 수 있는 공간 = 실효 멤버(직접 또는 조직도 부서, WP-1052)인 공간.
            .and(WikiSpaceMembership.isMember(WIKI_SPACE.ID, DSL.val(callerId)));
    if (excludeId != null) {
      cond = cond.and(WIKI_SPACE.ID.ne(excludeId));
    }
    return dsl.fetchExists(dsl.selectOne().from(WIKI_SPACE).where(cond));
  }

  /** 공간 유형(PERSONAL·TEAM). 없으면 empty — 멤버 변경 가드(WP-495)용. */
  public Optional<String> findType(long spaceId) {
    return dsl.select(WIKI_SPACE.TYPE)
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.ID.eq(spaceId))
        .fetchOptional(WIKI_SPACE.TYPE);
  }

  /** 공간 이름. 없으면 empty — 마지막 OWNER 오류 문구(WP-785)용. */
  public Optional<String> findName(long spaceId) {
    return dsl.select(WIKI_SPACE.NAME)
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.ID.eq(spaceId))
        .fetchOptional(WIKI_SPACE.NAME);
  }

  // ── 프로젝트 노트 공간(WP-1480) ──

  /** 이 공간이 이어진 프로젝트 id. 프로젝트 공간이 아니면(또는 공간이 없으면) empty — 수동 멤버 편집 잠금 가드용. */
  public Optional<Long> findLinkedProjectId(long spaceId) {
    return dsl.select(WIKI_SPACE.LINKED_PROJECT_ID)
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.ID.eq(spaceId))
        .fetchOptional(WIKI_SPACE.LINKED_PROJECT_ID);
  }

  /** 공간 행의 테넌트 — 커밋 뒤 리스너용 이벤트에 담을 테넌트를 컨텍스트 없이도 정확히 얻는다. 없으면 empty. */
  public Optional<Long> findTenantId(long spaceId) {
    return dsl.select(WIKI_SPACE.TENANT_ID)
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.ID.eq(spaceId))
        .fetchOptional(WIKI_SPACE.TENANT_ID);
  }

  /**
   * 공간 유형과 프로젝트 연결.
   *
   * @param linkedProjectId 프로젝트 노트 공간이면 그 프로젝트 id, 아니면 null
   */
  public record TypeAndLink(String type, Long linkedProjectId) {}

  /**
   * 공간 행을 FOR SHARE 로 잠그고 유형·프로젝트 연결을 한 번에 읽는다(WP-1480) — 사람의 멤버 편집·공간 삭제 가드용. 연결(link 가 같은 행을 FOR
   * UPDATE 로 잠근다)과 차례를 세운다: 연결이 진행 중이면 그 커밋을 기다렸다 연결된 상태를 보고 거절하고, 가드를 먼저 통과했으면 연결이 이 트랜잭션의 끝을 기다린다
   * — 연결 직후 사람이 넣은 프로젝트 밖 멤버가 맞추기를 피해 남지 않게. 없으면 empty.
   */
  public Optional<TypeAndLink> findTypeAndLinkForShare(long spaceId) {
    return dsl.select(WIKI_SPACE.TYPE, WIKI_SPACE.LINKED_PROJECT_ID)
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.ID.eq(spaceId))
        .forShare()
        .fetchOptional(r -> new TypeAndLink(r.value1(), r.value2()));
  }

  /** 연결할 공간 행을 FOR UPDATE 로 잠근다(WP-1480) — 사람의 멤버 편집 가드(FOR SHARE)와 다른 프로젝트의 동시 연결을 이 연결 뒤로 세운다. */
  public void lockForLink(long spaceId) {
    dsl.select(WIKI_SPACE.ID)
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.ID.eq(spaceId))
        .forUpdate()
        .execute();
  }

  /**
   * 아직 어느 프로젝트에도 이어지지 않은 공간만 프로젝트에 잇는다(조건부 갱신). 0 이면 그새 다른 프로젝트에 이어졌다 — 부르는 쪽이 409 로 돌려보낸다. 같은
   * 프로젝트에 이미 다른 공간이 이어져 있으면 유일 인덱스 위반이므로 먼저 끊는다.
   */
  public int linkIfUnlinked(long spaceId, long projectId) {
    return dsl.update(WIKI_SPACE)
        .set(WIKI_SPACE.LINKED_PROJECT_ID, projectId)
        .set(WIKI_SPACE.UPDATED_AT, java.time.OffsetDateTime.now())
        .where(WIKI_SPACE.ID.eq(spaceId))
        .and(WIKI_SPACE.LINKED_PROJECT_ID.isNull())
        .execute();
  }

  /** 프로젝트에 이어진 공간 id(프로젝트당 하나 — 부분 유일 인덱스). 없으면 empty. */
  public Optional<Long> findIdByLinkedProject(long projectId) {
    return dsl.select(WIKI_SPACE.ID)
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.LINKED_PROJECT_ID.eq(projectId))
        .fetchOptional(WIKI_SPACE.ID);
  }

  /** 공간의 프로젝트 연결을 바꾼다(null = 끊기). 프로젝트당 하나라 다른 공간에 이어져 있으면 유일 위반이다 — 부르는 쪽이 먼저 끊는다. */
  public void setLinkedProject(long spaceId, Long projectId) {
    dsl.update(WIKI_SPACE)
        .set(WIKI_SPACE.LINKED_PROJECT_ID, projectId)
        .set(WIKI_SPACE.UPDATED_AT, java.time.OffsetDateTime.now())
        .where(WIKI_SPACE.ID.eq(spaceId))
        .execute();
  }

  /** 공간 이름을 바꾼다 — 프로젝트 공간이 프로젝트 이름을 따라갈 때만 쓴다(사용자 이름변경 API 는 없다). */
  public void rename(long spaceId, String name) {
    dsl.update(WIKI_SPACE)
        .set(WIKI_SPACE.NAME, name)
        .set(WIKI_SPACE.UPDATED_AT, java.time.OffsetDateTime.now())
        .where(WIKI_SPACE.ID.eq(spaceId))
        .execute();
  }

  /**
   * 테넌트 안의 TEAM 공간(excludeId 제외) 중 같은 이름이 있는지(대소문자·앞뒤 공백 무시). {@link #existsVisibleTeamSpaceName} 과
   * 달리 볼 수 있는 범위로 좁히지 않는다 — 프로젝트 공간 이름은 사람이 고르지 않고 서버가 정하므로 존재가 드러날 염려가 없고, 테넌트 전체에서 겹치지 않게 하는 것이
   * 설계 결정이다(WP-1480). RLS 가 테넌트 범위를 정한다.
   */
  public boolean existsTeamSpaceName(String name, Long excludeId) {
    var cond =
        WIKI_SPACE
            .TYPE
            .eq("TEAM")
            .and(DSL.lower(DSL.trim(WIKI_SPACE.NAME)).eq(name.strip().toLowerCase()));
    if (excludeId != null) {
      cond = cond.and(WIKI_SPACE.ID.ne(excludeId));
    }
    return dsl.fetchExists(dsl.selectOne().from(WIKI_SPACE).where(cond));
  }

  public Optional<Long> findPersonalSpaceId(long ownerId) {
    return dsl.select(WIKI_SPACE.ID)
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.TYPE.eq("PERSONAL"))
        .and(WIKI_SPACE.OWNER_ID.eq(ownerId))
        .fetchOptional(WIKI_SPACE.ID);
  }

  /** 실효 역할 열의 이름 — 목록·단건 조회가 같은 이름으로 읽는다. */
  private static final String ROLE = "role";

  /** 호출자 실효 역할(직접 + 조직도 부서 중 가장 높은 것, WP-1052)을 동봉해 단건 조회(멤버 아니면 empty). */
  public Optional<WikiSpaceResponse> findForUser(long spaceId, long userId) {
    Field<String> role = WikiSpaceMembership.effectiveRole(WIKI_SPACE.ID, DSL.val(userId)).as(ROLE);
    return dsl.select(
            WIKI_SPACE.ID,
            WIKI_SPACE.TYPE,
            WIKI_SPACE.NAME,
            WIKI_SPACE.OWNER_ID,
            role,
            WIKI_SPACE.CREATED_AT,
            PROJECT.KEY)
        .from(WIKI_SPACE)
        // 프로젝트 노트 공간이면 그 프로젝트 key 를 싣는다(WP-1480) — 연결이 없으면 null.
        .leftJoin(PROJECT)
        .on(PROJECT.ID.eq(WIKI_SPACE.LINKED_PROJECT_ID))
        .where(WIKI_SPACE.ID.eq(spaceId))
        .and(WikiSpaceMembership.isMember(WIKI_SPACE.ID, DSL.val(userId)))
        .fetchOptional(WikiSpaceRepository::map);
  }

  /**
   * 호출자가 (실효) 멤버인 모든 공간(개인 먼저, 그다음 이름순) — 직접 멤버이거나 멤버로 둔 조직도 부서에 걸린 공간(WP-1052). 양쪽에 걸려도 한 번만, 역할은
   * 가장 높은 것.
   */
  public List<WikiSpaceResponse> findMySpaces(long userId) {
    Field<String> role = WikiSpaceMembership.effectiveRole(WIKI_SPACE.ID, DSL.val(userId)).as(ROLE);
    return dsl.select(
            WIKI_SPACE.ID,
            WIKI_SPACE.TYPE,
            WIKI_SPACE.NAME,
            WIKI_SPACE.OWNER_ID,
            role,
            WIKI_SPACE.CREATED_AT,
            PROJECT.KEY)
        .from(WIKI_SPACE)
        // 프로젝트 노트 공간이면 그 프로젝트 key 를 싣는다(WP-1480) — 연결이 없으면 null.
        .leftJoin(PROJECT)
        .on(PROJECT.ID.eq(WIKI_SPACE.LINKED_PROJECT_ID))
        .where(WikiSpaceMembership.isMember(WIKI_SPACE.ID, DSL.val(userId)))
        .orderBy(
            DSL.when(WIKI_SPACE.TYPE.eq("PERSONAL"), DSL.inline(0)).otherwise(DSL.inline(1)),
            WIKI_SPACE.NAME.asc())
        .fetch(WikiSpaceRepository::map);
  }

  static WikiSpaceResponse map(org.jooq.Record r) {
    return new WikiSpaceResponse(
        r.get(WIKI_SPACE.ID),
        r.get(WIKI_SPACE.TYPE),
        r.get(WIKI_SPACE.NAME),
        r.get(WIKI_SPACE.OWNER_ID),
        r.get(ROLE, String.class),
        r.get(WIKI_SPACE.CREATED_AT),
        r.get(PROJECT.KEY));
  }
}
