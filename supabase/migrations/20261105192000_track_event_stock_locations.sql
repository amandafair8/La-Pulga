-- Exact stock-location tracking for event packing, pickup, and verified returns.
create table if not exists public.event_item_stock_allocations (
  event_item_id uuid not null references public.event_items(id) on delete cascade,
  stock_id uuid not null references public.stock(id) on delete restrict,
  qty integer not null check (qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_item_id, stock_id)
);

alter table public.event_item_stock_allocations enable row level security;
drop policy if exists "Authenticated users can view event stock allocations" on public.event_item_stock_allocations;
create policy "Authenticated users can view event stock allocations"
on public.event_item_stock_allocations for select to authenticated using (true);
revoke all on public.event_item_stock_allocations from anon;
revoke insert, update, delete on public.event_item_stock_allocations from authenticated;
grant select on public.event_item_stock_allocations to authenticated;

alter table public.return_items
  add column if not exists return_stock_id uuid references public.stock(id) on delete restrict;

create or replace view public.inventory_stock_available
with (security_invoker=true) as
with located_gc as (
  select gci.stock_id, sum(gci.qty_out-coalesce(gci.qty_returned_verified,0))::integer qty
  from public.general_checkout_items gci
  join public.general_checkouts gc on gc.id=gci.checkout_id
  where gci.stock_id is not null and gc.status in ('out','pending_count')
  group by gci.stock_id
), located_event as (
  select a.stock_id,sum(a.qty)::integer qty
  from public.event_item_stock_allocations a
  join public.event_items ei on ei.id=a.event_item_id
  join public.events e on e.id=ei.event_id
  where e.status in ('packed','checked_out','shipped','pending_count')
  group by a.stock_id
), event_totals as (
  select ei.product_id,sum(greatest(ei.qty_packed,ei.qty_needed))::integer qty
  from public.event_items ei join public.events e on e.id=ei.event_id
  where e.status in ('packed','checked_out','shipped','pending_count')
  group by ei.product_id
), event_allocated as (
  select ei.product_id,sum(a.qty)::integer qty
  from public.event_item_stock_allocations a
  join public.event_items ei on ei.id=a.event_item_id
  join public.events e on e.id=ei.event_id
  where e.status in ('packed','checked_out','shipped','pending_count')
  group by ei.product_id
), unlocated_event as (
  select et.product_id,greatest(et.qty-coalesce(ea.qty,0),0)::integer qty
  from event_totals et left join event_allocated ea on ea.product_id=et.product_id
), legacy_gc as (
  select gci.product_id,sum(gci.qty_out-coalesce(gci.qty_returned_verified,0))::integer qty
  from public.general_checkout_items gci
  join public.general_checkouts gc on gc.id=gci.checkout_id
  where gci.stock_id is null and gc.status in ('out','pending_count')
  group by gci.product_id
), base as (
  select s.id stock_id,s.product_id,s.location_id,s.on_hand,
    greatest(s.on_hand-coalesce(lg.qty,0)-coalesce(le.qty,0),0) capacity,
    coalesce(ue.qty,0)+coalesce(legacy.qty,0) unlocated_reserved
  from public.stock s
  left join located_gc lg on lg.stock_id=s.id
  left join located_event le on le.stock_id=s.id
  left join unlocated_event ue on ue.product_id=s.product_id
  left join legacy_gc legacy on legacy.product_id=s.product_id
), ranked as (
  select b.*,coalesce(sum(b.capacity) over(partition by b.product_id order by b.stock_id rows between unbounded preceding and 1 preceding),0)::integer prior_capacity
  from base b
)
select stock_id,product_id,location_id,on_hand,
  greatest(capacity-greatest(least(capacity,unlocated_reserved-prior_capacity),0),0) available_qty
from ranked;

