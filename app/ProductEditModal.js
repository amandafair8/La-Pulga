'use client'

import {useEffect,useState} from 'react'
import {createClient} from '../lib/supabase'

const supabase=createClient()

export default function ProductEditModal({row,onClose,onSaved}){
  const[edit,setEdit]=useState({...row.products})
  const[categories,setCategories]=useState([])
  const[stockMode,setStockMode]=useState('add')
  const[addQty,setAddQty]=useState('')
  const[onHand,setOnHand]=useState(row.on_hand)
  const[note,setNote]=useState('')
  const[busy,setBusy]=useState(false)

  useEffect(()=>{supabase.from('categories').select('id,name').order('name').then(({data,error})=>{if(error)alert(error.message);else setCategories(data||[])})},[])

  function field(key,label,type='text'){
    return <label>{label}<input type={type} value={edit[key]??''} onChange={e=>setEdit(v=>({...v,[key]:e.target.value}))}/></label>
  }

  async function save(e){
    e.preventDefault()
    if(!edit.name?.trim())return alert('Product Name is required.')
    const amount=Number(addQty),physical=Number(onHand)
    if(stockMode==='add'&&addQty!==''&&amount<=0)return alert('Amount Being Added must be greater than 0.')
    if(stockMode==='count'&&(onHand===''||physical<0))return alert('Physical Count must be 0 or more.')
    setBusy(true)
    const{error}=await supabase.rpc('admin_save_product_details',{
      p_product_id:edit.id,p_name:edit.name.trim(),p_category_id:edit.category_id||null,
      p_program:edit.program||null,p_color:edit.color||null,p_size:edit.size||null,
      p_keywords:edit.keywords||null,p_specific_location:edit.specific_location||null,
      p_minimum_stock:Number(edit.minimum_stock)||0,p_reusable:!!edit.reusable,
      p_active:!!edit.active,p_notes:edit.notes||null
    })
    if(error){setBusy(false);return alert(error.message)}

    let nextOnHand=Number(row.on_hand),delta=0
    if(stockMode==='add'&&addQty!==''){
      delta=amount
      const{data,error:stockError}=await supabase.rpc('admin_add_stock',{
        p_stock_id:row.id,p_quantity:amount,p_note:note.trim()||'Inventory restock'
      })
      if(stockError){setBusy(false);return alert(stockError.message)}
      nextOnHand=Number(data)
    }else if(stockMode==='count'){
      nextOnHand=physical
      delta=nextOnHand-Number(row.on_hand)
      if(delta!==0){
        const{error:stockError}=await supabase.rpc('admin_adjust_stock_on_hand',{
          p_stock_id:row.id,p_new_on_hand:nextOnHand,p_note:note.trim()||'Physical inventory count'
        })
        if(stockError){setBusy(false);return alert(stockError.message)}
      }
    }

    const categoryName=categories.find(c=>c.id===edit.category_id)?.name||''
    setBusy(false)
    onSaved({product:{...edit,name:edit.name.trim(),minimum_stock:Number(edit.minimum_stock)||0,categories:categoryName?{name:categoryName}:null},on_hand:nextOnHand,delta})
  }

  const previewTotal=Number(row.on_hand)+(Number(addQty)||0)
  const countChanged=Number(onHand)!==Number(row.on_hand)

  return <div className="eventEditOverlay" role="dialog" aria-modal="true" aria-label="Edit inventory product">
    <div className="eventEditPanel">
      <div className="eventEditTop"><div><small>ADMIN</small><h1>Edit Inventory Row</h1></div><button className="icon" onClick={onClose} aria-label="Close">×</button></div>
      <form className="productEditForm" onSubmit={save}>
        {field('name','Product Name')}
        <label>Category<select value={edit.category_id||''} onChange={e=>setEdit(v=>({...v,category_id:e.target.value||null}))}><option value="">—</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {field('program','Program')}
        {field('color','Color')}
        {field('size','Size')}
        {field('keywords','Keywords')}
        {field('specific_location','Specific Location')}
        <label>Low-Stock Alert Level<input type="number" value={edit.minimum_stock??''} onChange={e=>setEdit(v=>({...v,minimum_stock:e.target.value}))}/><small>This is only an alert threshold. It is never added to the inventory count.</small></label>
        <section className="inventoryRowStockEdit">
          <h2>Stock at {row.locations?.name||'this location'}</h2>
          <p><b>{row.on_hand}</b> physical count · <b>{row.available_qty}</b> available after event reservations</p>
          <p className="stockThresholdNote">Low-stock alert: {edit.minimum_stock||0} (alert only; not included below)</p>
          <div className="stockModeButtons">
            <button type="button" className={stockMode==='add'?'selected':''} onClick={()=>setStockMode('add')}>Add Stock</button>
            <button type="button" className={stockMode==='count'?'selected':''} onClick={()=>setStockMode('count')}>Set Physical Count</button>
          </div>
          {stockMode==='add'?<>
            <label>Amount Being Added<input type="number" min="1" inputMode="numeric" placeholder="Enter the amount received" value={addQty} onChange={e=>setAddQty(e.target.value)}/></label>
            {addQty!==''&&Number(addQty)>0&&<div className="stockPreview"><span>Current physical count: <b>{row.on_hand}</b></span><strong>→</strong><span>New physical count: <b>{previewTotal}</b></span></div>}
            {addQty!==''&&Number(addQty)>0&&<label>Restock Note<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional note about this restock"/></label>}
          </>:<>
            <label>Physical Count<input type="number" min="0" inputMode="numeric" value={onHand} onChange={e=>setOnHand(e.target.value)}/></label>
            {countChanged&&<div className="stockPreview"><span>Current physical count: <b>{row.on_hand}</b></span><strong>→</strong><span>New physical count: <b>{onHand}</b></span></div>}
            {countChanged&&<label>Adjustment Note<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Reason for correcting the inventory count"/></label>}
          </>}
        </section>
        <label className="checkLabel"><input type="checkbox" checked={!!edit.reusable} onChange={e=>setEdit(v=>({...v,reusable:e.target.checked}))}/> Reusable</label>
        <label className="checkLabel"><input type="checkbox" checked={!!edit.active} onChange={e=>setEdit(v=>({...v,active:e.target.checked}))}/> Active</label>
        <label>Notes<textarea value={edit.notes||''} onChange={e=>setEdit(v=>({...v,notes:e.target.value}))}/></label>
        <div className="eventEditSave"><button className="primary" disabled={busy}>{busy?'Saving…':'Save Changes'}</button><button type="button" className="cancelModal" onClick={onClose}>Cancel</button></div>
      </form>
    </div>
  </div>
}
