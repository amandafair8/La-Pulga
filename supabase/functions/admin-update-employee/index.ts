import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
const h={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json"};
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:h});
 try{
  const auth=req.headers.get("Authorization")||"",token=auth.replace("Bearer ",""),b=await req.json();
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const caller=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const{data:{user},error:ue}=await caller.auth.getUser(token);
  if(ue||!user)throw new Error("Not authenticated.");
  const{data:me}=await caller.from("employees").select("app_access,status").eq("id",user.id).single();
  if(me?.app_access!=="administrator"||me?.status!=="active")throw new Error("Administrator access required.");

  const id=String(b.employee_id||""),first=String(b.first_name||"").trim(),last=String(b.last_name||"").trim(),email=String(b.email||"").trim().toLowerCase(),job=String(b.job_title||"").trim()||null,access=b.app_access==="administrator"?"administrator":"employee",status=b.status==="inactive"?"inactive":"active";
  if(!id||!first||!last||!email)throw new Error("First Name, Last Name, and Email are required.");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Enter a valid email address.");
  if(id===user.id&&(access!=="administrator"||status!=="active"))throw new Error("You cannot remove your own Administrator access or deactivate your own account.");

  const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
  const{data:employee,error:employeeError}=await admin.from("employees").select("id,email").eq("id",id).single();
  if(employeeError||!employee)throw new Error("Employee not found.");
  const oldEmail=String(employee.email||"").trim().toLowerCase();
  const{data:duplicate,error:duplicateError}=await admin.from("employees").select("id").ilike("email",email).neq("id",id).limit(1);
  if(duplicateError)throw duplicateError;
  if(duplicate?.length)throw new Error("That email is already used by another employee.");

  const emailChanged=email!==oldEmail;
  if(emailChanged){
   const{error:authError}=await admin.auth.admin.updateUserById(id,{email});
   if(authError){
    if(/already|registered|exists|duplicate/i.test(authError.message))throw new Error("That email is already connected to another account.");
    throw authError;
   }
  }

  const{error}=await admin.from("employees").update({first_name:first,last_name:last,name:first+" "+last,email,job_title:job,app_access:access,status}).eq("id",id);
  if(error){
   if(emailChanged&&oldEmail)await admin.auth.admin.updateUserById(id,{email:oldEmail});
   throw error;
  }

  await admin.from("audit_log").insert({actor_id:user.id,action:"update",entity_type:"employee",entity_id:id,change_summary:{summary:emailChanged?"Employee details and sign-in email updated":"Employee details updated",email_changed:emailChanged,app_access:access,status}});
  return new Response(JSON.stringify({ok:true,email_changed:emailChanged}),{headers:h});
 }catch(e){return new Response(JSON.stringify({error:e instanceof Error?e.message:"Unable to update employee"}),{status:400,headers:h})}
});