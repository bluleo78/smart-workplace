package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.WIKI_SPACE;
import static com.workplace.jooq.Tables.WIKI_SPACE_MEMBER;

import com.workplace.wiki.dto.WikiSpaceResponse;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
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

  /**
   * callerId 가 볼 수 있는(멤버인) TEAM 공간 중 같은 이름이 있는지(대소문자 무시, #696). 볼 수 없는 공간까지 견주면 거절 여부로 남의 비공개 스페이스
   * 존재·이름이 드러난다(WP-693 — 채널 WP-590 과 같은 범위). excludeId 는 이름변경 시 자기 자신 제외용(현재 TEAM 공간은 이름변경 API 가 없어
   * 항상 null).
   */
  public boolean existsVisibleTeamSpaceName(String name, long callerId, Long excludeId) {
    // 저장값도 다듬어 비교한다 — WP-562 이전에 공백째 저장된 옛 이름도 같은 이름으로 본다.
    var cond =
        WIKI_SPACE
            .TYPE
            .eq("TEAM")
            .and(DSL.lower(DSL.trim(WIKI_SPACE.NAME)).eq(name.strip().toLowerCase()))
            .and(
                DSL.exists(
                    DSL.selectOne()
                        .from(WIKI_SPACE_MEMBER)
                        .where(
                            WIKI_SPACE_MEMBER
                                .SPACE_ID
                                .eq(WIKI_SPACE.ID)
                                .and(WIKI_SPACE_MEMBER.USER_ID.eq(callerId)))));
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

  public Optional<Long> findPersonalSpaceId(long ownerId) {
    return dsl.select(WIKI_SPACE.ID)
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.TYPE.eq("PERSONAL"))
        .and(WIKI_SPACE.OWNER_ID.eq(ownerId))
        .fetchOptional(WIKI_SPACE.ID);
  }

  /** 호출자 역할을 동봉해 단건 조회(멤버 아니면 empty). */
  public Optional<WikiSpaceResponse> findForUser(long spaceId, long userId) {
    return dsl.select(
            WIKI_SPACE.ID,
            WIKI_SPACE.TYPE,
            WIKI_SPACE.NAME,
            WIKI_SPACE.OWNER_ID,
            WIKI_SPACE_MEMBER.ROLE,
            WIKI_SPACE.CREATED_AT)
        .from(WIKI_SPACE)
        .join(WIKI_SPACE_MEMBER)
        .on(WIKI_SPACE_MEMBER.SPACE_ID.eq(WIKI_SPACE.ID).and(WIKI_SPACE_MEMBER.USER_ID.eq(userId)))
        .where(WIKI_SPACE.ID.eq(spaceId))
        .fetchOptional(WikiSpaceRepository::map);
  }

  /** 호출자가 멤버인 모든 공간(개인 먼저, 그다음 이름순). */
  public List<WikiSpaceResponse> findMySpaces(long userId) {
    return dsl.select(
            WIKI_SPACE.ID,
            WIKI_SPACE.TYPE,
            WIKI_SPACE.NAME,
            WIKI_SPACE.OWNER_ID,
            WIKI_SPACE_MEMBER.ROLE,
            WIKI_SPACE.CREATED_AT)
        .from(WIKI_SPACE)
        .join(WIKI_SPACE_MEMBER)
        .on(WIKI_SPACE_MEMBER.SPACE_ID.eq(WIKI_SPACE.ID).and(WIKI_SPACE_MEMBER.USER_ID.eq(userId)))
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
        r.get(WIKI_SPACE_MEMBER.ROLE),
        r.get(WIKI_SPACE.CREATED_AT));
  }
}
