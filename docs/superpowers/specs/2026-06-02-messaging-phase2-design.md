# Messaging Phase 2 — 비공개 채널 + 채널 CRUD/탐색 설계

> Phase 1(공개 채널 + 메시지 + SSE 실시간 + 멤버십)의 후속. 로드맵상 Phase 2.
> 선행 설계: [2026-06-01-messaging-phase1-design.md](2026-06-01-messaging-phase1-design.md)

## 배경 & 목표

Phase 1은 공개 채널 목록 + "참여" + 메시지/실시간을 제공하지만 **채널 생성 UI 자체가 없고**(백엔드 `POST /channels`만 존재), 비공개 채널·채널 관리·탐색이 없다.

Phase 2는 다음을 통합 제공한다:
- **채널 생성 UI** (공개/비공개 토글) — Phase 1의 누락분 포함
- **비공개 채널** (초대제, 존재 은닉)
- **채널 CRUD** — 이름 변경, 아카이브/해제, (시스템 ADMIN) 하드 삭제
- **탐색(discovery)** — 공개 채널 검색·참여
- **멤버 관리** — 역할(OWNER/ADMIN/MEMBER), 초대·제거·역할변경·나가기

## 비목표 (Phase 2)

- 채널 메타 변경(생성·아카이브·멤버 추가)의 **cross-user 실시간 푸시** — 다음 진입/새로고침 시 갱신. 행위 당사자만 쿼리 무효화로 즉시 반영.
- 읽음/안읽음(`last_read`)·멘션·메시지 수정·삭제 (Phase 4)
- DM(`kind=DM`) (Phase 3), 쓰레드·리액션 (Phase 5), 파일 (Phase 6), AI 멤버 (Phase 7)
- 채널 설명/토픽, 채널별 알림 설정

---

## 데이터 모델

### 스키마 변경 — `V20__messaging_phase2.sql`

```sql
-- 채널 멤버 역할: OWNER(소유자, 1명) / ADMIN(관리자) / MEMBER(일반)
ALTER TABLE channel_member
  ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'MEMBER';

-- 백필: 기존 채널의 생성자를 OWNER 로 승격 (나머지는 DEFAULT 'MEMBER')
UPDATE channel_member cm
  SET role = 'OWNER'
  FROM channel c
  WHERE cm.channel_id = c.id AND cm.user_id = c.created_by;

-- 탐색 성능: 공개·비아카이브 채널 조회 부분 인덱스
CREATE INDEX idx_channel_discover ON channel (visibility) WHERE archived_at IS NULL;
```

- `visibility`(`'PUBLIC'`/`'PRIVATE'`), `archived_at` 컬럼은 **Phase 1 스키마에 이미 존재** → 신규 없음.
- `role` 허용값은 애플리케이션에서 검증(`OWNER`/`ADMIN`/`MEMBER`). DB CHECK는 두지 않음(Phase 1 컨벤션 따라 값 검증은 서비스 레이어).

### 불변식

- 채널당 OWNER는 정확히 1명. 소유권 이전 = 새 OWNER 승격 + 기존 OWNER → ADMIN 강등(한 트랜잭션).
- OWNER는 채널을 나가기 전 반드시 소유권을 이전. 혼자 남은 경우 나가기 불가(아카이브만).

---

## 권한 모델

채널 역할 + **시스템 ADMIN 오버라이드**(`PermissionChecker.userHasRole(callerId, "ADMIN")`, 프로젝트 모듈과 동일 패턴).

| 동작 | OWNER | 채널 ADMIN | MEMBER | 시스템 ADMIN |
|---|:---:|:---:|:---:|:---:|
| 메시지 전송 | ✓ | ✓ | ✓ | 멤버일 때만 |
| 이름 변경 | ✓ | ✓ | ✗ | ✓ |
| 멤버 추가/제거 | ✓ | ✓ | ✗ | ✓ |
| 역할 변경·소유권 이전 | ✓ | ✗ | ✗ | ✓ |
| 아카이브/해제 | ✓ | ✗ | ✗ | ✓ |
| 하드 삭제 | ✗ | ✗ | ✗ | ✓ (유일) |
| 나가기 | 이전 후만 | ✓ | ✓ | — |

