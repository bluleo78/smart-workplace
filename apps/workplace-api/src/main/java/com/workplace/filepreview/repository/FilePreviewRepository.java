package com.workplace.filepreview.repository;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_PREVIEW;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

/**
 * file_preview 테이블 접근 — 드라이브 파일({@code file_id} 키)의 문서 미리보기 상태(WP-431).
 *
 * <p>선점·리스 CAS·결과 기록 SQL 은 {@link AbstractPreviewStateRepository} 가 메일 첨부 미리보기와 공유한다(WP-432). 이
 * 클래스는 키 매핑과 드라이브 전용 조회({@link #findWithFile})만 둔다.
 *
 * <p>RLS 대상 테이블이라 호출자는 테넌트 GUC 가 심긴 트랜잭션 안에서 불러야 한다.
 */
@Repository
public class FilePreviewRepository extends AbstractPreviewStateRepository<Long> {

  public FilePreviewRepository(DSLContext dsl) {
    super(dsl);
  }

  /** 미리보기에 필요한 file 행 메타. */
  public record FileMeta(String storagePath, String mime, long sizeBytes, String originalName) {}

  /**
   * file 행 메타와 미리보기 상태를 함께 담은 결과.
   *
   * @param preview 미리보기 행(아직 변환 시도 전이면 null)
   */
  public record FileWithPreview(FileMeta file, Row preview) {}

  @Override
  protected Table<?> table() {
    return FILE_PREVIEW;
  }

  @Override
  protected Condition keyIs(Long fileId) {
    return FILE_PREVIEW.FILE_ID.eq(fileId);
  }

  @Override
  protected List<Field<?>> conflictKeys() {
    return List.of(FILE_PREVIEW.FILE_ID);
  }

  @Override
  protected Map<Field<?>, Object> keyValues(Long fileId, long tenantId) {
    return Map.of(FILE_PREVIEW.FILE_ID, fileId, FILE_PREVIEW.TENANT_ID, tenantId);
  }

  /**
   * file 행 메타와 미리보기 상태를 한 번의 조회(FILE LEFT JOIN FILE_PREVIEW)로 읽는다 — 열람 판정이 두 번 왕복하지 않게. 두 테이블 모두
   * RLS 대상이라 활성 테넌트의 행만 보인다.
   *
   * @return file 행이 없으면(삭제됨·다른 테넌트) empty
   */
  public Optional<FileWithPreview> findWithFile(long fileId) {
    return dsl.select(FILE.STORAGE_PATH, FILE.MIME_TYPE, FILE.SIZE_BYTES, FILE.ORIGINAL_NAME)
        .select(FILE_PREVIEW.FILE_ID)
        .select(rowFields())
        .from(FILE)
        .leftJoin(FILE_PREVIEW)
        .on(FILE_PREVIEW.FILE_ID.eq(FILE.ID))
        .where(FILE.ID.eq(fileId))
        .fetchOptional(
            r ->
                new FileWithPreview(
                    new FileMeta(
                        r.get(FILE.STORAGE_PATH),
                        r.get(FILE.MIME_TYPE),
                        r.get(FILE.SIZE_BYTES),
                        r.get(FILE.ORIGINAL_NAME)),
                    // LEFT JOIN 에서 미리보기 행이 없으면 file_id 가 null 이다.
                    r.get(FILE_PREVIEW.FILE_ID) == null ? null : toRow(r)));
  }
}
