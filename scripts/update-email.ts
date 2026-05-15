import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data, error } = await sb.auth.admin.updateUserById(
  "b7724b56-525b-4c6e-ab4b-097b71ae5b41",
  { email: "andrei.macovei@riedhammer.de", email_confirm: true }
);
console.log(error ?? data);
