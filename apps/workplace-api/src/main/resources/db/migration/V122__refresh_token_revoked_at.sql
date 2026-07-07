-- V122: refresh_token 에 폐기 시각 컬럼 추가 — grace period(크로스탭 경쟁 완화) 판단에 사용.
ALTER TABLE refresh_token ADD COLUMN revoked_at TIMESTAMP NULL;
