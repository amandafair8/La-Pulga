create or replace function public.admin_move_custom_pack_item_to_pickup(p_item_id uuid)
returns public.event_pickup_items language plpgsql security definer set search_path='public' as $$
declare item public.event_pickup_items%rowtype;ev public.events%rowtype;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required';end if;
 select * into item from public.event_pickup_items where id=p_item_id and item_stage='pack' for update;
 if not found then raise exception 'Additional packing item not found';end if;
 select * into ev from public.events where id=item.event_id;
 if ev.status not in('confirmed','ready_to_pack','packing') then raise exception 'This item cannot be moved now';end if;
 if item.grabbed then raise exception 'Packed items cannot be moved to pickup';end if;
 update public.event_pickup_items set item_stage='pickup',grabbed=false,grabbed_by=null,grabbed_at=null,updated_at=now()
 where id=p_item_id returning * into item;
 return item;
end $$;
revoke all on function public.admin_move_custom_pack_item_to_pickup(uuid) from public,anon;
grant execute on function public.admin_move_custom_pack_item_to_pickup(uuid) to authenticated;