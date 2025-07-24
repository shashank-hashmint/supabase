import { createClient } from "https://esm.sh/@supabase/supabase-js@2.42.0";
const supabaseUrl = Deno.env.get('SUPA_URL');
const supabaseKey = Deno.env.get('SUPA_ANON_KEY');
export const supabase = createClient(supabaseUrl, supabaseKey);
