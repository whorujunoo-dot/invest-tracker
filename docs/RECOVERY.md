# 복구 절차서

문제가 생겼을 때 이 순서대로 하면 됩니다. 1년에 한 번은 실제로 따라 해 보세요.

## 데이터가 어디에 있는가

| 무엇 | 1차 보관 | 2차 보관 (암호화) |
|---|---|---|
| 기록·분류·이력 | Supabase 데이터베이스 | Backblaze `girokso-backup/restic` (매일, 날짜별 보관) |
| 음성·사진·링크 사본 원본 | Cloudflare R2 `girokso-originals` | Backblaze `girokso-backup/originals-encrypted` (매일 추가, 덮어쓰기·삭제 없음) |
| 텔레그램 원 메시지 | 데이터베이스 `raw_inputs` + R2 `raw/` | 위 두 백업에 모두 포함 |
| 마크다운 내보내기 | — | restic 백업 안의 `export/` |

열쇠는 `BACKUP_PASSPHRASE` 하나입니다. 이것만 있으면 아래 모든 복구가 가능합니다.

## 경우 1. 실수로 기록을 지웠다

웹 → 휴지통 → 기록 열기 → "휴지통에서 되살리기". 휴지통은 자동으로 비워지지 않습니다.

## 경우 2. AI 처리 결과가 이상하다

기록 상세 → "처리 다시 하기". 이전 결과는 "이력과 보관 정보"에 남습니다. 원문은 AI가 건드릴 수 없습니다.

## 경우 3. Supabase 데이터베이스가 망가졌거나 사라졌다

1. 새 Supabase 프로젝트를 만들고 Session pooler 주소를 받는다
2. 컴퓨터에 restic, PostgreSQL 17 도구를 설치한다
3. 최신 백업 꺼내기:
   ```
   export RESTIC_REPOSITORY=... RESTIC_PASSWORD=(BACKUP_PASSPHRASE)
   export AWS_ACCESS_KEY_ID=(B2_KEY_ID) AWS_SECRET_ACCESS_KEY=(B2_APPLICATION_KEY)
   restic snapshots                     # 날짜별 백업 목록
   restic restore latest --target ./restored
   ```
4. 새 데이터베이스에 되살리기 (`.github/workflows/verify-restore.yml`의 "빈 데이터베이스에 되살리기" 단계와 똑같이):
   ```
   DUMP=$(find restored -name girokso.dump | head -1)
   psql "$새주소" -c "create extension if not exists pg_trgm"
   pg_restore --no-owner --no-privileges --section=pre-data  -d "$새주소" "$DUMP"
   pg_restore --no-owner --no-privileges --section=data --section=post-data -d "$새주소" "$DUMP"
   ```
5. Vercel의 `DATABASE_URL`, GitHub의 `DATABASE_URL_SESSION`을 새 주소로 바꾼다

## 경우 4. Cloudflare R2가 사라졌다

1. 새 저장소(R2든 다른 S3 호환 저장소든)를 만든다
2. rclone으로 암호화 사본을 풀어서 그대로 복사한다:
   ```
   rclone copy b2crypt: 새저장소:girokso-originals
   ```
   (b2crypt 설정은 `.github/workflows/backup.yml` 위쪽의 RCLONE_CONFIG 값과 같게)
3. Vercel의 R2 설정값을 새 저장소로 바꾼다

## 경우 5. 이 앱을 버리고 다른 곳으로 옮긴다

restic 백업 안의 `export/`를 꺼내면 됩니다.
- `records/`: 기록마다 마크다운 파일 하나. Obsidian 같은 프로그램에서 바로 열립니다
- `data/`: 모든 표의 전체 내용
- 원본 파일은 경우 4처럼 꺼내면 머리말의 `path`와 같은 경로에 있습니다
