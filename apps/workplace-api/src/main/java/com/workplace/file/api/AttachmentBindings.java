package com.workplace.file.api;

import java.util.List;
import org.jooq.Condition;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;

/**
 * 등록된 첨부 바인딩({@link AttachmentBindingConfig}) 가운데 「보이는 첨부」 정션들을 묶어 SQL 조건으로 내주는 도우미(WP-1399).
 *
 * <p>정션 목록은 설정 한곳에만 두고, 다른 모듈(드라이브)은 이 조건만 받아 자기 쿼리에 끼운다 — 정책({@link
 * AttachmentBindingLookup#visibleAttachment()})을 호출측이 다시 적지 않게 하려는 것이다.
 */
@Component
public class AttachmentBindings {

  /** {@link AttachmentBindingLookup#visibleAttachment()} 가 true 인 바인딩만 — 기동 때 한 번 고른다. */
  private final List<AttachmentBindingLookup> visible;

  public AttachmentBindings(List<AttachmentBindingLookup> lookups) {
    this.visible = lookups.stream().filter(AttachmentBindingLookup::visibleAttachment).toList();
  }

  /**
   * {@code fileId} 열의 파일이 어느 「보이는 첨부」 정션에도 묶여 있지 않다는 조건(정션별 NOT EXISTS 의 AND). 보이는 정션이 없으면 항상 참.
   */
  public Condition notVisiblyBound(Field<Long> fileId) {
    return DSL.and(visible.stream().map(l -> l.notBound(fileId)).toList());
  }
}
