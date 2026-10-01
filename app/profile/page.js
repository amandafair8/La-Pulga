'use client'

import {useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {createClient} from '../../lib/supabase'

const supabase=createClient()

export default function ProfilePage(){
  const router=useRouter()
  const[employee,setEmployee]=useState(null),[editing,setEditing]=useState(false),[firstName,setFirstName]=useState(''),[lastName,setLastName]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[manage,setManage]=useState(false)

  useEffect(()=>{(async()=>{
    const{data:{user}}=await supabase.auth.getUser()
    if(!user){router.replace('/');return}
    const{data,error}=await supabase.from('employees').select('*').eq('id',user.id).single()
    if(error){alert(error.message);router.replace('/');return}
    setEmployee(data)
    const parts=(data?.name||'').trim().split(/\s+/).filter(Boolean)
    setFirstName(parts[0]||'')
    setLastName(parts.slice(1).join(' '))
    setLoading(false)
  })()},[router])

  async function save(){
    const first=firstName.trim(),last=lastName.trim()
    if(!first||!last)return alert('First Name and Last Name are required.')
    setBusy(true)
    const full=`${first} ${last}`
    const{error}=await supabase.from('employees').update({name:full}).eq('id',employee.id)
    if(!error)await supabase.auth.updateUser({data:{name:full,first_name:first,last_name:last}})
    setBusy(false)
    if(error)return alert(error.message)
    setEmployee({...employee,name:full})
    setEditing(false)
  }

  async function logout(){await supabase.auth.signOut();router.replace('/')}
  if(loading)return <main className="center">Loading Profile…</main>
  const admin=employee?.app_access==='administrator'
  if(manage&&admin)return <ManageProducts back={()=>setManage(false)}/>
  return <main>
    <header><div><b style={{cursor:'pointer'}} onClick={()=>router.push('/')}>LA PULGA</b></div><button className="profileButton" aria-label="Profile">👤</button></header>
    <div className="content">
      <button className="back" onClick={()=>router.push('/')}>‹ Back</button>
      <div className="profileTitleRow"><h1>Profile</h1>{!editing&&<button className="profileEditButton" onClick={()=>setEditing(true)}>Edit</button>}</div>
      {!editing?<div className="profileCard"><div><span>Name</span><b>{employee?.name||'—'}</b></div><div><span>Job Title</span><b>{employee?.job_title||'—'}</b></div></div>:<div className="profileEditCard">
        <label>First Name<input required value={firstName} onChange={e=>setFirstName(e.target.value)}/></label>
        <label>Last Name<input required value={lastName} onChange={e=>setLastName(e.target.value)}/></label>
        <div className="profileEditActions"><button className="secondaryAction" disabled={busy} onClick={()=>{const parts=(employee?.name||'').trim().split(/\s+/).filter(Boolean);setFirstName(parts[0]||'');setLastName(parts.slice(1).join(' '));setEditing(false)}}>Cancel</button><button className="primary" disabled={busy||!firstName.trim()||!lastName.trim()} onClick={save}>{busy?'Saving…':'Save'}</button></div>
      </div>}
      {admin&&<><button className="menuButton" onClick={()=>setManage(true)}>Manage Products <span>›</span></button><button className="menuButton" disabled>Manage Employees <span>›</span></button></>}
      <button className="logoutButton" onClick={logout}>Log Out</button>
    </div>
    <style>{`.productEditBackdrop{position:fixed;inset:0;z-index:9999;background:#0006;display:flex;align-items:stretch;justify-content:center;padding:12px}.productEditModal{width:min(100%,520px);height:auto;max-height:calc(100dvh - 24px);margin:0;background:#fff;border-radius:18px;padding:22px;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y}.productEditModal .productEditForm{padding-bottom:32px}.productEditModal .productEditForm>.primary{margin-top:6px}.profileTitleRow{display:flex;align-items:center;justify-content:space-between}.profileEditButton{border:1px solid #ccc;background:#fff;border-radius:10px;padding:8px 14px;font-weight:700}.profileEditCard{background:#fff;border:1px solid #ddd;border-radius:14px;padding:16px;margin-bottom:14px}.profileEditCard label{display:block;color:#666;font-size:12px;margin-bottom:14px}.profileEditCard input{display:block;width:100%;margin-top:6px;padding:12px;border:1px solid #ccc;border-radius:10px;background:#fff;color:#20201f;font-size:16px}.profileEditActions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px}`}</style>
  </main>
}


function ManageProducts({back}){
  const[rows,setRows]=useState([]),[cats,setCats]=useState([]),[q,setQ]=useState(''),[edit,setEdit]=useState(null),[busy,setBusy]=useState(false)
  async function load(){
    const[{data:p,error},{data:c,error:ce}]=await Promise.all([
      supabase.from('products').select('*,categories(name)').order('name'),
      supabase.from('categories').select('id,name').order('name')
    ])
    if(error||ce)return alert((error||ce).message)
    setRows(p||[]);setCats(c||[])
  }
  useEffect(()=>{load()},[])
  const shown=rows.filter(x=>!q.trim()||[x.name,x.categories?.name,x.program,x.color,x.size,x.keywords].filter(Boolean).some(v=>String(v).toLowerCase().includes(q.toLowerCase())))
  async function save(e){
    e.preventDefault();setBusy(true)
    const{error}=await supabase.rpc('admin_save_product_details',{p_product_id:edit.id,p_name:edit.name,p_category_id:edit.category_id||null,p_program:edit.program||null,p_color:edit.color||null,p_size:edit.size||null,p_keywords:edit.keywords||null,p_specific_location:edit.specific_location||null,p_minimum_stock:Number(edit.minimum_stock)||0,p_reusable:!!edit.reusable,p_active:!!edit.active,p_notes:edit.notes||null})
    setBusy(false);if(error)return alert(error.message);setEdit(null);await load()
  }
  const field=(k,label,type='text')=><label>{label}<input type={type} value={edit?.[k]??''} onChange={e=>setEdit({...edit,[k]:e.target.value})}/></label>
  return <main><header><div><b>LA PULGA</b></div><button className="profileButton" aria-label="Profile">👤</button></header><div className="content"><button className="back" onClick={back}>‹ Profile</button><h1>Manage Products</h1><div className="inventorySearch productAdminSearch"><span>⌕</span><input type="search" placeholder="Search products" value={q} onChange={e=>setQ(e.target.value)}/>{q&&<button onClick={()=>setQ('')}>×</button>}</div><div className="productAdminList">{shown.map(p=><button type="button" key={p.id} className="productAdminRow" onClick={e=>{e.preventDefault();setEdit({...p})}}><span><b>{p.name}</b><small>{[p.categories?.name,p.color,p.size].filter(Boolean).join(' · ')||'No category details'}</small></span><span className="productAdminMeta">Min {p.minimum_stock||0}{!p.active?' · Inactive':''} ›</span></button>)}</div>{edit&&<div className="productEditBackdrop" onClick={()=>setEdit(null)}><div className="productEditModal" onClick={e=>e.stopPropagation()}><button className="back" onClick={()=>setEdit(null)}>‹ Products</button><h1>Edit Product</h1><form className="productEditForm" onSubmit={save}>{field('name','Product Name')}<label>Category<select value={edit.category_id||''} onChange={e=>setEdit({...edit,category_id:e.target.value||null})}><option value="">—</option>{cats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{field('program','Program')}{field('color','Color')}{field('size','Size')}{field('keywords','Keywords')}{field('specific_location','Specific Location')}{field('minimum_stock','Minimum Stock','number')}<label className="checkLabel"><input type="checkbox" checked={!!edit.reusable} onChange={e=>setEdit({...edit,reusable:e.target.checked})}/> Reusable</label><label className="checkLabel"><input type="checkbox" checked={!!edit.active} onChange={e=>setEdit({...edit,active:e.target.checked})}/> Active</label><label>Notes<textarea value={edit.notes||''} onChange={e=>setEdit({...edit,notes:e.target.value})}/></label><button className="primary" disabled={busy}>{busy?'Saving…':'Save Product'}</button></form></div></div>}</div></main>
}