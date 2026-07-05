package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.WIKI_REFERENCE;

import com.workplace.wiki.dto.WikiReferenceRow;
import java.util.List;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** wiki_reference 적재/조회. RLS 로 테넌트 격리되므로 tenant_id 는 DEFAULT 로 채워진다. */
@Repository
public class WikiReferenceRepository {
  private final DSLContext dsl;

  public WikiReferenceRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /**
   * source 페이지의 모든 참조를 새 목록으로 교체(diff-replace). 본문 저장 시 호출.
   *
   * <p>delete → insert 가 비원자적이므로 호출측 @Transactional 필수. 트랜잭션 없이 호출하면 delete 후 insert 실패 시 해당 소스의
   * 참조가 전부 유실된다.
   */
  public void replaceForSource(long sourcePageId, List<WikiReferenceRow> refs) {
    dsl.deleteFrom(WIKI_REFERENCE).where(WIKI_REFERENCE.SOURCE_PAGE_ID.eq(sourcePageId)).execute();
    if (refs.isEmpty()) return;
    var insert =
        dsl.insertInto(WIKI_REFERENCE)
            .columns(
                WIKI_REFERENCE.SOURCE_PAGE_ID,
                WIKI_REFERENCE.TARGET_TYPE,
                WIKI_REFERENCE.TARGET_ID);
    for (WikiReferenceRow r : refs) {
      // source 는 항상 메서드 파라미터를 단일 소스로 사용(DELETE 와 동일 보장) — row 의 sourcePageId 는 무시.
      insert = insert.values(sourcePageId, r.targetType(), r.targetId());
    }
    insert.onConflictDoNothing().execute();
  }

  /**
   * 주어진 대상을 가리키는 source 페이지 id 목록(백링크). RLS 가 가시 테넌트로 제한.
   *
   * <p>targetType 이 "PAGE" 인 경우 source_page_id 와 target_id 가 같은 id 공간(위키 페이지)이므로, 자기 자신을 멘션한 자기 참조는
   * 백링크 목록에서 제외한다(#689). ISSUE 등 다른 타입은 id 공간이 달라 우연한 값 일치로 오배제될 수 있어 제외하지 않는다.
   */
  public List<Long> findBacklinkSourcePageIds(String targetType, long targetId) {
    var query =
        dsl.select(WIKI_REFERENCE.SOURCE_PAGE_ID)
            .from(WIKI_REFERENCE)
            .where(WIKI_REFERENCE.TARGET_TYPE.eq(targetType))
            .and(WIKI_REFERENCE.TARGET_ID.eq(targetId));
    if ("PAGE".equals(targetType)) {
      query = query.and(WIKI_REFERENCE.SOURCE_PAGE_ID.ne(targetId));
    }
    return query.fetch(WIKI_REFERENCE.SOURCE_PAGE_ID);
  }
}