**핵심 규칙**
- **비공개 은닉**: 비멤버에게 비공개 채널은 존재하지 않는 것처럼 → 상세/메시지 접근 시 **404**(`ChannelNotFoundException` 재사용). 탐색 결과에 절대 미포함.
- **공개 join**: `POST /channels/{id}/join`은 공개 채널만. 비공개 대상이면 **403**.
- **아카이브 읽기전용**: 아카이브 채널에 메시지 전송 시 **409**. 사이드바에서 숨김. 히스토리 보존. OWNER만 해제.
- **OWNER 제거 불가**: 멤버 제거 API로 OWNER는 제거 불가(소유권 이전 후 본인 나가기로만).
- **멤버 제거 권한**: ADMIN은 MEMBER/다른 ADMIN 제거 가능하나 OWNER 불가. OWNER는 OWNER 외 전원 제거 가능.

---

## 백엔드 설계

### REST API (`/api/v1/messaging`)

| Method | Path | 설명 | 권한 | 응답 |
|---|---|---|---|---|
| GET | `/channels` | 내 채널(공개+비공개, 아카이브 제외) — 사이드바 | 멤버 | `List<ChannelResponse>` |
| GET | `/channels/discover?q=` | 공개·비아카이브 채널 검색 | 인증 | `List<ChannelResponse>` |
| POST | `/channels` | 생성 `{name, visibility}`, 생성자 OWNER 자동 합류 | 인증 | `ChannelResponse` (201) |
| GET | `/channels/{id}` | 상세(내 역할·멤버수 포함) | 공개=인증 / 비공개=멤버(비멤버→404) | `ChannelResponse` |
| PATCH | `/channels/{id}` | 이름 변경 `{name}` | OWNER/ADMIN | `ChannelResponse` |
| POST | `/channels/{id}/archive` | 아카이브 | OWNER | 204 |
| POST | `/channels/{id}/unarchive` | 아카이브 해제 | OWNER | 204 |
| DELETE | `/channels/{id}` | 하드 삭제(CASCADE) | 시스템 ADMIN | 204 |
| POST | `/channels/{id}/join` | 공개 채널 참여 | 인증(비공개→403) | 204 |
| GET | `/channels/{id}/members` | 멤버 목록 | 멤버 | `List<ChannelMemberResponse>` |
| POST | `/channels/{id}/members` | 추가 `{userId}` | OWNER/ADMIN | 204 |
| DELETE | `/channels/{id}/members/{userId}` | 제거 | OWNER/ADMIN(OWNER 대상 불가) | 204 |
| POST | `/channels/{id}/leave` | 나가기 | 본인 | 204 |
| PATCH | `/channels/{id}/members/{userId}` | 역할 변경·소유권 이전 `{role}` | OWNER | 204 |

> `discover`는 공개 채널만 다루므로 인증만으로 충분(비공개는 결과에서 원천 제외). 내가 이미 멤버인 공개 채널도 결과에 포함하되 `member=true`로 표시(중복 참여는 idempotent).

### 서비스

- **`ChannelService`** — `list` / `discover` / `create` / `getDetail` / `rename` / `archive` / `unarchive` / `hardDelete` / `join`.
- **`ChannelMemberService`** — `listMembers` / `add` / `remove` / `leave` / `updateRole`.
  - 소유권 이전: 대상 OWNER 승격 + 본인 ADMIN 강등을 한 `@Transactional` 안에서.
  - `leave`: OWNER이고 다른 멤버가 있으면 `OwnershipTransferRequiredException`. 마지막 1인(OWNER)이면 동일 예외(아카이브 유도).
- **`MessageService.create`** — 전송 전 `ensureNotArchived(channelId)` 추가 → 아카이브면 `ChannelArchivedException`.
- **`ChannelPermissions`** (내부 헬퍼/컴포넌트) — 권한 판정 일원화:
  - `requireMember(channelId, callerId)`, `requireManage(channelId, callerId)`(OWNER/ADMIN or 시스템 ADMIN), `requireOwner(...)`, `requireSystemAdmin(callerId)`.
  - 비공개 채널 비멤버는 `requireMember`에서 `ChannelNotFoundException`(은닉). 단 상세 조회(`getDetail`)는 공개 채널이면 비멤버에게도 허용(가입 전 미리보기), 비공개면 404. 메시지 히스토리/전송은 Phase 1대로 공개·비공개 모두 멤버 한정.

### 리포지토리 추가 메서드

