-- Reserve event inventory only once the event is Ready for Pickup.
-- Confirmed and packing events remain visible as planned demand but do not reduce available stock.

create or replace view public.product_commitments
with (security_invoker=true) as
select p.id as product_id,
       coalesce(ev.reserved_qty,0) + coalesce(gc.outstanding_qty,0) as committed_qty
from public.products p
left join (
  select ei.product_id,
         sum(greatest(ei.qty_packed,ei.qty_needed))::integer as reserved_qty
  from public.event_items ei
  join public.events e on e.id=ei.event_id
  where e.status in ('packed','checked_out','shipped','pending_count')
  group by ei.product_id
) ev on ev.product_id=p.id
left join (
  select gci.product_id,
         sum(gci.qty_out-gci.qty_returned_verified)::integer as outstanding_qty
  from public.general_checkout_items gci
  join public.general_checkouts gc on gc.id=gci.checkout_id
  where gc.status in ('out','pending_count')
  group by gci.product_id
) gc on gc.product_id=p.id;

create or replace view public.inventory_stock_available
with (security_invoker=true) as
with located_gc as (
  select gci.stock_id,
         sum(gci.qty_out-coalesce(gci.qty_returned_verified,0))::integer as qty
  from public.general_checkout_items gci
  join public.general_checkouts gc on gc.id=gci.checkout_id
  where gci.stock_id is not null and gc.status in ('out','pending_count')
  group by gci.stock_id
), event_reserved as (
  select ei.product_id,
         sum(greatest(ei.qty_packed,ei.qty_needed))::integer as qty
  from public.event_items ei
  join public.events e on e.id=ei.event_id
  where e.status in ('packed','checked_out','shipped','pending_count')
  group by ei.product_id
), legacy_gc as (
  select gci.product_id,
         sum(gci.qty_out-coalesce(gci.qty_returned_verified,0))::integer as qty
  from public.general_checkout_items gci
  join public.general_checkouts gc on gc.id=gci.checkout_id
  where gci.stock_id is null and gc.status in ('out','pending_count')
  group by gci.product_id
), base as (
  select s.id as stock_id,s.product_id,s.location_id,s.on_hand,
         greatest(s.on_hand-coalesce(lg.qty,0),0) as capacity,
         coalesce(er.qty,0)+coalesce(legacy.qty,0) as unlocated_reserved
  from public.stock s
  left join located_gc lg on lg.stock_id=s.id
  left join event_reserved er on er.product_id=s.product_id
  left join legacy_gc legacy on legacy.product_id=s.product_id
), ranked as (
  select b.*,
         coalesce(sum(b.capacity) over(partition by b.product_id order by b.stock_id rows between unbounded preceding and 1 preceding),0)::integer as prior_capacity
  from base b
)
select stock_id,product_id,location_id,on_hand,
       greatest(capacity-greatest(least(capacity,unlocated_reserved-prior_capacity),0),0) as available_qty
from ranked;

create or replace function public.admin_mark_event_ready(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ev public.events%rowtype;
  r record;
  v_available integer;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into ev from public.events where id=p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if ev.status not in ('confirmed','ready_to_pack','packing','packed') then raise exception 'This event cannot be marked ready from its current status'; end if;
  if ev.status='packed' then return ev; end if;
  if exists(select 1 from public.event_items where event_id=p_event_id and not grab_at_pickup and not packed) then
    raise exception 'Finish packing the regular items before marking this event ready';
  end if;

  for r in
    select ei.product_id,p.name,sum(greatest(ei.qty_packed,ei.qty_needed))::integer as qty_needed
    from public.event_items ei
    join public.products p on p.id=ei.product_id
    where ei.event_id=p_event_id
    group by ei.product_id,p.name
    order by ei.product_id
  loop
    perform 1 from public.stock where product_id=r.product_id for update;
    select available_qty into v_available from public.inventory_available where product_id=r.product_id;
    if coalesce(v_available,0) < r.qty_needed then
      raise exception 'Only % available for %. This event needs %.',coalesce(v_available,0),r.name,r.qty_needed;
    end if;
  end loop;

  update public.events
     set status='packed',locked=true,updated_by=auth.uid(),updated_at=now()
   where id=p_event_id
   returning * into ev;

  insert into public.audit_log(actor_id,entity_type,entity_id,action,change_summary)
  values(auth.uid(),'event',p_event_id,'ready_for_pickup',
         jsonb_build_object(
           'grab_at_pickup_count',(select count(*) from public.event_items where event_id=p_event_id and grab_at_pickup),
           'inventory_reserved',true
         ));
  return ev;
end;
$function$;

revoke execute on function public.admin_mark_event_ready(uuid) from public, anon;
grant execute on function public.admin_mark_event_ready(uuid) to authenticated;
