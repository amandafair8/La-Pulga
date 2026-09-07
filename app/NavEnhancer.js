'use client'
import {useEffect} from 'react'
import {useRouter} from 'next/navigation'
export default function NavEnhancer(){const router=useRouter();useEffect(()=>{const click=e=>{const b=e.target.closest('button');const brand=e.target.closest('header b');if(brand){router.push('/');return}if(b){const t=b.textContent.trim();if(t==='Events ›'||t.endsWith('Upcoming Events')){e.preventDefault();e.stopPropagation();router.push('/events')}}};document.addEventListener('click',click,true);const brand=document.querySelector('header b');if(brand){brand.style.cursor='pointer';brand.setAttribute('title','Home')}return()=>document.removeEventListener('click',click,true)},[router]);return null}