- **`ChannelRepository`**
  - `long insert(String name, String visibility, long createdBy)` — 기존 `insertPublic` 일반화(visibility 파라미터화).
  - `List<ChannelResponse> findMyChannels(long callerId)` — 멤버이고 `archived_at IS NULL`, 이름 정렬. `role` 포함.
  - `List<ChannelResponse> searchDiscoverable(long callerId, String q)` — `visibility='PUBLIC' AND archived_at IS NULL`, 이름 ILIKE, `member`/`role` 포함.
  - `Optional<ChannelResponse> findDetail(long channelId, long callerId)` — 멤버수·내 역할 포함.
  - `void rename(long channelId, String name)`
  - `void setArchived(long channelId, boolean archived)` — `archived_at = NOW()` 또는 `NULL`.
  - `void hardDelete(long channelId)`
  - `boolean isArchived(long channelId)`
- **`ChannelMemberRepository`**
  - `void add(long channelId, long userId, String role)` — 기존 `join` 확장(ON CONFLICT DO NOTHING).
  - `void remove(long channelId, long userId)`
  - `Optional<String> findRole(long channelId, long userId)`
  - `void updateRole(long channelId, long userId, String role)`
  - `List<ChannelMemberResponse> listMembers(long channelId)` — `"user"` 조인(name, kind).
  - `int countMembers(long channelId)`

### DTO

```
ChannelResponse(Long id, String kind, String name, String visibility,
                boolean member, String role,        // role: null if not member
                boolean archived, int memberCount, Instant createdAt)

ChannelMemberResponse(Long userId, String name, String kind, String role, Instant joinedAt)

CreateChannelRequest(@NotBlank @Size(1,80) String name, String visibility)  // visibility null → PUBLIC
RenameChannelRequest(@NotBlank @Size(1,80) String name)
AddMemberRequest(@NotNull Long userId)
UpdateRoleRequest(@NotNull String role)  // OWNER|ADMIN|MEMBER, 서비스 검증
```

> `ChannelResponse`에 `role`/`archived`/`memberCount` 필드 추가(Phase 1 대비 확장). Phase 1 프론트는 `member`/`createdAt`만 사용했으므로 필드 추가는 하위호환.

### 예외 → HTTP 매핑 (`GlobalExceptionHandler`)

- `ChannelForbiddenException` → **403** (역할 부족)
- `ChannelArchivedException` → **409** (아카이브 채널 전송/수정)
- `OwnershipTransferRequiredException` → **409** (OWNER 나가기 차단)
- `ChannelNotFoundException` → **404** (기존, 비공개 비멤버 은닉에도 사용)

---

## 프론트엔드 설계

### 타입 (`types/messaging.ts`)

```ts
export type ChannelVisibility = 'PUBLIC' | 'PRIVATE'
export type ChannelRole = 'OWNER' | 'ADMIN' | 'MEMBER'

// ChannelResponse 확장
interface ChannelResponse {
  id: number; kind: string; name: string; visibility: ChannelVisibility
  member: boolean; role: ChannelRole | null
  archived: boolean; memberCount: number; createdAt: string
}
interface ChannelMemberResponse {
  userId: number; name: string; kind: UserKind; role: ChannelRole; joinedAt: string
}
interface CreateChannelRequest { name: string; visibility: ChannelVisibility }
interface RenameChannelRequest { name: string }
```

### API (`api/messaging.ts`)

추가: `discoverChannels(q)`, `getChannel(id)`, `renameChannel(id, name)`, `archiveChannel(id)`, `unarchiveChannel(id)`, `deleteChannel(id)`, `listMembers(id)`, `addMember(id, userId)`, `removeMember(id, userId)`, `leaveChannel(id)`, `updateMemberRole(id, userId, role)`. 기존 `createChannel`은 `{name, visibility}` 페이로드로 확장.

### 훅 (`hooks/queries/`)

`useMyChannels`(기존 `useChannels` 의미 변경: 내 채널만), `useDiscoverChannels(q)`, `useCreateChannel`, `useChannelDetail(id)`, `useRenameChannel`, `useArchiveChannel`, `useUnarchiveChannel`, `useDeleteChannel`, `useChannelMembers(id)`, `useAddMember`, `useRemoveMember`, `useLeaveChannel`, `useUpdateMemberRole`. 모든 변경 뮤테이션은 `messagingKeys.channels()` 및 관련 상세/멤버 쿼리 무효화.

### 컴포넌트 / 페이지

