package com.workplace.home.repository;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static com.workplace.jooq.Tables.HOME_MESSAGE_ATTACHMENT;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.Record7;
import org.jooq.SelectConditionStep;
import org.springframework.stereotype.Repository;

/**
 * 메인 AI 채팅(홈) 메시지 첨부 정션(home_message_attachment, WP-234) 접근.
 *
 * <p>이슈 챗 ChatMessageAttachmentRepository 와 같은 역할이지만 바인딩 후보 판정 입력이 다르다 — 홈은 "아직 임시(expires_at 있음)인
 * 내 ATTACHMENT"만 받으므로 file 행의 category·expires_at 을 함께 돌려준다. 이슈 챗 판정은 chat 정션만 보아 다른 곳에 붙어 영구가 된
 * 파일을 미연결로 보기 때문에 재사용하지 않는다.
 */
@Repository
@RequiredArgsConstructor
public class HomeAttachmentRepository {

  private final DSLContext dsl;

  /** 바인딩 후보 판정 입력 — file 행 상태 + 홈 정션에 이미 붙었는지(bound). */
  public record Candidate(
      long fileId,
      Long uploadedBy,
      String category,
      OffsetDateTime expiresAt,
      boolean bound,
      String mimeType,
      String originalName) {}

  /** 세션 첨부 목록 행(추출 상태는 서비스가 붙인다). */
  public record Row(
      long fileId, long messageId, String originalName, String mimeType, long sizeBytes) {}

  /** 원본 스트리밍용 저장 정보 — path 는 FILE.STORAGE_PATH(상대경로) 그대로, 절대경로 복원은 서비스가 FileStore 로 한다. */
  public record StoredFile(String path, String originalName, String mimeType, long sizeBytes) {}

  /** 바인딩 후보 조회(잠금 없음) — 세션을 만들기 전 사전 검증용. 없는 id 는 결과에 없다. */
  public List<Candidate> findCandidates(Collection<Long> fileIds) {
    if (fileIds.isEmpty()) return List.of();
    return candidateQuery(fileIds).fetch(this::toCandidate);
  }

  /**
   * 바인딩 후보를 file 행 잠금과 함께 조회한다. 같은 fileId 를 두 요청이 동시에 붙이려 하면 뒤 요청은 앞 요청 커밋까지 기다린 뒤 잠근 file 행만 다시
   * 읽는다(READ COMMITTED) — LEFT JOIN 한 정션은 대기 전 스냅샷이라 bound 는 false 로 남을 수 있지만, 앞 요청이 같은 트랜잭션에서 승격해
   * expires_at 이 NULL 이 되었으므로 "임시 아님"으로 거절된다(PK 위반 500 대신 400). id 순으로 잠가 교착을 피하고, 잠금 중엔
   * FileCleanupService(SKIP LOCKED)도 이 행을 건너뛴다.
   */
  public List<Candidate> lockCandidates(Collection<Long> fileIds) {
    if (fileIds.isEmpty()) return List.of();
    return candidateQuery(fileIds).orderBy(FILE.ID).forUpdate().of(FILE).fetch(this::toCandidate);
  }

  /** 후보 조회 공통 SELECT — 홈 정션 LEFT JOIN 으로 연결 여부를 함께 읽는다. */
  private SelectConditionStep<Record7<Long, Long, String, OffsetDateTime, String, String, Long>>
      candidateQuery(Collection<Long> fileIds) {
    return dsl.select(
            FILE.ID,
            FILE.UPLOADED_BY,
            FILE.CATEGORY,
            FILE.EXPIRES_AT,
            FILE.MIME_TYPE,
            FILE.ORIGINAL_NAME,
            HOME_MESSAGE_ATTACHMENT.MESSAGE_ID)
        .from(FILE)
        .leftJoin(HOME_MESSAGE_ATTACHMENT)
        .on(HOME_MESSAGE_ATTACHMENT.FILE_ID.eq(FILE.ID))
        .where(FILE.ID.in(fileIds));
  }

  /** 조회 행 → 후보. 정션 message_id 가 있으면 이미 홈 메시지에 연결된 파일. */
  private Candidate toCandidate(Record r) {
    return new Candidate(
        r.get(FILE.ID),
        r.get(FILE.UPLOADED_BY),
        r.get(FILE.CATEGORY),
        r.get(FILE.EXPIRES_AT),
        r.get(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID) != null,
        r.get(FILE.MIME_TYPE),
        r.get(FILE.ORIGINAL_NAME));
  }

  /**
   * 정션 INSERT — 파일을 홈 USER 메시지에 연결한다. attached_at·tenant_id 는 컬럼 DEFAULT(NOW()·GUC)로 채워 같은 트랜잭션 행은
   * 시각이 같다.
   */
  public void bind(long fileId, long messageId, long attachedBy) {
    dsl.insertInto(HOME_MESSAGE_ATTACHMENT)
        .set(HOME_MESSAGE_ATTACHMENT.FILE_ID, fileId)
        .set(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID, messageId)
        .set(HOME_MESSAGE_ATTACHMENT.ATTACHED_BY, attachedBy)
        .execute();
  }

