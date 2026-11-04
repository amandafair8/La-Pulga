create or replace function public.admin_create_product(
 p_name text,p_category_id uuid,p_program text,p_color text,p_size text,p_keywords text,
 p_specific_location text,p_minimum_stock integer,p_reusable boolean,p_active boolean,p_notes text,
 p_location_id uuid,p_on_hand integer
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
 v_product_id uuid;
 v_stock_id uuid;
 v_qty integer:=coalesce(p_on_hand,0);
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required'; end if;
 if nullif(trim(p_name),'') is null then raise exception 'Product Name is required'; end if;
 if p_location_id is null then raise exception 'Starting Location is required'; end if;
 if v_qty<0 then raise exception 'Starting quantity must be 0 or more'; end if;
 if coalesce(p_minimum_stock,0)<0 then raise exception 'Minimum stock must be 0 or more'; end if;
 insert into public.products(name,category_id,program,color,size,keywords,specific_location,minimum_stock,reusable,active,notes)
 values(trim(p_name),p_category_id,nullif(trim(p_program),''),nullif(trim(p_color),''),nullif(trim(p_size),''),
        nullif(trim(p_keywords),''),nullif(trim(p_specific_location),''),coalesce(p_minimum_stock,0),
        coalesce(p_reusable,true),coalesce(p_active,true),nullif(trim(p_notes),''))
 returning id into v_product_id;
 insert into public.stock(product_id,location_id,on_hand)
 values(v_product_id,p_location_id,v_qty) returning id into v_stock_id;
 if v_qty>0 then
   insert into public.inventory_transactions(product_id,location_id,transaction_type,quantity_delta,processed_by,note)
   values(v_product_id,p_location_id,'admin_adjustment',v_qty,auth.uid(),'Starting inventory');
 end if;
 insert into public.audit_log(actor_id,entity_type,entity_id,action,change_summary)
 values(auth.uid(),'product',v_product_id,'created',jsonb_build_object('stock_id',v_stock_id,'starting_quantity',v_qty,'location_id',p_location_id));
 return jsonb_build_object('product_id',v_product_id,'stock_id',v_stock_id);
end;
$function$;
revoke execute on function public.admin_create_product(text,uuid,text,text,text,text,text,integer,boolean,boolean,text,uuid,integer) from public,anon;
grant execute on function public.admin_create_product(text,uuid,text,text,text,text,text,integer,boolean,boolean,text,uuid,integer) to authenticated;
