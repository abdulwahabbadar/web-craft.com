-- Supabase > SQL Editor mein ye poora paste karke Run karein (sirf ek dafa)

create table profiles(
  id uuid primary key references auth.users on delete cascade,
  email text, shop_name text, customer_count int default 0,
  plan text, plan_expires_at timestamptz, is_admin boolean default false,
  created_at timestamptz default now());
create table khata_data(
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null, version bigint not null default 1, updated_at timestamptz default now());
create table shares(
  token text primary key, owner uuid not null references auth.users on delete cascade,
  data jsonb not null, updated_at timestamptz default now());

alter table profiles enable row level security;
alter table khata_data enable row level security;
alter table shares enable row level security;   -- shares par koi policy nahi: sirf functions se access

create function is_admin() returns boolean language sql security definer stable set search_path=public as
$$ select coalesce((select is_admin from profiles where id=auth.uid()),false) $$;

-- user sirf apni row dekh sakta hai; likhne ki koi policy nahi (plan khud nahi badal sakta)
create policy "own profile" on profiles for select using (id=auth.uid() or is_admin());
create policy "own data" on khata_data for select using (user_id=auth.uid());

create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as
$$ begin insert into profiles(id,email) values(new.id,new.email); return new; end $$;
create trigger on_signup after insert on auth.users for each row execute function handle_new_user();

-- data save (conflict check + 50 customer limit server par)
create function push_data(p_data jsonb, p_base bigint, p_shop text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare cur khata_data%rowtype; n int; prev int; active boolean; v bigint;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  select * into cur from khata_data where user_id=auth.uid() for update;
  if found and cur.version<>p_base then
    return jsonb_build_object('ok',false,'version',cur.version,'data',cur.data);
  end if;
  n := coalesce(jsonb_array_length(p_data->'customers'),0);
  select coalesce(plan_expires_at>now(),false), coalesce(customer_count,0) into active, prev from profiles where id=auth.uid();
  if n>greatest(50,prev) and not active then raise exception 'free limit: 50 customers'; end if;
  insert into khata_data(user_id,data,version) values(auth.uid(),p_data,1)
    on conflict(user_id) do update set data=excluded.data, version=khata_data.version+1, updated_at=now()
    returning version into v;
  update profiles set shop_name=p_shop, customer_count=n where id=auth.uid();
  return jsonb_build_object('ok',true,'version',v);
end $$;

-- customer share snapshots
create function sync_shares(p_items jsonb) returns void language sql security definer set search_path=public as $$
  insert into shares(token,owner,data)
  select x->>'token', auth.uid(), x-'token' from jsonb_array_elements(p_items) x where length(x->>'token')>=32
  on conflict(token) do update set data=excluded.data, updated_at=now() where shares.owner=auth.uid();
$$;
create function get_shared(p_token text) returns jsonb language sql security definer stable set search_path=public as $$
  select data||jsonb_build_object('updated',(extract(epoch from updated_at)*1000)::bigint) from shares where token=p_token
$$;
grant execute on function get_shared(text) to anon, authenticated;

-- admin: plan lagana / extend / band karna
create function admin_set_plan(p_uid uuid, p_plan text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_admin() then raise exception 'not admin'; end if;
  if p_plan='none' then update profiles set plan=null, plan_expires_at=null where id=p_uid;
  else update profiles set plan=p_plan,
    plan_expires_at=greatest(now(),coalesce(plan_expires_at,now())) + (case p_plan when 'yearly' then interval '365 days' else interval '30 days' end)
    where id=p_uid; end if;
end $$;

-- Apne account se signup karne ke BAAD ye chalayein (apni email likhein):
-- update profiles set is_admin=true where email='YOUR-EMAIL@gmail.com';
