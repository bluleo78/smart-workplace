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