create or replace function public.pack_event_item_at_location(
  p_event_item_id uuid,
  p_qty_packed integer default null,
  p_stock_id uuid default null
) returns public.event_items
language plpgsql security definer set search_path='public' as $$
declare
  item public.event_items%rowtype;
  ev public.events%rowtype;
  new_qty integer;
  stock_count integer;
  chosen_stock uuid;
  available integer;
  existing_qty integer;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into item from public.event_items where id=p_event_item_id for update;
  if not found then raise exception 'Packing item not found'; end if;
  if item.grab_at_pickup then raise exception 'This item is collected at pickup'; end if;
  select * into ev from public.events where id=item.event_id for update;
  if ev.status not in ('confirmed','ready_to_pack','packing','packed') then raise exception 'Packing is not allowed for event status %',ev.status; end if;
  new_qty:=coalesce(p_qty_packed,item.qty_needed);
  if new_qty<0 then raise exception 'Packed quantity cannot be negative'; end if;

  select count(*) into stock_count from public.stock where product_id=item.product_id and on_hand>0;
  chosen_stock:=p_stock_id;
  if new_qty>0 and stock_count=1 and chosen_stock is null then
    select id into chosen_stock from public.stock where product_id=item.product_id and on_hand>0 limit 1;
  end if;
  if new_qty>0 and stock_count>1 and chosen_stock is null then raise exception 'Choose the location this item was packed from'; end if;
  if new_qty>0 and chosen_stock is null then raise exception 'No stocked location is available for this product'; end if;
  if chosen_stock is not null and not exists(select 1 from public.stock where id=chosen_stock and product_id=item.product_id) then raise exception 'The selected location does not stock this product'; end if;

  select coalesce(sum(qty),0) into existing_qty from public.event_item_stock_allocations where event_item_id=item.id and stock_id=chosen_stock;
  select available_qty into available from public.inventory_stock_available where stock_id=chosen_stock;
  if ev.status in ('packed','checked_out','shipped','pending_count') then available:=coalesce(available,0)+existing_qty; end if;
  if new_qty>coalesce(available,0) then raise exception 'Only % available at the selected location. This item needs %.',coalesce(available,0),new_qty; end if;

  delete from public.event_item_stock_allocations where event_item_id=item.id;
  if new_qty>0 then insert into public.event_item_stock_allocations(event_item_id,stock_id,qty) values(item.id,chosen_stock,new_qty); end if;
  if ev.status in ('confirmed','ready_to_pack') then
    update public.events set status='packing',locked=true,updated_by=auth.uid(),updated_at=now() where id=ev.id;
  elsif not ev.locked then
    update public.events set locked=true,updated_by=auth.uid(),updated_at=now() where id=ev.id;
  end if;
  update public.event_items set qty_packed=new_qty,packed=true,updated_at=now() where id=item.id returning * into item;
  insert into public.audit_log(actor_id,entity_type,entity_id,action,change_summary)
  values(auth.uid(),'event_item',item.id,'packed',jsonb_build_object('event_id',item.event_id,'qty_packed',new_qty,'stock_id',chosen_stock));
  return item;
end $$;

create or replace function public.set_event_item_grabbed_at_location(
  p_event_item_id uuid,
  p_grabbed boolean default true,
  p_stock_id uuid default null
) returns public.event_items
language plpgsql security definer set search_path='public' as $$
declare
  item public.event_items%rowtype;
  ev public.events%rowtype;
  stock_count integer;
  chosen_stock uuid;
  available integer;
  existing_qty integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into item from public.event_items where id=p_event_item_id for update;
  if not found then raise exception 'Event item not found'; end if;
  if not item.grab_at_pickup then raise exception 'This item is part of the regular packing list'; end if;
  select * into ev from public.events where id=item.event_id;
  if ev.status<>'packed' then raise exception 'The event must be ready for pickup first'; end if;
  if not public.is_admin() and not exists(select 1 from public.event_staff where event_id=item.event_id and employee_id=auth.uid()) then raise exception 'You are not assigned to this event'; end if;

  if p_grabbed then
    select count(*) into stock_count from public.stock where product_id=item.product_id and on_hand>0;
    chosen_stock:=p_stock_id;
    if stock_count=1 and chosen_stock is null then select id into chosen_stock from public.stock where product_id=item.product_id and on_hand>0 limit 1; end if;
    if stock_count>1 and chosen_stock is null then raise exception 'Choose the location this item was taken from'; end if;
    if chosen_stock is null then raise exception 'No stocked location is available for this product'; end if;
    if not exists(select 1 from public.stock where id=chosen_stock and product_id=item.product_id) then raise exception 'The selected location does not stock this product'; end if;
    select coalesce(sum(qty),0) into existing_qty from public.event_item_stock_allocations where event_item_id=item.id and stock_id=chosen_stock;
    select available_qty into available from public.inventory_stock_available where stock_id=chosen_stock;
    available:=coalesce(available,0)+existing_qty;
    if item.qty_needed>available then raise exception 'Only % available at the selected location. This item needs %.',available,item.qty_needed; end if;
    delete from public.event_item_stock_allocations where event_item_id=item.id;
    insert into public.event_item_stock_allocations(event_item_id,stock_id,qty) values(item.id,chosen_stock,item.qty_needed);
  else
    delete from public.event_item_stock_allocations where event_item_id=item.id;
  end if;

  update public.event_items set grabbed=p_grabbed,
    grabbed_by=case when p_grabbed then auth.uid() else null end,
    grabbed_at=case when p_grabbed then now() else null end,
    updated_at=now()
  where id=p_event_item_id returning * into item;
  insert into public.audit_log(actor_id,entity_type,entity_id,action,change_summary)
  values(auth.uid(),'event_item',p_event_item_id,case when p_grabbed then 'grabbed_at_pickup' else 'pickup_item_unchecked' end,
    jsonb_build_object('event_id',item.event_id,'stock_id',chosen_stock));
  return item;
