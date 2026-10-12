package com.workplace.file.api;

import static com.workplace.jooq.Tables.FILE;

import java.util.Set;
import org.jooq.Condition;

/**
 * 사용자가 직접 올린 파일이 아닌, 서버가 내부 처리용으로 만든 file 행의 카테고리(WP-358).
 *
 * <p>이런 행은 업로더(uploaded_by)·만료(expires_at)가 사용자 임시 업로드와 같은 모양이라, 카테고리로 구분하지 않으면 코어 업로더 경로
 * (/api/v1/files/{id})로 내려받거나 첨부 바인딩으로 영구 파일이 될 수 있다. 업로더 키 경로는 {@link #notInternal()} 로 거르고, 첨부
 * 바인딩은 ATTACHMENT 만 받는다.
 */
public final class InternalFileCategories {

  private InternalFileCategories() {}

  /** 메일 첨부 텍스트 추출용 평문 사본(mail 모듈 MailExtractCopyStore). */
  public static final String MAIL_EXTRACT = "MAIL_EXTRACT";

  /** 내부 카테고리 전체. */
  public static final Set<String> ALL = Set.of(MAIL_EXTRACT);

  /** 내부 처리용 file 행이 아닌 것 — category 가 NULL 인 레거시 행은 사용자 파일로 본다. */
  public static Condition notInternal() {
    return FILE.CATEGORY.isNull().or(FILE.CATEGORY.notIn(ALL));
  }
}
