-- Additional non-inventory packing items for events.
alter table public.event_pickup_items
  add column if not exists item_stage text not null default 'pickup';
alter table public.event_pickup_items drop constraint if exists event_pickup_items_item_stage_check;
alter table public.event_pickup_items
  add constraint event_pickup_items_item_stage_check check (item_stage in ('pack','pickup'));

create or replace function public.admin_replace_event_pickup_items(p_event_id uuid, p_items jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare ev public.events%rowtype; x jsonb; v_stage text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required'; end if;
 select * into ev from public.events where id=p_event_id for update;
 if not found then raise exception 'Event not found'; end if;
 if ev.status not in ('draft','confirmed','ready_to_pack','packing') then raise exception 'Packing and pickup items cannot be changed after the event is ready'; end if;
 if ev.locked then raise exception 'Unlock Event before changing packing or pickup items'; end if;
 delete from public.event_pickup_items where event_id=p_event_id;
 for x in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
  if nullif(trim(x->>'item_name'),'') is not null then
   v_stage:=case when x->>'item_stage'='pack' then 'pack' else 'pickup' end;
   insert into public.event_pickup_items(event_id,item_name,quantity_text,location_id,location_text,note,item_stage)
   values(p_event_id,trim(x->>'item_name'),nullif(trim(x->>'quantity_text'),''),nullif(x->>'location_id','')::uuid,nullif(trim(x->>'location_text'),''),nullif(trim(x->>'note'),''),v_stage);
  end if;
 end loop;
end $function$;

create or replace function public.set_event_pack_item_packed(p_item_id uuid, p_packed boolean default true)
returns public.event_pickup_items language plpgsql security definer set search_path to 'public'
as $function$
declare item public.event_pickup_items%rowtype; ev public.events%rowtype;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required'; end if;
 select * into item from public.event_pickup_items where id=p_item_id and item_stage='pack' for update;
 if not found then raise exception 'Packing item not found'; end if;
 select * into ev from public.events where id=item.event_id;
 if ev.status not in ('confirmed','ready_to_pack','packing') then raise exception 'This packing list cannot be changed now'; end if;
 update public.event_pickup_items
 set grabbed=p_packed,grabbed_by=case when p_packed then auth.uid() else null end,
     grabbed_at=case when p_packed then now() else null end,updated_at=now()
 where id=p_item_id returning * into item;
 return item;
end $function$;

create or replace function public.admin_mark_event_ready(p_event_id uuid)
returns public.events language plpgsql security definer set search_path to 'public'
as $function$
declare ev public.events%rowtype; r record; v_available integer;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required'; end if;
 select * into ev from public.events where id=p_event_id for update;
 if not found then raise exception 'Event not found'; end if;
 if ev.status not in ('confirmed','ready_to_pack','packing','packed') then raise exception 'This event cannot be marked ready from its current status'; end if;
 if ev.status='packed' then return ev; end if;
 if exists(select 1 from public.event_items where event_id=p_event_id and not grab_at_pickup and not packed) then
  raise exception 'Finish packing the regular items before marking this event ready';
 end if;
 if exists(select 1 from public.event_pickup_items where event_id=p_event_id and item_stage='pack' and not grabbed) then
  raise exception 'Finish packing the additional items before marking this event ready';
 end if;
 for r in
  select ei.product_id,p.name,sum(greatest(ei.qty_packed,ei.qty_needed))::integer as qty_needed
  from public.event_items ei join public.products p on p.id=ei.product_id
  where ei.event_id=p_event_id group by ei.product_id,p.name order by ei.product_id
 loop
  perform 1 from public.stock where product_id=r.product_id for update;
  select available_qty into v_available from public.inventory_available where product_id=r.product_id;
  if coalesce(v_available,0)<r.qty_needed then
   raise exception 'Only % available for %. This event needs %.',coalesce(v_available,0),r.name,r.qty_needed;
  end if;
 end loop;
 update public.events set status='packed',locked=true,updated_by=auth.uid(),updated_at=now()
 where id=p_event_id returning * into ev;
 insert into public.audit_log(actor_id,entity_type,entity_id,action,change_summary)
 values(auth.uid(),'event',p_event_id,'ready_for_pickup',
  jsonb_build_object('grab_at_pickup_count',(select count(*) from public.event_items where event_id=p_event_id and grab_at_pickup),
  'additional_pack_count',(select count(*) from public.event_pickup_items where event_id=p_event_id and item_stage='pack'),'inventory_reserved',true));
 return ev;
end $function$;

revoke all on function public.set_event_pack_item_packed(uuid,boolean) from public, anon;
grant execute on function public.set_event_pack_item_packed(uuid,boolean) to authenticated;
revoke all on function public.admin_replace_event_pickup_items(uuid,jsonb) from public, anon;
grant execute on function public.admin_replace_event_pickup_items(uuid,jsonb) to authenticated;
revoke all on function public.admin_mark_event_ready(uuid) from public, anon;
grant execute on function public.admin_mark_event_ready(uuid) to authenticated;
