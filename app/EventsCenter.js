'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../lib/supabase'

const supabase=createClient()

const fmtDate=v=>{if(!v)return '—';const d=new Date(v+'T12:00:00');return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}
const fmtStatus=v=>(v||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase())

export default function EventsCenter({back}){
  const[events,setEvents]=useState([]),[search,setSearch]=useState(''),[selected,setSelected]=useState(null),[mode,setMode]=useState('list'),[loading,setLoading]=useState(true)
  async function load(){setLoading(true);const{data,error}=await supabase.from('events').select('id,name,event_date,status,fulfillment,must_ship_by,return_expected').order('event_date',{ascending:true});if(error)alert(error.message);setEvents(data||[]);setLoading(false)}
  useEffect(()=>{load()},[])
  const filtered=useMemo(()=>{const q=search.trim().toLowerCase();return events.filter(e=>!q||[e.name,e.event_date,e.status,e.fulfillment].filter(Boolean).some(v=>String(v).toLowerCase().includes(q)))},[events,search])
  const today=new Date().toISOString().slice(0,10)
  const pastStatuses=new Set(['returned','closed'])
  const upcoming=filtered.filter(e=>!pastStatuses.has(e.status)&&(e.event_date>=today||['draft','confirmed','ready_to_pack','packing','packed','checked_out','shipped'].includes(e.status))).sort((a,b)=>(a.fulfillment==='ship'&&a.must_ship_by?a.must_ship_by:a.event_date).localeCompare(b.fulfillment==='ship'&&b.must_ship_by?b.must_ship_by:b.event_date))
  const past=filtered.filter(e=>!upcoming.some(u=>u.id===e.id)).sort((a,b)=>b.event_date.localeCompare(a.event_date))
  if(mode==='create')return <><button className="back" onClick={()=>setMode('list')}>‹ Back</button><h1>Create Event</h1><div className="eventEmptyCard"><b>Create Event</b><p>The full one-page event builder is the next Events workflow step.</p></div></>
  if(mode==='repeat')return <><button className="back" onClick={()=>setMode('list')}>‹ Back</button><h1>Repeat Previous Event</h1><div className="eventEmptyCard"><b>Repeat Previous Event</b><p>Selecting what to copy will be added with the event builder.</p></div></>
  if(selected)return <EventPage event={selected} close={()=>{setSelected(null);load()}}/>
  return <><button className="back" onClick={back}>‹ Back</button><div className="eventsTitleRow"><h1>Events</h1></div><div className="eventSearch"><span>⌕</span><input type="search" placeholder="Search events" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button onClick={()=>setSearch('')}>×</button>}</div><div className="eventActions"><button className="primary" onClick={()=>setMode('create')}>+ Create Event</button><button className="secondaryAction" onClick={()=>setMode('repeat')}>↻ Repeat Previous Event</button></div>{loading?<p className="returnEmpty">Loading events…</p>:<><EventGroup title="Upcoming Events" rows={upcoming} empty="No upcoming events yet." open={setSelected}/><EventGroup title="Past Events" rows={past} empty="No past events yet." open={setSelected}/></>}</>
}

function EventGroup({title,rows,empty,open}){return <section className="eventGroup"><h2>{title}</h2>{rows.length?<div className="eventCards">{rows.map(e=><button className="eventCard" key={e.id} onClick={()=>open(e)}><span className="eventDate">{fmtDate(e.event_date)}</span><span className="eventCardMain"><b>{e.name}</b><small>{fmtStatus(e.status)}{e.fulfillment==='ship'?' · Ship':''}</small></span><span className="eventChevron">›</span></button>)}</div>:<p className="returnEmpty">{empty}</p>}</section>}

function EventPage({event,close}){const[items,setItems]=useState([]),[tasks,setTasks]=useState([]),[notes,setNotes]=useState([]),[busy,setBusy]=useState(false)
  async function load(){const[{data:i},{data:t},{data:n}]=await Promise.all([supabase.from('event_items').select('id,qty_needed,qty_packed,packed,products(name)').eq('event_id',event.id),supabase.from('event_tasks').select('*').eq('event_id',event.id),supabase.from('event_notes').select('*').eq('event_id',event.id)]);setItems(i||[]);setTasks(t||[]);setNotes(n||[])}
  useEffect(()=>{load()},[event.id])
  async function pack(i){setBusy(true);const{error}=await supabase.rpc('pack_event_item',{p_event_item_id:i.id,p_qty_packed:i.qty_needed});setBusy(false);if(error)return alert(error.message);await load()}
  async function move(){setBusy(true);const fn=event.fulfillment==='ship'?'mark_event_shipped':'mark_event_checked_out';const{error}=await supabase.rpc(fn,{p_event_id:event.id});setBusy(false);if(error)return alert(error.message);alert(event.fulfillment==='ship'?'Marked shipped':'Event checked out');close()}
  return <><button className="back" onClick={close}>‹ Events</button><div className="eventPageHeader"><div><span className="eventDate">{fmtDate(event.event_date)}</span><h1>{event.name}</h1><span className="eventStatusBadge">{fmtStatus(event.status)}</span></div></div><details className="eventDetailSection" open><summary>Packing List <span>{items.length}</span></summary><div className="eventDetailBody">{items.length?items.map(i=><div className="pack" key={i.id}><span><b>{i.products?.name||'—'}</b><small>Need {i.qty_needed}{i.packed?` · Packed ${i.qty_packed}`:''}</small></span><button disabled={busy||i.packed} onClick={()=>pack(i)}>{i.packed?'✓':'Pack'}</button></div>):<p className="returnEmpty">No packing items yet.</p>}</div></details><details className="eventDetailSection"><summary>Tasks <span>{tasks.length}</span></summary><div className="eventDetailBody">{tasks.length?tasks.map(t=><div className="simpleEventRow" key={t.id}>{t.task||t.task_item||t.name||'Task'}</div>):<p className="returnEmpty">No tasks yet.</p>}</div></details><details className="eventDetailSection"><summary>Notes <span>{notes.length}</span></summary><div className="eventDetailBody">{notes.length?notes.map(n=><div className="simpleEventRow" key={n.id}>{n.note||n.notes||n.content||'Note'}</div>):<p className="returnEmpty">No notes yet.</p>}</div></details>{['packing','packed'].includes(event.status)&&<button className="primary eventMoveButton" disabled={busy} onClick={move}>{event.fulfillment==='ship'?'Mark as Shipped':'Check Out Event'}</button>}</>}