end $$;

create or replace function public.verify_return(p_return_id uuid,p_items jsonb)
returns public.returns
language plpgsql security definer set search_path='public' as $$
declare
  ret public.returns%rowtype;
  elem jsonb;
  pid uuid;
  returned_qty integer;
  out_qty integer;
  reusable_flag boolean;
  discrepancy text;
  destination_stock uuid;
  stock_count integer;
  source_total integer;
  src record;
  tx_type public.inventory_tx_type;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into ret from public.returns where id=p_return_id for update;
  if not found then raise exception 'Return not found'; end if;
  if ret.status='verified' then raise exception 'Return is already verified'; end if;
  if ret.physically_returned_by<>auth.uid() and not public.is_admin() then raise exception 'Only the returner or an administrator can verify this return'; end if;
  if jsonb_typeof(p_items)<>'array' then raise exception 'Return items must be an array'; end if;

  for elem in select * from jsonb_array_elements(p_items) loop
    pid:=(elem->>'product_id')::uuid;
    returned_qty:=(elem->>'qty_returned')::integer;
    discrepancy:=nullif(elem->>'discrepancy_note','');
    destination_stock:=nullif(elem->>'return_stock_id','')::uuid;
    select ri.qty_out,p.reusable into out_qty,reusable_flag
      from public.return_items ri join public.products p on p.id=ri.product_id
      where ri.return_id=p_return_id and ri.product_id=pid for update;
    if out_qty is null then raise exception 'Product % is not part of this return',pid; end if;
    if returned_qty<0 or returned_qty>out_qty then raise exception 'Returned quantity must be between 0 and %',out_qty; end if;

    select count(*) into stock_count from public.stock where product_id=pid;
    if returned_qty>0 and stock_count=1 and destination_stock is null then select id into destination_stock from public.stock where product_id=pid limit 1; end if;
    if returned_qty>0 and stock_count>1 and destination_stock is null then raise exception 'Choose where the returned % was placed', (select name from public.products where id=pid); end if;
    if destination_stock is not null and not exists(select 1 from public.stock where id=destination_stock and product_id=pid) then raise exception 'The selected return location does not stock this product'; end if;
    update public.return_items set qty_returned=returned_qty,discrepancy_note=discrepancy,return_stock_id=destination_stock where return_id=p_return_id and product_id=pid;

    if ret.event_id is not null then
      select coalesce(sum(a.qty),0) into source_total
      from public.event_item_stock_allocations a join public.event_items ei on ei.id=a.event_item_id
      where ei.event_id=ret.event_id and ei.product_id=pid;
    else
      select coalesce(sum(gci.qty_out),0) into source_total
      from public.general_checkout_items gci where gci.checkout_id=ret.checkout_id and gci.product_id=pid and gci.stock_id is not null;
    end if;

    if source_total=out_qty and source_total>0 then
      if ret.event_id is not null then
        for src in select a.stock_id,sum(a.qty)::integer qty from public.event_item_stock_allocations a join public.event_items ei on ei.id=a.event_item_id where ei.event_id=ret.event_id and ei.product_id=pid group by a.stock_id loop
          update public.stock set on_hand=on_hand-src.qty,updated_at=now() where id=src.stock_id and on_hand>=src.qty;
          if not found then raise exception 'Source location inventory is lower than the quantity sent out'; end if;
          insert into public.inventory_transactions(product_id,location_id,transaction_type,quantity_delta,event_id,return_id,processed_by,note)
          select pid,s.location_id,'event_return',-src.qty,ret.event_id,p_return_id,auth.uid(),'Removed from original event location during return reconciliation' from public.stock s where s.id=src.stock_id;
        end loop;
      else
        for src in select gci.stock_id,sum(gci.qty_out)::integer qty from public.general_checkout_items gci where gci.checkout_id=ret.checkout_id and gci.product_id=pid and gci.stock_id is not null group by gci.stock_id loop
          update public.stock set on_hand=on_hand-src.qty,updated_at=now() where id=src.stock_id and on_hand>=src.qty;
          if not found then raise exception 'Source location inventory is lower than the quantity sent out'; end if;
          insert into public.inventory_transactions(product_id,location_id,transaction_type,quantity_delta,checkout_id,return_id,processed_by,note)
          select pid,s.location_id,'general_return',-src.qty,ret.checkout_id,p_return_id,auth.uid(),'Removed from original checkout location during return reconciliation' from public.stock s where s.id=src.stock_id;
        end loop;
      end if;
      if returned_qty>0 then
        update public.stock set on_hand=on_hand+returned_qty,updated_at=now() where id=destination_stock;
        insert into public.inventory_transactions(product_id,location_id,transaction_type,quantity_delta,event_id,checkout_id,return_id,processed_by,note)
        select pid,s.location_id,case when ret.event_id is not null then 'event_return'::public.inventory_tx_type else 'general_return'::public.inventory_tx_type end,
          returned_qty,ret.event_id,ret.checkout_id,p_return_id,auth.uid(),'Returned to selected inventory location' from public.stock s where s.id=destination_stock;
      end if;
    elsif out_qty-returned_qty>0 then
      tx_type:=case when reusable_flag then 'loss_damage'::public.inventory_tx_type else 'consumable_used'::public.inventory_tx_type end;
      perform public.decrement_product_on_hand(pid,out_qty-returned_qty,auth.uid(),tx_type,ret.event_id,ret.checkout_id,p_return_id,coalesce(discrepancy,'Not returned during verified return'));
    end if;

    if ret.checkout_id is not null then update public.general_checkout_items set qty_returned_verified=returned_qty where checkout_id=ret.checkout_id and product_id=pid; end if;
  end loop;

  update public.returns set status='verified',verified_by=auth.uid(),verified_at=now() where id=p_return_id returning * into ret;
  if ret.event_id is not null then
    update public.events set status='returned',locked=true,updated_by=auth.uid(),updated_at=now() where id=ret.event_id;
  else
    update public.general_checkouts set status='returned',returned_by=coalesce(returned_by,auth.uid()),returned_at=coalesce(returned_at,now()) where id=ret.checkout_id;
  end if;
  insert into public.audit_log(actor_id,entity_type,entity_id,action,change_summary)
  values(auth.uid(),'return',p_return_id,'verified',jsonb_build_object('event_id',ret.event_id,'checkout_id',ret.checkout_id));
  return ret;
end $$;

revoke all on function public.pack_event_item_at_location(uuid,integer,uuid) from public;
revoke all on function public.set_event_item_grabbed_at_location(uuid,boolean,uuid) from public;
revoke all on function public.verify_return(uuid,jsonb) from public;
grant execute on function public.pack_event_item_at_location(uuid,integer,uuid) to authenticated;
grant execute on function public.set_event_item_grabbed_at_location(uuid,boolean,uuid) to authenticated;
grant execute on function public.verify_return(uuid,jsonb) to authenticated;
