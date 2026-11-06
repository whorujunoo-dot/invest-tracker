# 기록소 설치 안내

휴대폰 브라우저로도 따라 할 수 있게 순서대로 적었습니다. 전체 40분 정도 걸립니다.
**받은 키와 비밀번호는 채팅에 붙여 넣지 말고**, 비밀번호 관리자에 먼저 모아 두었다가 7·8단계에서 Vercel과 GitHub에 넣으세요.

모아 둘 값의 이름은 [`.env.example`](../.env.example)에 있습니다.

---

## 1. GitHub 저장소 (2분)

1. github.com/new 에서 저장소 이름 `girokso`, **Private(비공개)**, 나머지는 체크하지 않고 만들기
2. Claude에게 "저장소 만들었어"라고 알려 주면 코드를 옮겨 둡니다

## 2. 텔레그램 봇 (3분)

1. 텔레그램에서 `@BotFather` 검색 → `/newbot` → 이름 `기록소`, 아이디는 `..._bot`으로 끝나게 아무거나
2. 받은 토큰 → `TELEGRAM_BOT_TOKEN`
3. `@userinfobot` 에게 아무 말이나 보내면 숫자 ID가 나옴 → `TELEGRAM_OWNER_ID`
4. **텔레그램 설정 → 개인정보 및 보안 → 2단계 인증**을 켜 두세요

## 3. Supabase 데이터베이스 (5분)

1. supabase.com 가입 → New project
   - 이름 `girokso`, 지역 **Northeast Asia (Seoul)**
   - 데이터베이스 비밀번호는 비밀번호 관리자로 생성해 보관
2. 프로젝트 화면 위쪽 **Connect** 버튼
   - **Transaction pooler** 주소 → `DATABASE_URL` (`[YOUR-PASSWORD]` 자리에 비밀번호 넣기)
   - **Session pooler** 주소 → `DATABASE_URL_SESSION`
3. 계정 설정에서 2단계 인증 켜기

## 4. Cloudflare R2 원본 저장소 (5분)

1. cloudflare.com 가입 → R2 Object Storage → 결제 수단 등록 (10GB까지 무료)
2. **Create bucket** → 이름 `girokso-originals`
3. **Manage API tokens → Create API token**
   - 권한 Object Read & Write, 대상은 `girokso-originals` 버킷만
   - Access Key ID → `R2_ACCESS_KEY_ID`, Secret Access Key → `R2_SECRET_ACCESS_KEY`
4. R2 첫 화면 오른쪽의 Account ID → `R2_ACCOUNT_ID`

## 5. Backblaze B2 백업 저장소 (5분)

1. backblaze.com 가입 (10GB까지 무료)
2. **Buckets → Create a Bucket** → 이름 `girokso-backup`, **Private**
3. 버킷 정보의 Endpoint(예: `s3.us-west-004.backblazeb2.com`)를 보고
   `RESTIC_REPOSITORY` = `s3:` + Endpoint + `/girokso-backup/restic`
4. **Application Keys → Add a New Application Key** → 이 버킷만, Read and Write
   - keyID → `B2_KEY_ID`, applicationKey → `B2_APPLICATION_KEY`
5. `BACKUP_PASSPHRASE`: 비밀번호 관리자로 긴 암호를 만들고 **종이에도 적어 보관**하세요.
   이 암호를 잃으면 백업을 아무도 열 수 없습니다.

## 6. AI 키 (5분)

- console.anthropic.com → API Keys → `ANTHROPIC_API_KEY`
- platform.openai.com → API keys → `OPENAI_API_KEY` (음성 받아쓰기용)
- 두 곳 모두 월 사용 한도를 정해 두세요 (예: 각 10달러)

## 7. Vercel 배포 (5분)

1. vercel.com 에 GitHub 계정으로 가입 → Add New → Project → `girokso` 저장소 선택
2. Environment Variables에 `.env.example`의 위쪽 값들을 넣기
   (`DATABASE_URL`부터 `APP_TIME_ZONE`까지. `APP_PASSWORD`는 웹 로그인 비밀번호,
   `SESSION_SECRET`·`CRON_SECRET`·`TELEGRAM_WEBHOOK_SECRET`은 각각 다른 긴 무작위 글자)
3. Deploy → 끝나면 나오는 주소(예: `https://girokso-xxx.vercel.app`) → `APP_URL`

## 8. GitHub 비밀 설정 (5분)

저장소 → Settings → Secrets and variables → Actions → New repository secret 으로 아래를 넣습니다.

`APP_URL`, `CRON_SECRET`, `DATABASE_URL_SESSION`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`TELEGRAM_OWNER_ID`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, `RESTIC_REPOSITORY`, `BACKUP_PASSPHRASE`

## 9. 연결과 첫 시험 (5분)

1. 저장소 → **Actions → 설치·연결 → Run workflow**. 데이터베이스를 만들고 봇을 연결합니다
2. 텔레그램에서 만든 봇에게 음성 메시지를 하나 보내기
   → "✓ 저장됨"이 오고, 잠시 뒤 교정본이 답장으로 오면 성공
3. `APP_URL`로 들어가 로그인 → 방금 기록이 보이는지 확인
4. **Actions → 매일 백업 → Run workflow** → 초록색이면 성공
5. **Actions → 월간 복구 검증 → Run workflow** → 텔레그램에 "복구 검증 통과"가 오면 성공

이후로는 백업이 매일, 복구 검증이 매월 저절로 돌고 결과가 텔레그램으로 옵니다.
