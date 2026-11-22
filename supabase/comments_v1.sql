-- =====================================================================
-- NaMaMeMo コメント機能（v1.11）DBセットアップ
-- 実行場所: Supabase ダッシュボード > SQL Editor に全文を貼って Run
-- 何度実行しても壊れない（if not exists / or replace で冪等）ように書いてある
-- =====================================================================

-- ── 1. nodes にコメント設定の列を追加 ─────────────────────────────
-- comment_mode: 'off'（初期値） | 'approval'（承認制） | 'instant'（即時公開）
-- admin_name  : 持ち主の返信に表示する管理者名（空なら「管理人」と表示）
alter table public.nodes
  add column if not exists comment_mode text not null default 'off',
  add column if not exists admin_name text;

alter table public.nodes drop constraint if exists nodes_comment_mode_check;
alter table public.nodes add constraint nodes_comment_mode_check
  check (comment_mode in ('off', 'approval', 'instant'));

-- ── 2. comments テーブル ──────────────────────────────────────────
create table if not exists public.comments (
  id              uuid primary key default gen_random_uuid(),
  node_id         uuid not null references public.nodes(id) on delete cascade,
  root_id         uuid not null references public.nodes(id) on delete cascade,
  parent_id       uuid references public.comments(id) on delete cascade,
  owner_id        uuid not null,               -- 公開ページ持ち主の user_id
  author_name     text not null default '名無し',
  body            text not null,
  is_owner        boolean not null default false,  -- true は持ち主の返信だけ（サーバー側でのみ立てる）
  status          text not null default 'approved'
                    check (status in ('approved', 'pending')),
  hold_reason     text,                        -- 'ng_word' の時だけ入る（保留の理由）
  ip_hash         text,                        -- IPそのものは保存せず md5 ハッシュだけ
  edit_token_hash text,                        -- 投稿者本人修正用の鍵の md5 ハッシュ
  owner_read      boolean not null default false,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz
);

create index if not exists comments_node_idx  on public.comments(node_id, created_at);
create index if not exists comments_owner_idx on public.comments(owner_id, owner_read, status);
create index if not exists comments_ip_idx    on public.comments(ip_hash, created_at desc);

-- 直接の読み書きは全面禁止。アクセスは下の RPC（SECURITY DEFINER）経由だけ
alter table public.comments enable row level security;

-- ── 3. 共通ヘルパー ───────────────────────────────────────────────

-- ルートが公開中か＆ノードがそのツリー配下かを判定し、ルート行を返す
create or replace function public.comment_check_root(p_root_id uuid, p_node_id uuid)
returns public.nodes
language plpgsql stable security definer set search_path = public as $$
declare
  r public.nodes;
  cur uuid;
  guard int := 0;
begin
  select * into r from public.nodes where id = p_root_id;
  if r.id is null or r.is_public is not true then
    return null;
  end if;
  if p_node_id = p_root_id then
    return r;
  end if;
  select parent_id into cur from public.nodes where id = p_node_id;
  if cur is null then
    return null;
  end if;
  while cur is not null and guard < 100 loop
    if cur = p_root_id then
      return r;
    end if;
    select parent_id into cur from public.nodes where id = cur;
    guard := guard + 1;
  end loop;
  return null;
end $$;

-- 呼び出し元IPのハッシュ（PostgREST のヘッダから取る。取れない環境では 'unknown'）
create or replace function public.comment_ip_hash()
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  hdrs json;
  ip text;
begin
  begin
    hdrs := current_setting('request.headers', true)::json;
  exception when others then
    hdrs := null;
  end;
  ip := coalesce(
    nullif(trim(split_part(coalesce(hdrs ->> 'x-forwarded-for', ''), ',', 1)), ''),
    hdrs ->> 'x-real-ip',
    'unknown'
  );
  return md5(ip || ':namamemo-comment');
end $$;

