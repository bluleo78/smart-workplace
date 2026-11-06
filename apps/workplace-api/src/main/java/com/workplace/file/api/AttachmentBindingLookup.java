package com.workplace.file.api;

import java.util.Collection;
import java.util.Set;
import org.jooq.Condition;
import org.jooq.Field;

/**
 * 첨부 바인딩 조회 SPI(WP-421) — 주어진 파일 id 가운데 이 도메인의 첨부 정션에 이미 묶인 것을 돌려준다.
 *
 * <p>{@link StagedFileClaimer} 가 "아직 어디에도 묶이지 않은 임시 파일"만 클레임하게 하려고 쓴다. 대부분의 도메인은 묶을 때 만료를 지워 "임시"
 * 조건만으로 거를 수 있지만, 노트처럼 업로드 때 묶고도 임시로 두는(강등 파일 포함) 도메인이 있어 정션을 직접 봐야 한다. core {@code file} 은 도메인
 * 패키지를 import 하지 않으므로 {@link AttachmentBindingConfig} 가 생성된 jOOQ 정션 열로 구현을 등록한다.
 *
 * <p><b>업로드·바인딩 뒤에도 파일을 임시(expires_at 있음)로 두는 도메인은 반드시 등록해야 한다</b> — 빠뜨리면 그 도메인에 묶인 파일이 다른 도메인에 다시
 * 묶여 한 파일이 두 곳에 걸린다. 같은 트랜잭션에서 FILE 행을 잠근 뒤 불리므로 커밋된 바인딩은 모두 보인다.
 */
public interface AttachmentBindingLookup {

  /**
   * {@code fileIds} 중 이 도메인 정션에 행이 있는 id. 빈 입력이면 쿼리 없이 빈 집합.
   *
   * @param fileIds 확인할 파일 id(중복 없음)
   * @return 묶인 파일 id 의 부분집합
   */
  Set<Long> boundAmong(Collection<Long> fileIds);

  /**
   * 바인딩 키 — 클레임 호출자가 "이 바인딩에서 다시 가져온다"고 지목할 때 쓰는 이름(정션 표 이름). {@link StagedFileClaimer} 는 호출자가 넘긴
   * 키와 같은 lookup 에만 {@link #reclaimableBy} 를 묻는다.
   */
  String bindingKey();

  /**
   * 이 정션에 행이 있으면 그 파일이 「화면에 보이는 첨부」인지(WP-1399). true 인 정션에 묶인 파일은 같은 file 행을 공유하는 다른 곳(드라이브로 가져간
   * 사본, WP-722)이 영구 삭제될 때 만료를 걸면 안 된다 — 만료 스윕이 file 행을 지우면 정션이 CASCADE 로 함께 사라져 원본 첨부가 조용히 없어진다.
   *
   * <p>기본 false. 노트(강등 행이 남은 채 만료되는 것이 정상)·메일 임시저장(묶인 채 보류·소비 만료를 거는 스테이징)처럼 행 존재만으로 「살아 있음」을 말할 수
   * 없는 정션은 false 로 둔다.
   */
  default boolean visibleAttachment() {
    return false;
  }

  /**
   * {@code fileId} 열의 파일이 이 정션에 묶여 있지 <b>않다</b>는 SQL 조건 — 다른 쿼리에 끼워 한 문장으로 거르는 데 쓴다(WP-1399, {@link
   * AttachmentBindings}).
   */
  Condition notBound(Field<Long> fileId);

  /**
   * {@code fileIds} 중 이 정션에 묶여 있지만 호출자가 다시 가져올 수 있는 id(예: 호출자 본인 소유 엔터티에 묶인 파일). 호출자가 이 lookup 의
   * {@link #bindingKey()} 를 지목했을 때만 불린다. 기본은 없음.
   */
  default Set<Long> reclaimableBy(long callerId, Collection<Long> fileIds) {
    return Set.of();
  }
}
