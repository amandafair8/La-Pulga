create table if not exists public.packing_templates(id uuid primary key default gen_random_uuid(),name text not null,template_type text not null check(template_type in ('kit','batch')),notes text,active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.packing_template_items(id uuid primary key default gen_random_uuid(),template_id uuid not null references public.packing_templates(id) on delete cascade,product_id uuid not null references public.products(id),quantity integer not null check(quantity>0),unique(template_id,product_id));
create table if not exists public.event_batches(id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id) on delete cascade,template_id uuid references public.packing_templates(id) on delete set null,name text not null,instructions text,created_at timestamptz not null default now());
alter table public.packing_templates enable row level security;
alter table public.packing_template_items enable row level security;
alter table public.event_batches enable row level security;
create policy packing_templates_read on public.packing_templates for select to authenticated using(public.is_active_employee());
create policy packing_templates_admin on public.packing_templates for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy packing_template_items_read on public.packing_template_items for select to authenticated using(public.is_active_employee());
create policy packing_template_items_admin on public.packing_template_items for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy event_batches_read on public.event_batches for select to authenticated using(public.is_active_employee());
create policy event_batches_admin on public.event_batches for all to authenticated using(public.is_admin()) with check(public.is_admin());

create or replace function public.admin_save_packing_template(p_id uuid,p_name text,p_type text,p_notes text,p_items jsonb default '[]'::jsonb) returns uuid language plpgsql security definer set search_path='public' as $$
declare v_id uuid;x jsonb;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required';end if;
 if nullif(trim(p_name),'') is null then raise exception 'Name is required';end if;
 if p_type not in('kit','batch') then raise exception 'Invalid template type';end if;
 if p_id is null then insert into public.packing_templates(name,template_type,notes) values(trim(p_name),p_type,nullif(trim(p_notes),'')) returning id into v_id;
 else update public.packing_templates set name=trim(p_name),template_type=p_type,notes=nullif(trim(p_notes),''),updated_at=now() where id=p_id returning id into v_id;if v_id is null then raise exception 'Template not found';end if;end if;
 delete from public.packing_template_items where template_id=v_id;
 if p_type='kit' then for x in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
  if nullif(x->>'product_id','') is not null and coalesce((x->>'quantity')::integer,0)>0 then insert into public.packing_template_items(template_id,product_id,quantity) values(v_id,(x->>'product_id')::uuid,(x->>'quantity')::integer) on conflict(template_id,product_id) do update set quantity=excluded.quantity;end if;
 end loop;end if;return v_id;
end $$;
create or replace function public.admin_delete_packing_template(p_id uuid) returns void language plpgsql security definer set search_path='public' as $$begin if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required';end if;delete from public.packing_templates where id=p_id;end $$;
create or replace function public.admin_replace_event_batches(p_event_id uuid,p_batches jsonb) returns void language plpgsql security definer set search_path='public' as $$
declare ev public.events%rowtype;x jsonb;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required';end if;
 select * into ev from public.events where id=p_event_id for update;if not found then raise exception 'Event not found';end if;
 if ev.status not in('draft','confirmed','ready_to_pack','packing') or ev.locked then raise exception 'Unlock this event before changing batches';end if;
 delete from public.event_batches where event_id=p_event_id;
 for x in select value from jsonb_array_elements(coalesce(p_batches,'[]'::jsonb)) loop if nullif(trim(x->>'name'),'') is not null then insert into public.event_batches(event_id,template_id,name,instructions) values(p_event_id,nullif(x->>'template_id','')::uuid,trim(x->>'name'),nullif(trim(x->>'instructions'),''));end if;end loop;
end $$;
create or replace function public.admin_move_event_item_to_pickup(p_event_item_id uuid) returns public.event_items language plpgsql security definer set search_path='public' as $$
declare item public.event_items%rowtype;ev public.events%rowtype;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required';end if;
 select * into item from public.event_items where id=p_event_item_id for update;if not found then raise exception 'Packing item not found';end if;
 select * into ev from public.events where id=item.event_id;
 if ev.status not in('confirmed','ready_to_pack','packing') then raise exception 'This item cannot be moved now';end if;
 if item.packed then raise exception 'Packed items cannot be moved to pickup';end if;
 update public.event_items set grab_at_pickup=true,grabbed=false,updated_at=now() where id=p_event_item_id returning * into item;return item;
end $$;
revoke all on function public.admin_save_packing_template(uuid,text,text,text,jsonb) from public,anon;
revoke all on function public.admin_delete_packing_template(uuid) from public,anon;
revoke all on function public.admin_replace_event_batches(uuid,jsonb) from public,anon;
revoke all on function public.admin_move_event_item_to_pickup(uuid) from public,anon;
grant execute on function public.admin_save_packing_template(uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.admin_delete_packing_template(uuid) to authenticated;
grant execute on function public.admin_replace_event_batches(uuid,jsonb) to authenticated;
grant execute on function public.admin_move_event_item_to_pickup(uuid) to authenticated;