'use client'

import {useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {createClient} from '../../lib/supabase'

const supabase=createClient()

export default function ProfilePage(){
  const router=useRouter()
  const[employee,setEmployee]=useState(null),[editing,setEditing]=useState(false),[firstName,setFirstName]=useState(''),[lastName,setLastName]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true)

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
      {admin&&<button className="menuButton" disabled>Manage Employees <span>›</span></button>}
      <button className="logoutButton" onClick={logout}>Log Out</button>
    </div>
    <style>{`.profileTitleRow{display:flex;align-items:center;justify-content:space-between}.profileEditButton{border:1px solid #ccc;background:#fff;border-radius:10px;padding:8px 14px;font-weight:700}.profileEditCard{background:#fff;border:1px solid #ddd;border-radius:14px;padding:16px;margin-bottom:14px}.profileEditCard label{display:block;color:#666;font-size:12px;margin-bottom:14px}.profileEditCard input{display:block;width:100%;margin-top:6px;padding:12px;border:1px solid #ccc;border-radius:10px;background:#fff;color:#20201f;font-size:16px}.profileEditActions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px}`}</style>
  </main>
}
