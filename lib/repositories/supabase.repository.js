import { supabase } from "../supabase/admin-client.js";

export function createSupabaseRepository(client){
  if(!client) throw new TypeError("Supabase client is required.");
  return Object.freeze({
    rpc:(name,params)=>client.rpc(name,params),
    from:(table)=>client.from(table),
    storage:{from:bucket=>client.storage.from(bucket)},
    auth:client.auth
  });
}

export const db = createSupabaseRepository(supabase);
