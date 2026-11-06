-- 기록소 데이터 구조 1판
-- 원칙: 원본(raw_inputs, blobs, records의 원문 열)은 한 번 쓰면 바뀌지 않는다.
-- AI가 만든 결과(derivations)는 언제든 버리고 다시 만들 수 있는 부산물이다.

create extension if not exists pg_trgm;

-- ───────────────────────── 원본 계층 ─────────────────────────

-- 텔레그램에서 받은 메시지 원문 그대로 (수정·삭제 불가)
create table raw_inputs (
  id              bigserial primary key,
  source          text        not null default 'telegram',
  external_id     text        not null,
  received_at     timestamptz not null default now(),
  payload         jsonb       not null,
  payload_sha256  text        not null,
  storage_key     text,
  unique (source, external_id)
);

-- 원본 파일(음성·사진·링크 사본). 내용의 SHA-256 값이 곧 이름이다.
create table blobs (
  sha256       text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key  text        not null,
  mime_type    text,
  size_bytes   bigint      not null check (size_bytes >= 0),
  created_at   timestamptz not null default now()
);

-- 기록 한 건
create table records (
  id             uuid primary key default gen_random_uuid(),
  raw_input_id   bigint references raw_inputs(id),
  kind           text not null check (kind in ('text','voice','image','link','file')),
  occurred_at    timestamptz not null,
  original_text  text,
  source_ref     jsonb not null default '{}'::jsonb,
  tags           text[] not null default '{}',
  status         text not null default 'pending'
                 check (status in ('pending','ready','partial','failed')),
  ai_excluded    boolean not null default false,
  search_text    text not null default '',
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index records_occurred_idx on records (occurred_at desc) where deleted_at is null;
create index records_tags_idx on records using gin (tags);
create index records_search_trgm_idx on records using gin (search_text gin_trgm_ops);
create unique index records_telegram_msg_idx
  on records ((source_ref->>'chat_id'), (source_ref->>'message_id'))
  where source_ref ? 'message_id';

create table record_files (
  record_id    uuid not null references records(id),
  blob_sha256  text not null references blobs(sha256),
  role         text not null check (role in ('original','snapshot')),
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  primary key (record_id, blob_sha256, role)
);

-- 본인이 고친 본문, 텔레그램에서 수정한 메시지. 이전 판은 모두 남는다.
create table record_versions (
  id          bigserial primary key,
  record_id   uuid not null references records(id),
  body        text not null,
  source      text not null check (source in ('user','telegram_edit')),
  created_at  timestamptz not null default now()
);
create index record_versions_record_idx on record_versions (record_id, created_at desc);

-- ───────────────────────── 부산물 계층 ─────────────────────────

-- AI·자동 처리 결과. 새 결과가 생기면 이전 것은 superseded_at 표시만 하고 남긴다.
create table derivations (
  id              bigserial primary key,
  record_id       uuid not null references records(id),
  type            text not null check (type in ('transcript','correction','image_text','link_snapshot')),
  text            text,
  content         jsonb not null default '{}'::jsonb,
  model           text,
  prompt_version  text,
  created_at      timestamptz not null default now(),
  superseded_at   timestamptz
);
create index derivations_current_idx on derivations (record_id, type) where superseded_at is null;

-- 처리 대기열. 실패해도 원본은 이미 저장되어 있다.
create table jobs (
  id          bigserial primary key,
  record_id   uuid not null references records(id),
  type        text not null check (type in ('fetch_file','transcribe','correct','image_text','link_snapshot')),
  status      text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts    int  not null default 0,
  last_error  text,
  run_after   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index jobs_queue_idx on jobs (run_after) where status in ('queued','running');

-- 받아쓰기·교정에 쓰는 단어장 (종목명, 상품명, 거래처 등)
create table vocabulary (
  term        text primary key,
  note        text,
  created_at  timestamptz not null default now()
);

-- 모든 변경 기록
create table audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text not null,
  action     text not null,
  record_id  uuid,
  detail     jsonb not null default '{}'::jsonb
);

-- 백업·복구 검증 결과
create table maintenance_runs (
  id          bigserial primary key,
  kind        text not null check (kind in ('backup','restore_check','export')),
  ok          boolean not null,
  detail      jsonb not null default '{}'::jsonb,
  started_at  timestamptz not null default now()
);

-- ───────────────────────── 보호 장치 ─────────────────────────
-- 완전 삭제는 세션 설정 girokso.allow_purge = 'on' 일 때만 가능하다 (두 단계 확인 후 앱이 켬).

create function girokso_purge_allowed() returns boolean language sql stable as $$
  select coalesce(current_setting('girokso.allow_purge', true), '') = 'on'
$$;

create function girokso_block_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and girokso_purge_allowed() then
    return old;
  end if;
  raise exception '% 표의 원본은 수정하거나 삭제할 수 없습니다', tg_table_name
    using errcode = 'insufficient_privilege';
end $$;

create trigger raw_inputs_immutable before update or delete on raw_inputs
  for each row execute function girokso_block_change();
create trigger blobs_immutable before update or delete on blobs
  for each row execute function girokso_block_change();
create trigger record_files_immutable before update or delete on record_files
  for each row execute function girokso_block_change();
create trigger record_versions_immutable before update or delete on record_versions
  for each row execute function girokso_block_change();
create trigger audit_log_immutable before update or delete on audit_log
  for each row execute function girokso_block_change();

-- records: 원문 관련 열은 고정, 태그·상태·휴지통·검색용 열만 바뀔 수 있다.
create function girokso_records_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if girokso_purge_allowed() then return old; end if;
    raise exception '기록은 휴지통으로만 옮길 수 있습니다 (deleted_at 사용)'
      using errcode = 'insufficient_privilege';
  end if;
  if new.id is distinct from old.id
     or new.raw_input_id is distinct from old.raw_input_id
     or new.kind is distinct from old.kind
     or new.occurred_at is distinct from old.occurred_at
     or new.original_text is distinct from old.original_text
     or new.source_ref is distinct from old.source_ref
     or new.created_at is distinct from old.created_at then
    raise exception '기록의 원문 정보는 바꿀 수 없습니다'
      using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger records_guard before update or delete on records
  for each row execute function girokso_records_guard();

-- derivations: 지우지 못하고, 이전 결과로 표시(superseded_at)하는 것만 허용
create function girokso_derivations_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if girokso_purge_allowed() then return old; end if;
    raise exception '처리 결과는 삭제할 수 없습니다' using errcode = 'insufficient_privilege';
  end if;
  if (to_jsonb(new) - 'superseded_at') is distinct from (to_jsonb(old) - 'superseded_at') then
    raise exception '처리 결과는 수정할 수 없습니다. 새 결과를 추가하세요'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger derivations_guard before update or delete on derivations
  for each row execute function girokso_derivations_guard();

-- Supabase가 자동으로 여는 외부 접근 통로를 모두 잠근다.
-- 앱은 데이터베이스 소유자 계정으로 직접 접속하므로 영향이 없다.
alter table raw_inputs       enable row level security;
alter table blobs            enable row level security;
alter table records          enable row level security;
alter table record_files     enable row level security;
alter table record_versions  enable row level security;
alter table derivations      enable row level security;
alter table jobs             enable row level security;
alter table vocabulary       enable row level security;
alter table audit_log        enable row level security;
alter table maintenance_runs enable row level security;
