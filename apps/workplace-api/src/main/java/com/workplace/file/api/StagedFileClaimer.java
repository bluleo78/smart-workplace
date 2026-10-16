package com.workplace.file.api;

import static com.workplace.jooq.Tables.FILE;

import com.workplace.file.exception.StagedFileUnusableException;
import com.workplace.jooq.tables.records.FileRecord;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 스테이징 파일 클레임(WP-421) — 도메인(이슈·메시징·채팅·홈·노트)이 호출자가 먼저 올려 둔 임시 ATTACHMENT 파일을 묶기 전에 검증하고, 필요하면 영구로
 * 바꾼다. 클레임할 수 있는 파일은 내가 올렸고, 아직 살아 있는 임시 파일이며, 어느 정션({@link AttachmentBindingLookup})에도 묶이지 않은 것이다.
 *
 * <p>FILE 행을 id 순으로 잠근 뒤 검사하므로 같은 파일의 동시 클레임은 한 번만 성공한다(KEEP_TEMPORARY 는 호출 도메인이 같은 트랜잭션에서 정션 행을
 * 넣어야 뒤 클레임이 그 행을 본다). 추출 이벤트는 묶은 도메인이 낸다.
 */
@Component
public class StagedFileClaimer {

  /** 클레임 뒤 파일 수명. */
  public enum Retention {
    /** 만료를 지워 영구 파일로 만든다(이슈·메시지·채팅 첨부). */
    PERMANENT,
    /** 만료를 그대로 둔다(노트처럼 본문 참조로 수명을 따로 관리하는 도메인). */
    KEEP_TEMPORARY
  }

  /** 클레임할 수 있는 파일 범주 — 스테이징 업로드가 이 값으로 FILE 행을 만든다. */
  public static final String CATEGORY_ATTACHMENT = "ATTACHMENT";

  private final DSLContext dsl;
  private final List<AttachmentBindingLookup> lookups;

  public StagedFileClaimer(DSLContext dsl, List<AttachmentBindingLookup> lookups) {
    this.dsl = dsl;
    this.lookups = lookups;
  }

  /**
   * 파일들을 클레임한다. 반드시 호출 도메인의 쓰기 트랜잭션 안에서 불러야 한다(MANDATORY) — 잠금과 정션 INSERT 가 한 트랜잭션이어야 동시 클레임이 한 번만
   * 성공한다.
   *
   * @param callerId 클레임하는 사용자(파일 업로더여야 함)
   * @param fileIds 클레임할 파일 id. 빈 목록이면 쿼리 없이 빈 목록
   * @param retention 클레임 뒤 수명
   * @return 입력 순서대로의 클레임된 파일
   * @throws IllegalArgumentException 목록이 null 이거나 빈 값·중복 id 가 있음(형태 오류, 400) — 잠그기 전에 거른다
   * @throws StagedFileUnusableException 클레임할 수 없는 파일이 있음(400) — 입력 순서상 첫 위반 id
   */
  // 거절 예외는 쓰기 전에만 나므로 호출자 트랜잭션을 rollback-only 로 만들지 않는다 — 호출 도메인이 잡아 다른 응답으로 바꿔도 커밋할 수 있게.
  @Transactional(
      propagation = Propagation.MANDATORY,
      noRollbackFor = {StagedFileUnusableException.class, IllegalArgumentException.class})
  public List<StagedFile> claim(long callerId, List<Long> fileIds, Retention retention) {
    requireWellFormed(fileIds);
    if (fileIds.isEmpty()) {
      return List.of();
    }

    // id 순으로 잠가 여러 파일을 동시에 클레임하는 트랜잭션끼리 교착하지 않게 한다. RLS 로 다른 테넌트 행은 보이지 않는다(= 없는 파일).
    Map<Long, FileRecord> rows =
        dsl.selectFrom(FILE)
            .where(FILE.ID.in(fileIds))
            .orderBy(FILE.ID)
            .forUpdate()
            .of(FILE)
            .fetchMap(FILE.ID);

    Set<Long> bound = new HashSet<>();
    for (AttachmentBindingLookup lookup : lookups) {
      bound.addAll(lookup.boundAmong(fileIds));
    }

    OffsetDateTime now = OffsetDateTime.now();
    List<StagedFile> claimed = new ArrayList<>(fileIds.size());
    for (Long id : fileIds) {
      FileRecord row = rows.get(id);
      if (row == null || !isClaimable(row, callerId, now) || bound.contains(id)) {
        throw new StagedFileUnusableException(id);
      }
      claimed.add(
          new StagedFile(
              row.getId(),
              row.getOriginalName(),
              row.getMimeType(),
              row.getSizeBytes(),
              row.getStoragePath()));
    }

    if (retention == Retention.PERMANENT) {
      dsl.update(FILE).setNull(FILE.EXPIRES_AT).where(FILE.ID.in(fileIds)).execute();
    }
    return claimed;
  }

  /** 내 파일·ATTACHMENT·임시·아직 살아 있음. 만료 판정은 잠근 뒤의 행으로 한다(동시 PERMANENT 클레임의 두 번째를 거르는 근거). */
  private static boolean isClaimable(FileRecord row, long callerId, OffsetDateTime now) {
    return row.getUploadedBy() == callerId
        && CATEGORY_ATTACHMENT.equals(row.getCategory())
        && row.getExpiresAt() != null
        && row.getExpiresAt().isAfter(now);
  }

  /** 형태 검사 — null 목록·빈 값·중복 id 는 클라이언트 입력 오류다(어느 파일이 쓸 수 없는지와는 다른 문제라 400 문구를 따로 둔다). */
  private static void requireWellFormed(List<Long> fileIds) {
    if (fileIds == null) {
      throw new IllegalArgumentException("첨부 파일 목록이 비어 있어요.");
    }
    Set<Long> seen = new HashSet<>();
    for (Long id : fileIds) {
      if (id == null) {
        throw new IllegalArgumentException("첨부 파일 id 에 빈 값이 있어요.");
      }
      if (!seen.add(id)) {
        throw new IllegalArgumentException("같은 첨부 파일을 두 번 보낼 수 없어요 (fileId: " + id + ")");
      }
    }
  }
}
