package com.workplace.file.api;

import static com.workplace.jooq.Tables.FILE;

import com.workplace.file.exception.StagedFileUnusableException;
import com.workplace.jooq.tables.records.FileRecord;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
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
    KEEP_TEMPORARY,
    /**
     * 보류(WP-574 메일 발송) — 범주를 {@link #CATEGORY_HELD} 로 바꿔 다른 클레임을 막고, 만료를 지금 + {@link #HOLD_TTL} 로
     * 늦춰 긴 본 작업(전송) 동안 만료 스윕이 행·파일을 지우지 않게 한다. 짧은 트랜잭션에서 커밋한 뒤 잠금 없이 본 작업을 하고, 성공하면 {@link
     * #consumeHeld}(보류 그대로 지금 만료), 실패하면 {@link #releaseHeld}(원래 상태). 둘 다 못 하고 멈추면(파드 종료 등) 보류 만료 뒤
     * 스윕이 지운다.
     */
    HOLD
  }

  /** 보류 중인 스테이징 파일 범주 — 클레임 판정은 ATTACHMENT 만 받으므로 보류 중에는 누구도 다시 클레임할 수 없다. */
  public static final String CATEGORY_HELD = "ATTACHMENT_HELD";

  /** 보류 만료 — 전송 최대 소요(SMTP 2분, Graph 큰 메일 수 분)를 넉넉히 덮는다. */
  public static final Duration HOLD_TTL = Duration.ofHours(1);

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
    requireAllClaimable(callerId, fileIds, rows);
    List<StagedFile> claimed = toStagedFiles(fileIds, rows);

    if (retention == Retention.PERMANENT) {
      dsl.update(FILE).setNull(FILE.EXPIRES_AT).where(FILE.ID.in(fileIds)).execute();
    } else if (retention == Retention.HOLD) {
      dsl.update(FILE)
          .set(FILE.CATEGORY, CATEGORY_HELD)
          .set(FILE.EXPIRES_AT, OffsetDateTime.now().plus(HOLD_TTL))
          .where(FILE.ID.in(fileIds))
          .execute();
    }
    return claimed;
  }

  /**
   * 보류 파일 사용 완료(WP-574) — 본 작업(전송)이 성공했으므로 지금 만료시킨다. 범주는 보류(HELD) 그대로 둔다 — 만료 스윕은 expires_at 만 보고
   * 지우고, HELD 라 그 사이에도 다시 클레임할 수 없다. 내가 보류한 행만 바꾼다.
   *
   * @param held {@link #claim}(HOLD) 이 돌려준 파일
   */
  @Transactional
  public void consumeHeld(long callerId, List<StagedFile> held) {
    if (held.isEmpty()) {
      return;
    }
    dsl.update(FILE)
        .set(FILE.EXPIRES_AT, OffsetDateTime.now())
        .where(FILE.ID.in(held.stream().map(StagedFile::fileId).toList()))
        .and(FILE.UPLOADED_BY.eq(callerId))
        .and(FILE.CATEGORY.eq(CATEGORY_HELD))
        .execute();
  }

  /**
   * 보류 되돌리기(WP-574) — 본 작업이 실패했으므로 클레임 전 상태(ATTACHMENT, 파일별 원래 만료)로 되살려 같은 파일로 다시 시도할 수 있게 한다. 한
   * UPDATE 로 파일마다 원래 만료를 CASE 로 돌려놓는다. 내가 보류한 행만 바꾼다(남의 id 를 넘겨도 바뀌지 않는다).
   *
   * @param held {@link #claim}(HOLD) 이 돌려준 파일 — 원래 만료를 담고 있다
   */
  @Transactional
  public void releaseHeld(long callerId, List<StagedFile> held) {
    if (held.isEmpty()) {
      return;
    }
    Map<Long, OffsetDateTime> original = new LinkedHashMap<>();
    for (StagedFile f : held) {
      original.put(f.fileId(), f.expiresAt());
    }
    dsl.update(FILE)
        .set(FILE.CATEGORY, CATEGORY_ATTACHMENT)
        .set(FILE.EXPIRES_AT, DSL.case_(FILE.ID).mapValues(original).else_(FILE.EXPIRES_AT))
        .where(FILE.ID.in(original.keySet()))
        .and(FILE.UPLOADED_BY.eq(callerId))
        .and(FILE.CATEGORY.eq(CATEGORY_HELD))
        .execute();
  }

  /**
   * 클레임 사전 검사(잠금·쓰기 없음) — {@link #claim} 과 같은 규칙으로 판정만 한다. 실제로 묶기 전에(예: 홈이 새 세션을 만들기 전에) 잘못된 파일을 먼저
   * 거르려는 호출자가 쓴다. 잠그지 않으므로 통과해도 뒤이은 {@link #claim} 이 다시 판정한다.
   *
   * @return 입력 순서대로의 파일(크기 등 사전 판단용 — WP-574 메일 발송 사전검증이 합계 용량을 본다)
   * @throws IllegalArgumentException 목록 형태 오류(400)
   * @throws StagedFileUnusableException 클레임할 수 없는 파일이 있음(400) — 입력 순서상 첫 위반 id
   */
  public List<StagedFile> requireClaimable(long callerId, List<Long> fileIds) {
    requireWellFormed(fileIds);
    if (fileIds.isEmpty()) {
      return List.of();
    }
    Map<Long, FileRecord> rows = dsl.selectFrom(FILE).where(FILE.ID.in(fileIds)).fetchMap(FILE.ID);
    requireAllClaimable(callerId, fileIds, rows);
    return toStagedFiles(fileIds, rows);
  }

  /** 판정을 통과한 FILE 행을 입력 순서대로 {@link StagedFile} 로 옮긴다. */
  private static List<StagedFile> toStagedFiles(List<Long> fileIds, Map<Long, FileRecord> rows) {
    List<StagedFile> out = new ArrayList<>(fileIds.size());
    for (Long id : fileIds) {
      FileRecord row = rows.get(id);
      out.add(
          new StagedFile(
              row.getId(),
              row.getOriginalName(),
              row.getMimeType(),
              row.getSizeBytes(),
              row.getStoragePath(),
              row.getExpiresAt()));
    }
    return out;
  }

  /** 읽은 FILE 행과 도메인 정션으로 각 id 를 판정한다 — 입력 순서상 첫 위반 id 로 예외. */
  private void requireAllClaimable(long callerId, List<Long> fileIds, Map<Long, FileRecord> rows) {
    Set<Long> bound = new HashSet<>();
    for (AttachmentBindingLookup lookup : lookups) {
      bound.addAll(lookup.boundAmong(fileIds));
    }
    OffsetDateTime now = OffsetDateTime.now();
    for (Long id : fileIds) {
      FileRecord row = rows.get(id);
      if (row == null || !isClaimable(row, callerId, now) || bound.contains(id)) {
        throw new StagedFileUnusableException(id);
      }
    }
  }

  /** 내 파일·ATTACHMENT·임시·아직 살아 있음. 만료 판정은 잠근 뒤의 행으로 한다(동시 PERMANENT 클레임의 두 번째를 거르는 근거). */
  private static boolean isClaimable(FileRecord row, long callerId, OffsetDateTime now) {
    // 업로더가 지워져 NULL 일 수 있다 — 언박싱 NPE 대신 "남의 파일"로 거절한다.
    return Objects.equals(row.getUploadedBy(), callerId)
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
