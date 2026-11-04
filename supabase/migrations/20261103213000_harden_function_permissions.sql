-- Harden callable database operations before wider employee rollout.
-- Anonymous users cannot execute privileged functions. Authenticated users retain
-- only the RPCs used by the app; trigger and stock-mutation helpers stay internal.

create or replace function public.pack_event_item(p_event_item_id uuid, p_qty_packed integer default null)
returns public.event_items
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  item public.event_items%rowtype;
  ev public.events%rowtype;
  new_qty integer;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into item from public.event_items where id=p_event_item_id for update;
  if not found then raise exception 'Packing item not found'; end if;
  select * into ev from public.events where id=item.event_id for update;
  if ev.status not in ('confirmed','ready_to_pack','packing','packed') then
    raise exception 'Packing is not allowed for event status %',ev.status;
  end if;
  new_qty:=coalesce(p_qty_packed,item.qty_needed);
  if new_qty<0 then raise exception 'Packed quantity cannot be negative'; end if;
  if ev.status in ('confirmed','ready_to_pack') then
    update public.events set status='packing',locked=true,updated_by=auth.uid(),updated_at=now() where id=ev.id;
  elsif not ev.locked then
    update public.events set locked=true,updated_by=auth.uid(),updated_at=now() where id=ev.id;
  end if;
  update public.event_items
     set qty_packed=new_qty,packed=true,updated_at=now()
   where id=item.id
   returning * into item;
  insert into public.audit_log(actor_id,entity_type,entity_id,action,change_summary)
  values(auth.uid(),'event_item',item.id,'packed',jsonb_build_object('event_id',item.event_id,'qty_packed',new_qty));
  return item;
end;
$function$;

create or replace function public.mark_event_shipped(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ev public.events%rowtype;
  r record;
  shipped_qty integer;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into ev from public.events where id=p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if ev.fulfillment<>'ship' then raise exception 'Only shipping events can be marked shipped'; end if;
  if ev.status not in ('packing','packed') then raise exception 'Event must be packing or packed before shipping'; end if;
  if ev.return_expected then
    update public.events set status='shipped',locked=true,updated_by=auth.uid(),updated_at=now()
    where id=p_event_id returning * into ev;
  else
    for r in select product_id,greatest(qty_packed,qty_needed) as qty_out
             from public.event_items where event_id=p_event_id
    loop
      shipped_qty:=r.qty_out;
      if shipped_qty>0 then
        perform public.decrement_product_on_hand(r.product_id,shipped_qty,auth.uid(),'permanent_outflow',p_event_id,null,null,'Shipped with no return expected');
      end if;
    end loop;
    update public.events set status='closed',locked=true,updated_by=auth.uid(),updated_at=now()
    where id=p_event_id returning * into ev;
  end if;
  insert into public.audit_log(actor_id,entity_type,entity_id,action,change_summary)
  values(auth.uid(),'event',p_event_id,'shipped',jsonb_build_object('return_expected',ev.return_expected));
  return ev;
end;
$function$;

alter function public.touch_updated_at() set search_path='public';

do $block$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon, authenticated',r.signature);
  end loop;
end
$block$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_employee() to authenticated;
grant execute on function public.admin_add_event_pickup_item(uuid,text,text,uuid,text,text) to authenticated;
grant execute on function public.admin_adjust_stock_on_hand(uuid,integer,text) to authenticated;
grant execute on function public.admin_delete_event_pickup_item(uuid) to authenticated;
grant execute on function public.admin_mark_event_ready(uuid) to authenticated;
grant execute on function public.admin_relock_event(uuid) to authenticated;
grant execute on function public.admin_replace_event_pickup_items(uuid,jsonb) to authenticated;
grant execute on function public.admin_save_event_edit(uuid,jsonb,uuid[],jsonb,jsonb) to authenticated;
grant execute on function public.admin_save_product_details(uuid,text,uuid,text,text,text,text,text,integer,boolean,boolean,text) to authenticated;
grant execute on function public.admin_unlock_event(uuid) to authenticated;
grant execute on function public.cancel_event(uuid) to authenticated;
grant execute on function public.create_general_checkout(text,jsonb) to authenticated;
grant execute on function public.delete_event(uuid) to authenticated;
grant execute on function public.finalize_draft_event(uuid) to authenticated;
grant execute on function public.mark_event_checked_out(uuid) to authenticated;
grant execute on function public.mark_event_shipped(uuid) to authenticated;
grant execute on function public.mark_event_version_viewed(uuid) to authenticated;
grant execute on function public.pack_event_item(uuid,integer) to authenticated;
grant execute on function public.record_pending_return(public.return_source_type,uuid) to authenticated;
grant execute on function public.save_draft_event_builder(uuid,jsonb,uuid[],jsonb,jsonb) to authenticated;
grant execute on function public.set_event_item_grabbed(uuid,boolean) to authenticated;
grant execute on function public.set_event_pickup_item_grabbed(uuid,boolean) to authenticated;
grant execute on function public.verify_return(uuid,jsonb) to authenticated;
