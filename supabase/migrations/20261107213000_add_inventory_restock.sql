-- Add inventory quantities atomically while preserving physical-count corrections.
create or replace function public.admin_add_stock(
  p_stock_id uuid,
  p_quantity integer,
  p_note text default null
) returns integer
language plpgsql
security definer
set search_path='public'
as $$
declare
  s public.stock%rowtype;
  new_total integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Amount being added must be greater than 0';
  end if;

  select * into s from public.stock where id=p_stock_id for update;
  if not found then raise exception 'Stock row not found'; end if;

  update public.stock
  set on_hand=on_hand+p_quantity,updated_at=now()
  where id=p_stock_id
  returning on_hand into new_total;

  insert into public.inventory_transactions(
    product_id,location_id,transaction_type,quantity_delta,processed_by,note
  ) values(
    s.product_id,s.location_id,'admin_adjustment',p_quantity,auth.uid(),
    coalesce(nullif(trim(p_note),''),'Inventory restock')
  );

  return new_total;
end $$;

revoke all on function public.admin_add_stock(uuid,integer,text) from public;
revoke all on function public.admin_add_stock(uuid,integer,text) from anon;
grant execute on function public.admin_add_stock(uuid,integer,text) to authenticated;