-- URL個数を数える（http:// / https:// / www. の出現回数）
create or replace function public.comment_url_count(p_body text)
returns int
language sql immutable as $$
  select
    (length(p_body) - length(replace(p_body, 'http://', ''))) / 7
    + (length(p_body) - length(replace(p_body, 'https://', ''))) / 8
    + (length(lower(p_body)) - length(replace(lower(p_body), 'www.', ''))) / 4
$$;

-- あからさまな悪口だけの最小リスト（増減したい時はこの配列を書き換えて再実行）
create or replace function public.comment_ng_hit(p_text text)
returns boolean
language sql immutable as $$
  select exists (
    select 1 from unnest(array[
      '死ね', '殺す', '殺してやる', 'くたばれ', '消えろ',
      '自殺しろ', 'バカヤロー', '馬鹿野郎', 'アホンダラ', 'カス野郎'
    ]) as w
    where position(w in p_text) > 0
  )
$$;

-- ── 4. 公開側RPC ──────────────────────────────────────────────────

-- 公開ページのコメント設定（公開中でなければ mode は 'off' を返す）
create or replace function public.get_public_comment_info(p_root_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r public.nodes;
begin
  select * into r from public.nodes where id = p_root_id;
  if r.id is null or r.is_public is not true then
    return jsonb_build_object('mode', 'off', 'admin_name', null);
  end if;
  return jsonb_build_object(
    'mode', coalesce(r.comment_mode, 'off'),
    'admin_name', nullif(trim(coalesce(r.admin_name, '')), '')
  );
end $$;

-- 公開ページのコメント一覧（承認済み＋自分の投稿だけ承認待ちも見える）
create or replace function public.get_public_comments(
  p_root_id uuid, p_node_id uuid, p_my_ids uuid[] default '{}'
)
returns table (
  id uuid, parent_id uuid, author_name text, body text,
  is_owner boolean, status text, created_at timestamptz, edited_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  r public.nodes;
begin
  r := public.comment_check_root(p_root_id, p_node_id);
  if r.id is null or coalesce(r.comment_mode, 'off') = 'off' then
    return;
  end if;
  return query
    select c.id, c.parent_id, c.author_name, c.body, c.is_owner, c.status, c.created_at, c.edited_at
    from public.comments c
    where c.node_id = p_node_id
      and c.root_id = p_root_id
      and (c.status = 'approved' or c.id = any(coalesce(p_my_ids, '{}')))
    order by c.created_at asc;
end $$;

-- コメント投稿（判定は全部ここでやる）
-- 戻り値 jsonb: ok / error / retry_after / status / id
create or replace function public.post_comment(
  p_root_id uuid, p_node_id uuid,
  p_author_name text, p_body text,
  p_honeypot text, p_edit_token text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.nodes;
  v_name text;
  v_body text;
  v_ip text;
  v_last timestamptz;
  v_latest_body text;
  v_status text;
  v_hold text;
  v_id uuid;
begin
  -- ハニーポット: 人間に見えない欄が埋まっていたら、成功に見せて保存しない
  if coalesce(trim(p_honeypot), '') <> '' then
    return jsonb_build_object('ok', true, 'fake', true);
  end if;

  r := public.comment_check_root(p_root_id, p_node_id);
  if r.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_public');
  end if;
  if coalesce(r.comment_mode, 'off') = 'off' then
    return jsonb_build_object('ok', false, 'error', 'comments_off');
  end if;

  if p_edit_token is null or length(p_edit_token) < 16 then
    return jsonb_build_object('ok', false, 'error', 'bad_token');
  end if;

  v_name := left(coalesce(nullif(trim(p_author_name), ''), '名無し'), 50);
  v_body := trim(coalesce(p_body, ''));
  if v_body = '' then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;
  if char_length(v_body) > 4000 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;
  if public.comment_url_count(v_body) > 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many_urls');
  end if;

  v_ip := public.comment_ip_hash();

  -- 連投制限 180秒（同一IPハッシュの直近の投稿から数える）
  select max(created_at) into v_last
  from public.comments
  where ip_hash = v_ip and is_owner = false;
  if v_last is not null and v_last > now() - interval '180 seconds' then
    return jsonb_build_object(
      'ok', false, 'error', 'rate_limited',
      'retry_after', ceil(extract(epoch from (v_last + interval '180 seconds' - now())))::int
    );
  end if;

  -- 同一内容の連続投稿ブロック（同じノード・同じIP・直前の投稿と完全同一の時だけ）
  select body into v_latest_body
  from public.comments
  where node_id = p_node_id and ip_hash = v_ip and is_owner = false
  order by created_at desc
  limit 1;
  if v_latest_body is not null and v_latest_body = v_body then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
  end if;

  -- 公開ステータス決定（承認制 or NGワードで保留）
  v_status := case when r.comment_mode = 'approval' then 'pending' else 'approved' end;
  v_hold := null;
  if public.comment_ng_hit(v_body) or public.comment_ng_hit(v_name) then
    v_status := 'pending';
    v_hold := 'ng_word';
  end if;

  insert into public.comments (
    node_id, root_id, parent_id, owner_id, author_name, body,
    is_owner, status, hold_reason, ip_hash, edit_token_hash, owner_read
  ) values (
    p_node_id, p_root_id, null, r.user_id, v_name, v_body,
    false, v_status, v_hold, v_ip, md5(p_edit_token), false
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status);
end $$;

-- 投稿者本人による修正（編集トークン照合）
create or replace function public.edit_comment(
  p_comment_id uuid, p_edit_token text, p_body text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.comments;
  r public.nodes;
  v_body text;
  v_status text;
  v_hold text;
begin
  select * into c from public.comments where id = p_comment_id;
  if c.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if c.is_owner then
    return jsonb_build_object('ok', false, 'error', 'not_yours');
  end if;
  if c.edit_token_hash is null or c.edit_token_hash <> md5(coalesce(p_edit_token, '')) then
    return jsonb_build_object('ok', false, 'error', 'bad_token');
  end if;

  v_body := trim(coalesce(p_body, ''));
  if v_body = '' then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;
  if char_length(v_body) > 4000 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;
  if public.comment_url_count(v_body) > 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many_urls');
  end if;

  -- 公開ステータスは投稿時と同じ規則で決め直す
  -- （承認制ページでは、承認済みでも修正したら承認待ちに戻す＝すり替え防止。
  --   即時公開ページで保留だったものも、直せば公開に戻る）
  select * into r from public.nodes where id = c.root_id;
  v_status := case when coalesce(r.comment_mode, 'off') = 'approval' then 'pending' else 'approved' end;
  v_hold := null;
  if public.comment_ng_hit(v_body) then
    v_status := 'pending';
    v_hold := 'ng_word';
  end if;

  update public.comments
  set body = v_body, edited_at = now(), status = v_status, hold_reason = v_hold, owner_read = false
  where id = p_comment_id;

  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- ── 5. 持ち主側RPC（auth.uid() で本人確認） ───────────────────────

-- ノード単位のコメント全件（保留含む。保留が先）
create or replace function public.get_owner_comments(p_node_id uuid)
returns table (
  id uuid, parent_id uuid, author_name text, body text,
  is_owner boolean, status text, hold_reason text,
  created_at timestamptz, edited_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.nodes where id = p_node_id and user_id = auth.uid()
  ) then
    return;
  end if;
  return query
    select c.id, c.parent_id, c.author_name, c.body, c.is_owner, c.status,
           c.hold_reason, c.created_at, c.edited_at
    from public.comments c
    where c.node_id = p_node_id
    order by (c.status = 'pending') desc, c.created_at asc;
end $$;

-- バッジ件数（未読 or 承認待ち、持ち主の返信は除く）をノード／カテゴリ単位で
create or replace function public.get_comment_badges()
returns table (category_id uuid, node_id uuid, cnt int)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return;
  end if;
  return query
    select n.category_id, c.node_id, count(*)::int
    from public.comments c
    join public.nodes n on n.id = c.node_id
    where c.owner_id = auth.uid()
      and c.is_owner = false
      and (c.owner_read = false or c.status = 'pending')
    group by n.category_id, c.node_id;
end $$;

-- 承認／削除
create or replace function public.moderate_comment(p_comment_id uuid, p_action text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.comments;
begin
  select * into c from public.comments where id = p_comment_id;
  if c.id is null or auth.uid() is null or c.owner_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if p_action = 'approve' then
    update public.comments
    set status = 'approved', hold_reason = null, owner_read = true
    where id = p_comment_id;
  elsif p_action = 'delete' then
    delete from public.comments where id = p_comment_id;
  else
    return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- 持ち主の返信（親はそのノードのトップレベルコメントだけ）
create or replace function public.owner_reply(
  p_node_id uuid, p_parent_id uuid, p_body text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n public.nodes;
  parent public.comments;
  cur uuid;
  guard int := 0;
  root public.nodes;
  v_body text;
  v_id uuid;
begin
  select * into n from public.nodes where id = p_node_id and user_id = auth.uid();
  if n.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into parent from public.comments where id = p_parent_id;
  if parent.id is null or parent.node_id <> p_node_id or parent.parent_id is not null then
    return jsonb_build_object('ok', false, 'error', 'bad_parent');
  end if;

  -- ルート（公開中ノード）は親コメントの root_id から引く
  select * into root from public.nodes where id = parent.root_id;

  v_body := trim(coalesce(p_body, ''));
  if v_body = '' then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;
  if char_length(v_body) > 4000 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;

  insert into public.comments (
    node_id, root_id, parent_id, owner_id, author_name, body,
    is_owner, status, hold_reason, ip_hash, edit_token_hash, owner_read
  ) values (
    p_node_id, parent.root_id, p_parent_id, auth.uid(),
    coalesce(nullif(trim(coalesce(root.admin_name, '')), ''), '管理人'),
    v_body, true, 'approved', null, null, null, true
  ) returning id into v_id;

  -- 返信したら元のコメントは確認済み扱い
  update public.comments set owner_read = true where id = p_parent_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- 持ち主が自分の返信を直す
create or replace function public.owner_update_comment(p_comment_id uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.comments;
  v_body text;
begin
  select * into c from public.comments where id = p_comment_id;
  if c.id is null or auth.uid() is null or c.owner_id <> auth.uid() or c.is_owner = false then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_body := trim(coalesce(p_body, ''));
  if v_body = '' then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;
  if char_length(v_body) > 4000 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;
  update public.comments set body = v_body, edited_at = now() where id = p_comment_id;
  return jsonb_build_object('ok', true);
end $$;

-- ノードのコメントを既読にする（承認待ちはバッジに残り続ける）
create or replace function public.mark_comments_read(p_node_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.nodes where id = p_node_id and user_id = auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  update public.comments
  set owner_read = true
  where node_id = p_node_id and is_owner = false;
  return jsonb_build_object('ok', true);
end $$;

-- ── 6. 実行権限 ───────────────────────────────────────────────────
grant execute on function public.get_public_comment_info(uuid)                 to anon, authenticated;
grant execute on function public.get_public_comments(uuid, uuid, uuid[])       to anon, authenticated;
grant execute on function public.post_comment(uuid, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.edit_comment(uuid, text, text)                to anon, authenticated;
grant execute on function public.get_owner_comments(uuid)                      to authenticated;
grant execute on function public.get_comment_badges()                          to authenticated;
grant execute on function public.moderate_comment(uuid, text)                  to authenticated;
grant execute on function public.owner_reply(uuid, uuid, text)                 to authenticated;
grant execute on function public.owner_update_comment(uuid, text)              to authenticated;
grant execute on function public.mark_comments_read(uuid)                      to authenticated;

-- ヘルパーはRPC内部からだけ使うので直接の実行権限は剥がしておく
revoke execute on function public.comment_check_root(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.comment_ip_hash()              from public, anon, authenticated;
revoke execute on function public.comment_url_count(text)        from public, anon, authenticated;
revoke execute on function public.comment_ng_hit(text)           from public, anon, authenticated;
