'use client'

import {useEffect,useMemo,useState} from 'react'
import {createClient} from '../lib/supabase'

const supabase=createClient()

export default function PackingTemplateManager({onClose}){
 const[type,setType]=useState('kit'),[templates,setTemplates]=useState([]),[products,setProducts]=useState([]),[editing,setEditing]=useState(null),[name,setName]=useState(''),[notes,setNotes]=useState(''),[items,setItems]=useState([]),[search,setSearch]=useState(''),[busy,setBusy]=useState(false)
 async function load(){
  const[{data:t,error:te},{data:p,error:pe}]=await Promise.all([
   supabase.from('packing_templates').select('id,name,template_type,notes,active,packing_template_items(id,product_id,quantity,products(name,color,size))').eq('active',true).order('name'),
   supabase.from('products').select('id,name,color,size,keywords').eq('active',true).order('name')
  ])
  if(te||pe)return alert((te||pe).message)
  setTemplates(t||[]);setProducts(p||[])
 }
 useEffect(()=>{load()},[])
 function clear(){setEditing(null);setName('');setNotes('');setItems([]);setSearch('')}
 function edit(t){setType(t.template_type);setEditing(t.id);setName(t.name);setNotes(t.notes||'');setItems((t.packing_template_items||[]).map(x=>({product_id:x.product_id,quantity:x.quantity,product:x.products})));setSearch('')}
 function addProduct(p){if(items.some(x=>x.product_id===p.id))return;setItems(v=>[...v,{product_id:p.id,quantity:1,product:p}]);setSearch('')}
 function changeQty(id,value){setItems(v=>v.map(x=>x.product_id===id?{...x,quantity:Math.max(1,Number(value)||1)}:x))}
 async function save(){
  if(!name.trim())return alert(type==='kit'?'Enter a kit name.':'Enter a batch name.')
  if(type==='kit'&&!items.length)return alert('Add at least one product to the kit.')
  setBusy(true)
  const{error}=await supabase.rpc('admin_save_packing_template',{p_id:editing||null,p_name:name.trim(),p_type:type,p_notes:notes.trim()||null,p_items:items.map(x=>({product_id:x.product_id,quantity:x.quantity}))})
  setBusy(false);if(error)return alert(error.message);clear();await load()
 }
 async function remove(t){
  if(!confirm(`Delete “${t.name}”?`))return
  setBusy(true);const{error}=await supabase.rpc('admin_delete_packing_template',{p_id:t.id});setBusy(false)
  if(error)return alert(error.message);if(editing===t.id)clear();await load()
 }
 const q=search.trim().toLowerCase()
 const suggestions=useMemo(()=>q?products.filter(p=>!items.some(x=>x.product_id===p.id)&&[p.name,p.color,p.size,p.keywords].filter(Boolean).some(v=>String(v).toLowerCase().includes(q))).slice(0,8):[],[q,products,items])
 const visible=templates.filter(t=>t.template_type===type)
 return <div className="eventEditOverlay" role="dialog" aria-modal="true" aria-label="Manage kits and batches">
  <div className="eventEditPanel templateManagerPanel">
   <div className="eventEditTop"><div><small>ADMIN · INVENTORY</small><h1>Manage Kits & Batches</h1></div><button className="icon" onClick={onClose} aria-label="Close">×</button></div>
   <div className="segmented"><button type="button" className={type==='kit'?'active':''} onClick={()=>{setType('kit');clear()}}>Kits</button><button type="button" className={type==='batch'?'active':''} onClick={()=>{setType('batch');clear()}}>Batches</button></div>
   <div className="templateEditor">
    <section className="createEventCard templateNameCard">
     <h2>{editing?'Edit':'Add'} {type==='kit'?'Kit':'Batch'}</h2>
     <label>Name<input value={name} onChange={e=>setName(e.target.value)} placeholder={type==='kit'?'Example: Standard Event Bar':'Example: Margarita Batch'}/></label>
    </section>
    {type==='kit'?<>
     <section className="createEventCard templateProductsCard">
      <h2>Products</h2>
      <p className="returnEmpty">Add the products and standard quantities included in this kit.</p>
      <div className="productTypeahead"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Type a product name, color, or size…"/>{suggestions.length>0&&<div className="productSuggestions">{suggestions.map(p=><button type="button" key={p.id} onClick={()=>addProduct(p)}><b>{p.name}</b><small>{[p.color,p.size].filter(Boolean).join(' · ')}</small></button>)}</div>}</div>
      {items.length?<div className="builderRows">{items.map(x=><div className="builderRow" key={x.product_id}><span><b>{x.product?.name}</b>{(x.product?.color||x.product?.size)&&<small>{[x.product.color,x.product.size].filter(Boolean).join(' · ')}</small>}</span><div className="miniQty"><button type="button" onClick={()=>changeQty(x.product_id,x.quantity-1)}>−</button><input inputMode="numeric" value={x.quantity} onChange={e=>changeQty(x.product_id,e.target.value)}/><button type="button" onClick={()=>changeQty(x.product_id,x.quantity+1)}>+</button></div><button type="button" className="removeItem" onClick={()=>setItems(v=>v.filter(y=>y.product_id!==x.product_id))}>Remove</button></div>)}</div>:<p className="returnEmpty templateEmptyProducts">No products added yet.</p>}
     </section>
     <section className="createEventCard templateNotesCard"><h2>Notes <span className="optionalText">Optional</span></h2><label>Kit Notes<textarea rows="4" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="When or how this kit is used"/></label></section>
    </>:<section className="createEventCard templateNotesCard"><h2>Batch Information</h2><label>Preparation, formula, or reference information<textarea rows="7" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Enter the batch formula, preparation instructions, or source reference. This will be informational and will not have a packing checkbox."/></label></section>}
    <div className="templateFormActions"><button type="button" className="primary" disabled={busy} onClick={save}>{busy?'Saving…':editing?'Save Changes':type==='kit'?'Add Kit':'Add Batch'}</button>{editing&&<button type="button" className="cancelModal" onClick={clear}>Cancel Edit</button>}</div>
   </div>
   <section className="createEventCard"><h2>Saved {type==='kit'?'Kits':'Batches'}</h2>{visible.length?<div className="builderRows">{visible.map(t=><div className="builderRow templateSavedRow" key={t.id}><span><b>{t.name}</b><small>{type==='kit'?`${t.packing_template_items?.length||0} products`:(t.notes||'No instructions entered')}</small></span><div className="templateRowActions"><button type="button" onClick={()=>edit(t)}>Edit</button><button type="button" className="removeItem" onClick={()=>remove(t)}>Delete</button></div></div>)}</div>:<p className="returnEmpty">No saved {type==='kit'?'kits':'batches'} yet.</p>}</section>
  </div>
 </div>
}
