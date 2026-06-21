package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE_REF;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** drive_file_ref(다형 교차링크) jOOQ 접근. 테넌트 격리는 RLS가 처리. */
@Repository
@RequiredArgsConstructor
public class DriveFileRefRepository {

  private final DSLContext dsl;

  /** 소스 엔티티 참조 (sourceType + sourceId 쌍). */
  public record SourceRef(String sourceType, long sourceId) {}

  /** 링크 행 전체 정보 (파일 ID, 생성자, 생성시각). */
  public record RefRow(long driveFileId, long createdBy, OffsetDateTime createdAt) {}

  /** 특정 드라이브 파일과 소스 엔티티 간 링크 존재 여부 확인. */
  public boolean linkExists(long driveFileId, String sourceType, long sourceId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(DRIVE_FILE_REF)
            .where(DRIVE_FILE_REF.DRIVE_FILE_ID.eq(driveFileId))
            .and(DRIVE_FILE_REF.SOURCE_TYPE.eq(sourceType))
            .and(DRIVE_FILE_REF.SOURCE_ID.eq(sourceId)));
  }

  /** ON CONFLICT DO NOTHING으로 삽입. 실제 삽입되면 true(반환행 존재), 중복이면 false. */
  public boolean insertIgnore(long driveFileId, String sourceType, long sourceId, long createdBy) {
    return dsl.insertInto(DRIVE_FILE_REF)
        .set(DRIVE_FILE_REF.DRIVE_FILE_ID, driveFileId)
        .set(DRIVE_FILE_REF.SOURCE_TYPE, sourceType)
        .set(DRIVE_FILE_REF.SOURCE_ID, sourceId)
        .set(DRIVE_FILE_REF.CREATED_BY, createdBy)
        .onConflictDoNothing()
        .returning(DRIVE_FILE_REF.ID)
        .fetchOptional()
        .isPresent();
  }

  /** 링크를 생성한 사용자 ID 조회. */
  public Optional<Long> findCreatedBy(long driveFileId, String sourceType, long sourceId) {
    return dsl.select(DRIVE_FILE_REF.CREATED_BY)
        .from(DRIVE_FILE_REF)
        .where(DRIVE_FILE_REF.DRIVE_FILE_ID.eq(driveFileId))
        .and(DRIVE_FILE_REF.SOURCE_TYPE.eq(sourceType))
        .and(DRIVE_FILE_REF.SOURCE_ID.eq(sourceId))
        .fetchOptional(DRIVE_FILE_REF.CREATED_BY);
  }

  /** 단일 링크 삭제. 삭제된 행 수 반환. */
  public int delete(long driveFileId, String sourceType, long sourceId) {
    return dsl.deleteFrom(DRIVE_FILE_REF)
        .where(DRIVE_FILE_REF.DRIVE_FILE_ID.eq(driveFileId))
        .and(DRIVE_FILE_REF.SOURCE_TYPE.eq(sourceType))
        .and(DRIVE_FILE_REF.SOURCE_ID.eq(sourceId))
        .execute();
  }

  /** 소스 엔티티(sourceType+sourceId)에 연결된 모든 링크 삭제. */
  public int deleteAllForSource(String sourceType, long sourceId) {
    return dsl.deleteFrom(DRIVE_FILE_REF)
        .where(DRIVE_FILE_REF.SOURCE_TYPE.eq(sourceType))
        .and(DRIVE_FILE_REF.SOURCE_ID.eq(sourceId))
        .execute();
  }

  /** 여러 소스 엔티티에 연결된 모든 링크를 배치 삭제 (N+1 방지). 빈 리스트 입력 시 즉시 0 반환(no-op). */
  public int deleteAllForSources(String sourceType, List<Long> sourceIds) {
    if (sourceIds.isEmpty()) return 0;
    return dsl.deleteFrom(DRIVE_FILE_REF)
        .where(DRIVE_FILE_REF.SOURCE_TYPE.eq(sourceType))
        .and(DRIVE_FILE_REF.SOURCE_ID.in(sourceIds))
        .execute();
  }

  /** 특정 소스 엔티티에 연결된 파일 링크 목록 조회 (생성 시각 오름차순). */
  public List<RefRow> findBySource(String sourceType, long sourceId) {
    return dsl.select(
            DRIVE_FILE_REF.DRIVE_FILE_ID, DRIVE_FILE_REF.CREATED_BY, DRIVE_FILE_REF.CREATED_AT)
        .from(DRIVE_FILE_REF)
        .where(DRIVE_FILE_REF.SOURCE_TYPE.eq(sourceType))
        .and(DRIVE_FILE_REF.SOURCE_ID.eq(sourceId))
        .orderBy(DRIVE_FILE_REF.CREATED_AT.asc())
        .fetch(
            r ->
                new RefRow(
                    r.get(DRIVE_FILE_REF.DRIVE_FILE_ID),
                    r.get(DRIVE_FILE_REF.CREATED_BY),
                    r.get(DRIVE_FILE_REF.CREATED_AT)));
  }

  /**
   * 여러 소스 엔티티에 연결된 링크를 한 번에 조회(N+1 방지용 배치). sourceId → RefRow 목록 맵 반환. 빈 sourceIds 이면 즉시 빈 맵 반환.
   */
  public Map<Long, List<RefRow>> findBySourceIds(String sourceType, List<Long> sourceIds) {
    if (sourceIds.isEmpty()) return Map.of();
    return dsl.select(
            DRIVE_FILE_REF.SOURCE_ID,
            DRIVE_FILE_REF.DRIVE_FILE_ID,
            DRIVE_FILE_REF.CREATED_BY,
            DRIVE_FILE_REF.CREATED_AT)
        .from(DRIVE_FILE_REF)
        .where(DRIVE_FILE_REF.SOURCE_TYPE.eq(sourceType))
        .and(DRIVE_FILE_REF.SOURCE_ID.in(sourceIds))
        .fetchGroups(
            DRIVE_FILE_REF.SOURCE_ID,
            r ->
                new RefRow(
                    r.get(DRIVE_FILE_REF.DRIVE_FILE_ID),
                    r.get(DRIVE_FILE_REF.CREATED_BY),
                    r.get(DRIVE_FILE_REF.CREATED_AT)));
  }

  /** 특정 드라이브 파일에 연결된 소스 엔티티 목록 조회. */
  public List<SourceRef> findByFile(long driveFileId) {
    return dsl.select(DRIVE_FILE_REF.SOURCE_TYPE, DRIVE_FILE_REF.SOURCE_ID)
        .from(DRIVE_FILE_REF)
        .where(DRIVE_FILE_REF.DRIVE_FILE_ID.eq(driveFileId))
        .fetch(
            r -> new SourceRef(r.get(DRIVE_FILE_REF.SOURCE_TYPE), r.get(DRIVE_FILE_REF.SOURCE_ID)));
  }
}
