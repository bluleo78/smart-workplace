package com.workplace.file.api;

import java.util.Collection;
import java.util.Set;

/**
 * 만료 정리 스윕이 파일을 실제로 지우기 직전에 도메인에 되묻는 훅(#759).
 *
 * <p>왜 필요한가: 만료(`file.expires_at`)는 업로드 직후의 임시 파일뿐 아니라 "참조가 빠져 유예 중" 인 파일에도 붙는다(노트 첨부 강등). 그런데 참조
 * 판정은 판정한 도메인만 정확히 알 수 있고, 판정 시점과 삭제 시점 사이에는 유예 기간만큼의 간극이 있다. 그 사이에 참조가 되살아났는데 스윕이 그대로 지우면 살아 있는
 * 데이터가 사라진다.
 *
 * <p>{@code file} 코어가 {@code wiki} 를 직접 import 하면 의존 방향이 코어 → 도메인으로 뒤집히므로, 도메인이 구현하는 SPI 로
 * 둔다({@code drive.api.AttachmentSourceProvider} 와 같은 형태).
 */
public interface ExpiredFileRetentionPolicy {

  /**
   * 만료됐지만 <b>지우면 안 되는</b> fileId 를 돌려준다. 현재 테넌트 컨텍스트(GUC 주입된 트랜잭션) 안에서 호출된다.
   *
   * <p>구현 주의: 보존하기로 했다고 만료를 <b>해제</b>(NULL)하면 안 된다. 재무장 트리거가 도메인 저장 경로뿐이라면, 이후 참조가 모두 사라져도 다시 만료가
   * 붙지 않아 영구 고아가 된다. 만료를 다음 유예 뒤로 <b>미루는</b> 것이 맞다 — 그러면 참조가 사라진 뒤 다음 사이클에 정상 회수된다.
   *
   * <p>예외: 그 file 의 수명을 <b>다른 소유자가 넘겨받은</b> 경우(예: 드라이브로 가져가 drive_file 이 같은 행을 가리킴 —
   * DriveReferencedFileRetentionPolicy, WP-1392)에는 만료를 해제해도 된다. 드라이브 영구 삭제가 그 file 에 만료를 다시 걸어 회수
   * 흐름으로 돌려보내기 때문이다. 단, 원래 자리에 아직 보이는 첨부로 묶여 있으면(이슈·채팅·홈 첨부, 강등 안 된 노트 첨부·본문 이미지 — {@link
   * AttachmentBindings#notVisiblyBound}, WP-1399) 드라이브는 만료를 걸지 않고 그 file 은 원래 도메인의 수명(첨부 삭제·강등이 만료를
   * 건다)을 따른다. 어느 쪽이든 수명을 이어받는 소유자가 있어 영구 고아가 되지 않는다. 미루기만 하면 같은 행이 매 사이클 스윕 앞자리를 차지한다.
   *
   * <p>정책들은 순서 없이 차례로 불리고 결과는 합집합이다. 같은 id 의 만료를 두 정책이 서로 다르게(해제 vs 재무장) 바꾸면 최종 상태가 순서에 따라 갈리므로, 한
   * id 의 만료는 한 정책만 바꾼다 — 드라이브가 쓰는 file 은 드라이브 정책 몫이고 노트·본문 이미지 정책은 그 id 를 건너뛴다(WP-1392).
   */
  Set<Long> retain(Collection<Long> expiringFileIds);
}
