'use client'

import {useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {createClient} from '../../../lib/supabase'
const supabase=createClient()

export default function ProductsPage(){
 const router=useRouter(),[rows,setRows]=useState([]),[cats,setCats]=useState([]),[q,setQ]=useState(''),[edit,setEdit]=useState(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true)
 async function load(){
  const{data:{user}}=await supabase.auth.getUser();if(!user){router.replace('/');return}
  const{data:emp}=await supabase.from('employees').select('app_access').eq('id',user.id).single();if(emp?.app_access!=='administrator'){router.replace('/profile');return}
  const[{data:p,error},{data:c,error:ce}]=await Promise.all([supabase.from('products').select('*,categories(name)').order('name'),supabase.from('categories').select('id,name').order('name')])
  if(error||ce){alert((error||ce).message);return} setRows(p||[]);setCats(c||[]);setLoading(false)
 }
 useEffect(()=>{load()},[])
 useEffect(()=>{if(edit)window.scrollTo({top:0,left:0,behavior:'instant'})},[edit])
 const shown=rows.filter(x=>!q.trim()||[x.name,x.categories?.name,x.program,x.color,x.size,x.keywords].filter(Boolean).some(v=>String(v).toLowerCase().includes(q.toLowerCase())))
 async function save(e){e.preventDefault();setBusy(true);const{error}=await supabase.rpc('admin_save_product_details',{p_product_id:edit.id,p_name:edit.name,p_category_id:edit.category_id||null,p_program:edit.program||null,p_color:edit.color||null,p_size:edit.size||null,p_keywords:edit.keywords||null,p_specific_location:edit.specific_location||null,p_minimum_stock:Number(edit.minimum_stock)||0,p_reusable:!!edit.reusable,p_active:!!edit.active,p_notes:edit.notes||null});setBusy(false);if(error)return alert(error.message);setEdit(null);await load()}
 const field=(k,label,type='text')=><label>{label}<input type={type} value={edit?.[k]??''} onChange={e=>setEdit({...edit,[k]:e.target.value})}/></label>
 if(loading)return <main className="center">Loading Products…</main>
 if(edit)return <main><header><div><b>LA PULGA</b></div></header><div className="content"><button className="back" onClick={()=>setEdit(null)}>‹ Products</button><h1>Edit Product</h1><form className="productEditForm" onSubmit={save}>{field('name','Product Name')}<label>Category<select value={edit.category_id||''} onChange={e=>setEdit({...edit,category_id:e.target.value||null})}><option value="">—</option>{cats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{field('program','Program')}{field('color','Color')}{field('size','Size')}{field('keywords','Keywords')}{field('specific_location','Specific Location')}{field('minimum_stock','Minimum Stock','number')}<label className="checkLabel"><input type="checkbox" checked={!!edit.reusable} onChange={e=>setEdit({...edit,reusable:e.target.checked})}/> Reusable</label><label className="checkLabel"><input type="checkbox" checked={!!edit.active} onChange={e=>setEdit({...edit,active:e.target.checked})}/> Active</label><label>Notes<textarea value={edit.notes||''} onChange={e=>setEdit({...edit,notes:e.target.value})}/></label><button className="primary" disabled={busy}>{busy?'Saving…':'Save Product'}</button></form></div></main>
 return <main><header><div><b>LA PULGA</b></div></header><div className="content"><button className="back" onClick={()=>router.push('/profile')}>‹ Profile</button><h1>Manage Products</h1><div className="inventorySearch productAdminSearch"><span>⌕</span><input type="search" placeholder="Search products" value={q} onChange={e=>setQ(e.target.value)}/>{q&&<button onClick={()=>setQ('')}>×</button>}</div><div className="productAdminList">{shown.map(p=><div key={p.id} className="productAdminRow" role="button" tabIndex={0} onClick={()=>setEdit({...p})}><span><b>{p.name}</b><small>{[p.categories?.name,p.color,p.size].filter(Boolean).join(' · ')||'No category details'}</small></span><span className="productAdminMeta">Min {p.minimum_stock||0}{!p.active?' · Inactive':''} ›</span></div>)}</div></div></main>
}
