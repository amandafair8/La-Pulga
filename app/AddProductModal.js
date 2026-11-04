'use client'

import {useEffect,useState} from 'react'
import {createClient} from '../lib/supabase'

const supabase=createClient()

export default function AddProductModal({onClose,onCreated}){
  const[edit,setEdit]=useState({name:'',category_id:'',program:'',color:'',size:'',keywords:'',specific_location:'',minimum_stock:0,reusable:true,active:true,notes:''})
  const[categories,setCategories]=useState([]),[locations,setLocations]=useState([])
  const[locationId,setLocationId]=useState(''),[onHand,setOnHand]=useState(0),[busy,setBusy]=useState(false)

  useEffect(()=>{Promise.all([
    supabase.from('categories').select('id,name').order('name'),
    supabase.from('locations').select('id,name').order('name')
  ]).then(([c,l])=>{if(c.error||l.error)alert((c.error||l.error).message);else{setCategories(c.data||[]);setLocations(l.data||[])}})},[])

  function field(key,label,type='text'){
    return <label>{label}<input type={type} value={edit[key]??''} onChange={e=>setEdit(v=>({...v,[key]:e.target.value}))}/></label>
  }

  async function save(e){
    e.preventDefault()
    if(!edit.name.trim())return alert('Product Name is required.')
    if(!locationId)return alert('Starting Location is required.')
    if(onHand===''||Number(onHand)<0)return alert('Starting Quantity must be 0 or more.')
    setBusy(true)
    const{data,error}=await supabase.rpc('admin_create_product',{
      p_name:edit.name.trim(),p_category_id:edit.category_id||null,p_program:edit.program||null,
      p_color:edit.color||null,p_size:edit.size||null,p_keywords:edit.keywords||null,
      p_specific_location:edit.specific_location||null,p_minimum_stock:Number(edit.minimum_stock)||0,
      p_reusable:!!edit.reusable,p_active:!!edit.active,p_notes:edit.notes||null,
      p_location_id:locationId,p_on_hand:Number(onHand)
    })
    setBusy(false)
    if(error)return alert(error.message)
    const result=Array.isArray(data)?data[0]:data
    const categoryName=categories.find(c=>c.id===edit.category_id)?.name||''
    const locationName=locations.find(l=>l.id===locationId)?.name||''
    onCreated({
      id:result?.stock_id,product_id:result?.product_id,location_id:locationId,
      on_hand:Number(onHand),available_qty:Number(onHand),
      products:{...edit,id:result?.product_id,name:edit.name.trim(),minimum_stock:Number(edit.minimum_stock)||0,categories:categoryName?{name:categoryName}:null},
      locations:{name:locationName}
    })
  }

  return <div className="eventEditOverlay" role="dialog" aria-modal="true" aria-label="Add inventory product">
    <div className="eventEditPanel">
      <div className="eventEditTop"><div><small>ADMIN</small><h1>Add Product</h1></div><button className="icon" onClick={onClose} aria-label="Close">×</button></div>
      <form className="productEditForm" onSubmit={save}>
        {field('name','Product Name')}
        <label>Category<select value={edit.category_id} onChange={e=>setEdit(v=>({...v,category_id:e.target.value}))}><option value="">—</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {field('program','Program')}
        {field('color','Color')}
        {field('size','Size')}
        {field('keywords','Keywords')}
        {field('specific_location','Specific Location')}
        {field('minimum_stock','Minimum Stock','number')}
        <section className="inventoryRowStockEdit">
          <h2>Starting Stock</h2>
          <label>Location<select value={locationId} onChange={e=>setLocationId(e.target.value)}><option value="">Select a location</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label>Physical On Hand<input type="number" min="0" value={onHand} onChange={e=>setOnHand(e.target.value)}/></label>
        </section>
        <label className="checkLabel"><input type="checkbox" checked={!!edit.reusable} onChange={e=>setEdit(v=>({...v,reusable:e.target.checked}))}/> Reusable</label>
        <label className="checkLabel"><input type="checkbox" checked={!!edit.active} onChange={e=>setEdit(v=>({...v,active:e.target.checked}))}/> Active</label>
        <label>Notes<textarea value={edit.notes} onChange={e=>setEdit(v=>({...v,notes:e.target.value}))}/></label>
        <div className="eventEditSave"><button className="primary" disabled={busy}>{busy?'Creating…':'Create Product'}</button><button type="button" className="cancelModal" onClick={onClose}>Cancel</button></div>
      </form>
    </div>
  </div>
}