  /** 연결된 파일을 영구로 승격(expires_at = NULL) — 임시 파일 정리 대상에서 뺀다. */
  public void promoteToPermanent(Collection<Long> fileIds) {
    if (fileIds.isEmpty()) return;
    dsl.update(FILE).setNull(FILE.EXPIRES_AT).where(FILE.ID.in(fileIds)).execute();
  }

  /** 세션에 이미 붙은 첨부 수 — 세션당 상한 검사용(세션 행 잠금 뒤에 호출해야 경합에 뚫리지 않는다). */
  public int countBySession(UUID sessionId) {
    return dsl.fetchCount(
        dsl.selectOne()
            .from(HOME_MESSAGE_ATTACHMENT)
            .join(HOME_MESSAGE)
            .on(HOME_MESSAGE.ID.eq(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID))
            .where(HOME_MESSAGE.SESSION_ID.eq(sessionId)));
  }

  /**
   * 세션 전체 첨부(요약 경계 이전 메시지 포함)를 메시지 id → 연결 시각 → 파일 id 순으로. 한 메시지의 파일은 같은 트랜잭션에서 붙어 attached_at 이
   * 같으므로 파일 id(업로드 순)로 순서를 고정한다.
   */
  public List<Row> findBySession(UUID sessionId) {
    return dsl.select(
            HOME_MESSAGE_ATTACHMENT.FILE_ID,
            HOME_MESSAGE_ATTACHMENT.MESSAGE_ID,
            FILE.ORIGINAL_NAME,
            FILE.MIME_TYPE,
            FILE.SIZE_BYTES)
        .from(HOME_MESSAGE_ATTACHMENT)
        .join(HOME_MESSAGE)
        .on(HOME_MESSAGE.ID.eq(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID))
        .join(FILE)
        .on(FILE.ID.eq(HOME_MESSAGE_ATTACHMENT.FILE_ID))
        .where(HOME_MESSAGE.SESSION_ID.eq(sessionId))
        .orderBy(
            HOME_MESSAGE_ATTACHMENT.MESSAGE_ID.asc(),
            HOME_MESSAGE_ATTACHMENT.ATTACHED_AT.asc(),
            HOME_MESSAGE_ATTACHMENT.FILE_ID.asc())
        .fetch(r -> new Row(r.value1(), r.value2(), r.value3(), r.value4(), r.value5()));
  }

  /** 메시지별 첨부 파일명(이력의 [첨부: …] 표시용) — findBySession 과 같은 순서. 첨부 없는 메시지는 맵에 없다. */
  public Map<Long, List<String>> findNamesByMessageIds(Collection<Long> messageIds) {
    if (messageIds.isEmpty()) return Map.of();
    Map<Long, List<String>> out = new LinkedHashMap<>();
    dsl.select(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID, FILE.ORIGINAL_NAME)
        .from(HOME_MESSAGE_ATTACHMENT)
        .join(FILE)
        .on(FILE.ID.eq(HOME_MESSAGE_ATTACHMENT.FILE_ID))
        .where(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID.in(messageIds))
        .orderBy(
            HOME_MESSAGE_ATTACHMENT.MESSAGE_ID.asc(),
            HOME_MESSAGE_ATTACHMENT.ATTACHED_AT.asc(),
            HOME_MESSAGE_ATTACHMENT.FILE_ID.asc())
        .forEach(r -> out.computeIfAbsent(r.value1(), k -> new ArrayList<>()).add(r.value2()));
    return out;
  }

  /** 그 세션 메시지에 연결된 파일의 저장 정보. 다른 세션 파일이면 empty(호출부가 404). */
  public Optional<StoredFile> findStoredFile(UUID sessionId, long fileId) {
    return dsl.select(FILE.STORAGE_PATH, FILE.ORIGINAL_NAME, FILE.MIME_TYPE, FILE.SIZE_BYTES)
        .from(HOME_MESSAGE_ATTACHMENT)
        .join(HOME_MESSAGE)
        .on(HOME_MESSAGE.ID.eq(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID))
        .join(FILE)
        .on(FILE.ID.eq(HOME_MESSAGE_ATTACHMENT.FILE_ID))
        .where(HOME_MESSAGE_ATTACHMENT.FILE_ID.eq(fileId))
        .and(HOME_MESSAGE.SESSION_ID.eq(sessionId))
        .fetchOptional(r -> new StoredFile(r.value1(), r.value2(), r.value3(), r.value4()));
  }

  /**
   * 세션 삭제 직전 호출 — 그 세션 첨부 파일의 만료시각을 지금으로 당긴다. 연결 행은 home_message CASCADE 로 사라지지만 file 행·디스크 파일은
   * 남으므로, 기존 FileCleanupService(만료 파일 1시간 주기 정리)가 치우게 한다. 갱신 행 수 반환.
   */
  public int expireSessionFiles(UUID sessionId) {
    return dsl.update(FILE)
        .set(FILE.EXPIRES_AT, OffsetDateTime.now())
        .where(
            FILE.ID.in(
                dsl.select(HOME_MESSAGE_ATTACHMENT.FILE_ID)
                    .from(HOME_MESSAGE_ATTACHMENT)
                    .join(HOME_MESSAGE)
                    .on(HOME_MESSAGE.ID.eq(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID))
                    .where(HOME_MESSAGE.SESSION_ID.eq(sessionId))))
        .execute();
  }
}
