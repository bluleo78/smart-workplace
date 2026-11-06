package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.CHAT_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FILE_VERSION;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.HOME_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.ISSUE_ATTACHMENT;
import static com.workplace.jooq.Tables.ISSUE_BODY_IMAGE;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;
import static com.workplace.jooq.Tables.MAIL_DRAFT_ATTACHMENT;
import static com.workplace.jooq.Tables.MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;

import com.workplace.file.api.InternalFileCategories;
import com.workplace.mail.api.MailBlobConditions;
import java.util.EnumMap;
import java.util.Map;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Record2;
import org.jooq.Select;
import org.jooq.Table;
import org.jooq.TableField;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 드라이브 쿼터용 집계/잠금 쿼리.
 *
 * <p>사용량 정책(WP-1391): 테넌트 file 전체 − 내부 카테고리({@link InternalFileCategories}) + 로컬 보낸 메일의 유일 사본 blob.
 * 「종류별로 더하기」가 아니라 「전체에서 내부만 빼기」라, 새 첨부 종류가 생겨도 사용량에서 새지 않는다. 휴지통·임시(만료 예정) 파일도 디스크를 먹으므로 센다.
 *
 * <p>이슈·채팅·노트·메일 초안 등 다른 모듈의 매핑 테이블은 import 없이 테이블로 직접 조회한다 — 의존 방향은 각 모듈 → drive 한쪽으로만 둔다. 로컬 보낸
 * 메일 판별만은 메일 blob GC 와 같아야 하므로 mail 이 공개한 {@link MailBlobConditions#localSent()} 를 쓴다. 모든 집계는
 * RLS(FORCE) 테이블을 읽으므로 트랜잭션 안(app.tenant_id 주입)에서 불러야 한다.
 */
@Repository
public class DriveQuotaRepository {

  /**
   * 내역(breakdown)의 종류 — file 한 행은 선언 순서(우선순위)대로 처음 맞는 하나에만 들어간다.
   *
   * <p>한 file 이 여러 곳에 묶여도(예: 같은 file_id 를 두 매핑 테이블이 참조) 한 번만 세어, 내역의 합이 사용량 합계와 늘 같다. {@link
   * #breakdown()} 은 선언 순서({@code ordinal()})를 우선순위 값으로 그대로 쓰므로, 순서를 바꾸면 우선순위도 바뀐다.
   */
  public enum Kind {
    /** 휴지통이 아닌 드라이브 파일의 모든 버전(옛 버전 포함) — 첨부에서 가져온 드라이브 파일 포함. */
    DRIVE,
    /** 휴지통에 있는 드라이브 파일의 모든 버전(가져온 파일 포함). */
    TRASH,
    /** 노트(위키) 첨부. */
    WIKI,
    /** 이슈 첨부·이슈 본문 이미지. */
    ISSUE,
    /** 이슈챗 첨부(chat_message_attachment). */
    ISSUE_CHAT,
    /** 채팅·홈 메시지·메일 초안 첨부 + 로컬 보낸 메일의 유일 사본 blob. */
    OTHER_ATTACHMENTS,
    /** 어디에도 묶이지 않은 file — 올리는 중이거나 만료를 기다리는 임시 업로드. */
    UNLINKED
  }

  /**
   * mail_attachment_blob 크기 합을 둘로 나눈 것.
   *
   * @param localSent 로컬 보낸 메일의 유일 사본 — 사용량(한도)에 넣는다
   * @param cache 그 밖의 메일 첨부 캐시 — 원본을 다시 받을 수 있고 TTL 로 퇴거되므로 보여 주기만 한다
   */
  public record MailBlobBytes(long localSent, long cache) {}

  /**
   * 화면용 사용량 스냅샷 — 종류별 내역과 한도 밖 메일 첨부 캐시.
   *
   * @param breakdown {@link #breakdown()} 과 같은 내역(값 없는 종류도 0)
   * @param mailCacheBytes {@link MailBlobBytes#cache()}
   */
  public record Usage(Map<Kind, Long> breakdown, long mailCacheBytes) {}

  private final DSLContext dsl;

  public DriveQuotaRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /**
   * 한도 계산용 사용량(바이트) — 내부 카테고리를 뺀 file 전체 + 로컬 보낸 메일 blob(WP-1391).
   *
   * <p>file 에는 소프트 삭제가 없고, 썸네일·미리보기 같은 파생물은 file 행이 아니므로 file.size_bytes 합이 곧 사용자 파일의 물리 사용량이다.
   * 업로드마다 불리는 경로라 메일 캐시 합은 구하지 않는다.
   */
  public long sumUsedBytes() {
    Long files =
        dsl.select(DSL.coalesce(DSL.sum(FILE.SIZE_BYTES), DSL.inline(0L)))
            .from(FILE)
            .where(InternalFileCategories.notInternal())
            .fetchOne(0, Long.class);
    Long localSent =
        dsl.select(DSL.coalesce(DSL.sum(MAIL_ATTACHMENT_BLOB.SIZE_BYTES), DSL.inline(0L)))
            .from(MAIL_ATTACHMENT_BLOB)
            .where(MailBlobConditions.localSent())
            .fetchOne(0, Long.class);
    return (files == null ? 0L : files) + (localSent == null ? 0L : localSent);
  }

  /**
   * 메일 첨부 blob 합을 로컬 보낸 메일 사본/캐시로 나눠 한 번에 구한다 — 테이블을 한 번만 훑도록 FILTER 집계를 쓴다.
   *
   * <p>mail_attachment_blob 은 RLS FORCE 이므로 트랜잭션 밖에서 부르면 둘 다 0 이 된다.
   */
  public MailBlobBytes sumMailBlobBytes() {
    Record r =
        dsl.select(
                DSL.coalesce(
                    DSL.sum(MAIL_ATTACHMENT_BLOB.SIZE_BYTES)
                        .filterWhere(MailBlobConditions.localSent()),
                    DSL.inline(0L)),
                DSL.coalesce(
                    DSL.sum(MAIL_ATTACHMENT_BLOB.SIZE_BYTES)
                        .filterWhere(MailBlobConditions.localSent().not()),
                    DSL.inline(0L)))
            .from(MAIL_ATTACHMENT_BLOB)
            .fetchOne();
    return r == null
        ? new MailBlobBytes(0L, 0L)
        : new MailBlobBytes(r.get(0, Long.class), r.get(1, Long.class));
  }

  /** 메일 첨부 캐시 합 — 로컬 보낸 메일 사본을 뺀 나머지 blob. 보여 주기만 하고 한도에는 넣지 않는다. */
  public long sumMailCacheBytes() {
    return sumMailBlobBytes().cache();
  }

  /** 종류별 내역(바이트) — {@link #usage()} 의 내역만. */
  public Map<Kind, Long> breakdown() {
    return usage().breakdown();
  }

  /**
   * 화면용 스냅샷 — {@link #sumUsedBytes()} 와 같은 대상을 {@link Kind} 하나씩으로 나눈 내역 + 메일 첨부 캐시 합.
   *
   * <p>로컬 보낸 메일 blob 은 file 행이 아니라서 메일 blob 집계(캐시와 한 쿼리)에서 구해 OTHER_ATTACHMENTS 에 더한다. 값이 없는 종류도 0
   * 으로 채워 돌려준다.
   */
  public Usage usage() {
    Map<Kind, Long> result = new EnumMap<>(Kind.class);
    for (Kind k : Kind.values()) {
      result.put(k, 0L);
    }
    Field<Integer> kindOrdinal = fileKindOrdinal();
    dsl.select(kindOrdinal, DSL.coalesce(DSL.sum(FILE.SIZE_BYTES), DSL.inline(0L)))
        .from(FILE)
        .leftJoin(classifiedFiles())
        .on(DSL.field(DSL.name("classified", "file_id"), Long.class).eq(FILE.ID))
        .where(InternalFileCategories.notInternal())
        .groupBy(kindOrdinal)
        .fetch()
        .forEach(r -> result.put(Kind.values()[r.value1()], r.get(1, Long.class)));
    MailBlobBytes mail = sumMailBlobBytes();
    result.merge(Kind.OTHER_ATTACHMENTS, mail.localSent(), Long::sum);
    return new Usage(result, mail.cache());
  }

  /** file 행의 종류 순번 — 어떤 매핑에도 없으면(LEFT JOIN 결과 NULL) UNLINKED. */
  private static Field<Integer> fileKindOrdinal() {
    return DSL.coalesce(
        DSL.field(DSL.name("classified", "prio"), Integer.class),
        DSL.inline(Kind.UNLINKED.ordinal()));
  }

  /**
   * file_id 마다 가장 우선하는 종류 하나(classified(file_id, prio)) — 매핑 테이블을 (file_id, 종류 순번) 으로 UNION ALL 한 뒤
   * file_id 별 최솟값을 고른다.
   *
   * <p>예전에는 file 한 행마다 매핑 테이블 수만큼 상관 EXISTS 를 CASE 로 물어 테넌트 file 수 × 매핑 수만큼 탐색했다. 매핑 쪽을 한 번씩만 훑어
   * 묶으면 집합 연산 한 번으로 끝난다. 우선순위는 {@link Kind} 선언 순서이고, 최솟값을 고르므로 살아 있는 드라이브 파일과 휴지통 파일이 같은 file 을
   * 참조하면 DRIVE 가 된다.
   *
   * <p>드라이브는 두 길을 본다: ① 버전 행(drive_file_version.file_id — 일반 업로드·옛 버전) ② drive_file.file_id 직접 참조.
   * ②가 필요한 까닭은 첨부를 드라이브로 가져오기({@code DriveLinkService.importAttachment})가 버전 행 없이 drive_file 만 만들기
   * 때문이다 — ①만 보면 가져온 파일이 이슈 첨부 등으로 잡히고, 휴지통으로 옮겨도 TRASH 로 바뀌지 않는다.
   */
  private Table<Record2<Long, Integer>> classifiedFiles() {
    // 드라이브 파일이 휴지통에 있으면 TRASH, 아니면 DRIVE.
    Field<Integer> drivePrio =
        DSL.when(DRIVE_FILE.TRASHED_AT.isNull(), DSL.inline(Kind.DRIVE.ordinal()))
            .otherwise(DSL.inline(Kind.TRASH.ordinal()));
    Select<Record2<Long, Integer>> tagged =
        DSL.select(DRIVE_FILE_VERSION.FILE_ID, drivePrio)
            .from(DRIVE_FILE_VERSION)
            .join(DRIVE_FILE)
            .on(DRIVE_FILE.ID.eq(DRIVE_FILE_VERSION.DRIVE_FILE_ID))
            .unionAll(DSL.select(DRIVE_FILE.FILE_ID, drivePrio).from(DRIVE_FILE))
            .unionAll(tag(WIKI_PAGE_ATTACHMENT.FILE_ID, Kind.WIKI))
            .unionAll(tag(ISSUE_ATTACHMENT.FILE_ID, Kind.ISSUE))
            .unionAll(tag(ISSUE_BODY_IMAGE.FILE_ID, Kind.ISSUE))
            .unionAll(tag(CHAT_MESSAGE_ATTACHMENT.FILE_ID, Kind.ISSUE_CHAT))
            .unionAll(tag(MESSAGE_ATTACHMENT.FILE_ID, Kind.OTHER_ATTACHMENTS))
            .unionAll(tag(HOME_MESSAGE_ATTACHMENT.FILE_ID, Kind.OTHER_ATTACHMENTS))
            .unionAll(tag(MAIL_DRAFT_ATTACHMENT.FILE_ID, Kind.OTHER_ATTACHMENTS));
    Table<Record2<Long, Integer>> t = tagged.asTable("tagged", "file_id", "prio");
    Field<Long> fileId = t.field("file_id", Long.class);
    Field<Integer> prio = t.field("prio", Integer.class);
    return DSL.select(fileId.as("file_id"), DSL.min(prio).as("prio"))
        .from(t)
        .groupBy(fileId)
        .asTable("classified");
  }

  /** 매핑 테이블 하나를 (file_id, 종류 순번) 행으로 — {@link #classifiedFiles()} 의 UNION ALL 한 갈래. */
  private static Select<Record2<Long, Integer>> tag(TableField<?, Long> fileId, Kind kind) {
    return DSL.select(fileId, DSL.inline(kind.ordinal())).from(fileId.getTable());
  }

  /** 테넌트 한도(바이트). tenant 는 RLS 비대상이므로 id 를 명시한다. */
  public long findQuotaBytes(long tenantId) {
    Long v =
        dsl.select(TENANT.QUOTA_BYTES)
            .from(TENANT)
            .where(TENANT.ID.eq(tenantId))
            .fetchOne(TENANT.QUOTA_BYTES);
    return v == null ? 0L : v;
  }

  /**
   * 드라이브 쿼터 잠금 전용 classId — 2-인자 pg_advisory_xact_lock(classId, tenantId) 형태에서 사용.
   *
   * <p>Postgres 에서 2-인자(int, int) advisory lock 은 1-인자(bigint) lock 과 별개 네임스페이스를 사용하므로,
   * UserRepository.acquireFirstUserLock() 등 다른 도메인의 1-인자 잠금과 충돌하지 않는다. 이슈 번호(#81)를 classId 로 사용해
   * drive 쿼터 잠금임을 명시한다.
   */
  private static final int DRIVE_QUOTA_LOCK_CLASS = 81;

  /** 테넌트 단위 직렬화 잠금 — 동시 업로드 시 check-then-insert 레이스 방지(트랜잭션 종료 시 자동 해제). */
  public void advisoryLockTenant(long tenantId) {
    // 2-인자 형태로 drive 전용 네임스페이스(DRIVE_QUOTA_LOCK_CLASS=81)를 분리해
    // 타 도메인 1-인자 잠금과의 전역 충돌을 방지한다.
    dsl.execute("SELECT pg_advisory_xact_lock(?, ?)", DRIVE_QUOTA_LOCK_CLASS, (int) tenantId);
  }
}
