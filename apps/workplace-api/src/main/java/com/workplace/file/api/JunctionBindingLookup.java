package com.workplace.file.api;

import java.util.Collection;
import java.util.Set;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.TableField;
import org.jooq.impl.DSL;

/**
 * 정션 표 하나의 file_id 열로 묶임을 확인하는 {@link AttachmentBindingLookup} 공용 구현(WP-421).
 *
 * <p>이슈·이슈 채팅·메시지·홈·노트·이슈 본문 이미지의 첨부 정션은 "그 표에 file_id 행이 있으면 묶인 것" 이라는 같은 규칙이라, 어느 표의 어느 열을 볼지만 받아
 * 한 구현으로 처리한다. 빈 등록은 {@link AttachmentBindingConfig} 가 정션마다 한다. 클레임 판정({@link #boundAmong})은 정션에 행이
 * 있는지만 보므로 강등·정리 대기 같은 행 상태와 무관하게 묶인 것으로 본다.
 *
 * <p>「보이는 첨부」 판정({@link #notVisiblyBound})만은 정션마다 행 조건을 더 받을 수 있다 — 노트 첨부·본문 이미지는 강등된 행이 남은 채 만료되는
 * 것이 정상이라, 행 존재만으로는 「아직 그 자리에 보인다」고 할 수 없다(WP-1392).
 */
public final class JunctionBindingLookup implements AttachmentBindingLookup {

  private final DSLContext dsl;

  /** 정션 표의 file_id 열 — 표는 열에서 얻는다. */
  private final TableField<?, Long> fileIdField;

  /**
   * 정션 행이 「보이는 첨부」인 조건(WP-1399·WP-1392). null 이면 보이는 첨부 정션이 아니다({@link #visibleAttachment()}
   * false). 행이면 모두 보이는 정션은 {@link DSL#noCondition()}.
   */
  private final Condition visibleRow;

  /** 보이는 첨부가 아닌 정션(메일 임시저장 등). */
  public JunctionBindingLookup(DSLContext dsl, TableField<?, Long> fileIdField) {
    this(dsl, fileIdField, null);
  }

  private JunctionBindingLookup(
      DSLContext dsl, TableField<?, Long> fileIdField, Condition visibleRow) {
    this.dsl = dsl;
    this.fileIdField = fileIdField;
    this.visibleRow = visibleRow;
  }

  /**
   * 행이 있으면 곧 보이는 첨부인 정션(이슈·이슈 채팅·메시지·홈) — {@link
   * AttachmentBindingLookup#visibleAttachment()}(WP-1399).
   */
  public static JunctionBindingLookup visible(DSLContext dsl, TableField<?, Long> fileIdField) {
    return new JunctionBindingLookup(dsl, fileIdField, DSL.noCondition());
  }

  /**
   * 행 가운데 {@code visibleRow} 를 만족하는 것만 보이는 첨부인 정션(WP-1392) — 노트 첨부(강등 아님)·이슈 본문 이미지(연결됨·강등 아님). 조건은
   * 정션 표의 열로만 적는다(상관 서브쿼리 안에서 그 표 행을 거른다).
   */
  public static JunctionBindingLookup visible(
      DSLContext dsl, TableField<?, Long> fileIdField, Condition visibleRow) {
    return new JunctionBindingLookup(dsl, fileIdField, visibleRow);
  }

  /** 바인딩 키 = 정션 표 이름. */
  @Override
  public String bindingKey() {
    return fileIdField.getTable().getName();
  }

  @Override
  public boolean visibleAttachment() {
    return visibleRow != null;
  }

  /**
   * {@code NOT EXISTS (SELECT 1 FROM <정션> WHERE <정션>.file_id = fileId AND <보이는 행 조건>)}. 보이는 첨부 정션이
   * 아니면 조건 없음.
   */
  @Override
  public Condition notVisiblyBound(Field<Long> fileId) {
    if (visibleRow == null) {
      return DSL.noCondition();
    }
    return DSL.notExists(
        DSL.selectOne().from(fileIdField.getTable()).where(fileIdField.eq(fileId)).and(visibleRow));
  }

  /** 주어진 파일 중 정션에 행이 있는 id(행 상태 무관). 빈 입력은 쿼리 없이 빈 집합. */
  @Override
  public Set<Long> boundAmong(Collection<Long> fileIds) {
    if (fileIds.isEmpty()) {
      return Set.of();
    }
    return dsl.select(fileIdField)
        .from(fileIdField.getTable())
        .where(fileIdField.in(fileIds))
        .fetchSet(fileIdField);
  }
}