- **`ChannelSidebar`** 개편 — `useMyChannels`로 내 채널만. 상단 `+ 채널`(생성 모달), `탐색`(브라우저) 액션. 비공개 채널엔 자물쇠 아이콘.
- **`CreateChannelModal`** — 이름 입력 + 공개/비공개 토글. 생성 성공 시 새 채널로 라우팅.
- **`ChannelBrowser`** (탐색 모달) — `useDiscoverChannels(q)` 검색 입력 + 결과 목록, 비멤버엔 "참여". 비공개는 미노출.
- **`ChannelHeader`** — 채널명·멤버수, 설정 드롭다운(이름변경·아카이브/해제: OWNER/ADMIN 가시), `멤버` 버튼, 시스템 ADMIN에겐 삭제. 아카이브 상태 뱃지.
- **`ChannelMembersPanel`** — 멤버 목록(역할 뱃지) + `MemberSearchPopover`(프로젝트 모듈 재사용)로 추가, 제거 버튼, 역할 드롭다운(OWNER만, 소유권 이전 포함), `나가기`. 권한별 액션 노출/숨김.
- **`MessageComposer`** — 아카이브 채널이면 입력 비활성 + "이 채널은 보관되었습니다" 안내.

---

## 데이터 흐름

**채널 생성**: 모달 제출 → `POST /channels {name, visibility}` → 생성자 OWNER 합류 → `channels` 무효화 → 새 채널로 이동.

**공개 탐색·참여**: 탐색 모달 검색 → `GET /discover?q=` → "참여" → `POST /{id}/join`(MEMBER) → `channels` 무효화 → 사이드바에 등장.

**비공개 초대**: OWNER/ADMIN가 멤버 패널에서 사용자 검색 → `POST /{id}/members {userId}` → 멤버·상세 무효화. (초대된 사용자 화면엔 새로고침/재진입 시 반영 — 실시간 푸시는 비목표.)

**소유권 이전 후 나가기**: OWNER가 멤버 역할 드롭다운에서 대상 OWNER 지정 → `PATCH /{id}/members/{userId} {role:OWNER}`(본인 ADMIN 강등) → 이후 `POST /{id}/leave`.

**아카이브**: OWNER가 헤더에서 아카이브 → `POST /{id}/archive` → `channels` 무효화로 사이드바에서 사라짐. 진입 중이던 멤버 화면은 composer 비활성.

---

## 에러 처리

- 권한 부족(403) → 토스트 "권한이 없습니다". UI는 애초에 비권한 액션을 숨겨 1차 방어, 서버 403은 2차 방어.
- 아카이브 전송(409) → composer 비활성이 1차, 경합 시 서버 409 → 토스트 + 메시지 목록 새로고침.
- OWNER 나가기 차단(409) → "먼저 소유권을 다른 멤버에게 넘기세요" 안내.
- 비공개 비멤버 접근(404) → 채널 없음 페이지(존재 은닉 유지).

---

## 테스트

### 백엔드 (JUnit 통합)
- **권한 매트릭스**: 이름변경/아카이브/멤버추가/멤버제거/역할변경/삭제를 각 역할(OWNER·ADMIN·MEMBER·시스템ADMIN·비멤버)로 호출 → 기대 status.
- **비공개 은닉**: 비멤버의 `GET /{id}`·메시지 조회 → 404. `discover` 결과에 비공개 미포함. 비공개 `join` → 403.
- **아카이브 읽기전용**: 아카이브 후 메시지 전송 → 409. unarchive 후 정상.
- **소유권/나가기**: OWNER가 멤버 있는 채로 leave → 409. 이전 후 leave → 204. 혼자 OWNER leave → 409.
- **하드삭제**: 시스템 ADMIN만 204, 그 외 403. 삭제 후 메시지 CASCADE 확인.
- **마이그레이션 백필**: 기존 created_by 멤버가 OWNER로 백필되는지(V20 적용 후 검증 테스트).

### 프론트 (Playwright E2E)
- 공개/비공개 채널 생성 → 사이드바 등장(비공개 자물쇠).
- 공개 탐색·참여 흐름.
- (2-유저) 비공개 초대: A가 비공개 생성·B 초대 → B 재진입 시 채널 보임, 비초대 C는 404/미노출.
- 아카이브 → 사이드바 숨김 + composer 비활성.
- 소유권 이전 후 나가기.

---

## 영향 범위 / 호환성

- **Phase 1 프론트 영향**: `useChannels`(전체 공개) → `useMyChannels`(내 채널) 의미 변경. `ChannelSidebar`의 "참여" 버튼 로직은 탐색 화면으로 이동. 기존 `ChannelResponse` 소비처는 필드 추가만이라 안전.
- **이슈 채팅 도메인(`chat`)**: 무관·무변경.
- **DB**: 단일 `ALTER TABLE` + 백필 + 인덱스. 기존 데이터 손실 없음.
