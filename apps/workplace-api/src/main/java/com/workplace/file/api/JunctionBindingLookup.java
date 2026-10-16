package com.workplace.file.api;

import java.util.Collection;
import java.util.Set;
import org.jooq.DSLContext;
import org.jooq.TableField;

/**
 * 정션 표 하나의 file_id 열로 묶임을 확인하는 {@link AttachmentBindingLookup} 공용 구현(WP-421).
 *
 * <p>이슈·이슈 채팅·메시지·홈·노트의 첨부 정션은 "그 표에 file_id 행이 있으면 묶인 것" 이라는 같은 규칙이라, 어느 표의 어느 열을 볼지만 받아 한 구현으로
 * 처리한다. 빈 등록은 {@link AttachmentBindingConfig} 가 정션마다 한다. 정션에 행이 있는지만 보므로 강등·정리 대기 같은 행 상태와 무관하게 묶인
 * 것으로 본다.
 */
public final class JunctionBindingLookup implements AttachmentBindingLookup {

  private final DSLContext dsl;

  /** 정션 표의 file_id 열 — 표는 열에서 얻는다. */
  private final TableField<?, Long> fileIdField;

  public JunctionBindingLookup(DSLContext dsl, TableField<?, Long> fileIdField) {
    this.dsl = dsl;
    this.fileIdField = fileIdField;
  }

  /** 주어진 파일 중 정션에 행이 있는 id. 빈 입력은 쿼리 없이 빈 집합. */
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
