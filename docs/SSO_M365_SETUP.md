# M365 SSO 로그인 설정 (WP-48)

## 1. 운영자: Entra 앱 등록 (한 번)
1. Entra 관리 센터 → 앱 등록 → 새 등록
   - 지원 계정 유형: **모든 조직 디렉터리의 계정(멀티테넌트)**
   - 리디렉션 URI: 플랫폼 **Web**, `https://<web-host>/api/v1/auth/sso/callback` (SPA 로 등록하면 서버 측 시크릿 교환이 거부됨)
2. 인증서 및 비밀 → 새 클라이언트 비밀 → 값 보관(만료일 기록)
3. 토큰 구성 → 선택적 클레임 추가 → ID 토큰: `email`, `upn`, `xms_edov`
4. API 권한: Microsoft Graph 위임 `openid`, `profile`, `email` (기본값)
5. env 주입: `SSO_M365_CLIENT_ID`(애플리케이션 ID), `SSO_M365_CLIENT_SECRET`, `SSO_M365_REDIRECT_URI` — compose `.env` 와 Helm 차트 values(`~/k8s/smart-workplace`) 모두. 적용 후 api 재시작.

## 2. 워크스페이스 관리자
1. 설정 › SSO → "SSO 로그인 사용" 켜기
2. "관리자 동의 링크"를 회사 Entra 관리자에게 전달 → 승인
3. 설정 › 구성원 › 구성원 추가 → 로그인 방식 "SSO 전용", 아이디 = 회사 Microsoft 계정 주소

## 3. 확인
- 로그인 화면 "Microsoft 계정으로 로그인" → 등록된 계정은 진입, 미등록은 "등록되지 않은 Microsoft 계정입니다."
- 시크릿 만료 시 로그인은 "다시 시도" 로 보이고 api 로그에 `SSO 토큰 교환 실패: 클라이언트 인증 오류` ERROR 가 남는다 → 시크릿 재발급
