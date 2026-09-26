import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
  }

  try {
    const { certificateCode } = await request.json();
    const code = String(certificateCode ?? "").trim().toUpperCase();
    if (!/^FAIMER-AIIPE-2026-[A-Z0-9]{10}$/.test(code)) {
      return new Response(JSON.stringify({ valid: false, message: "Enter a valid certificate code." }), { headers: corsHeaders });
    }

    const client = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await client
      .from("ai_ipe_module_certificates")
      .select("certificate_code, participant_name, module_title, module_period, issued_on, verifier_name, revoked_at")
      .eq("certificate_code", code)
      .maybeSingle();

    if (error) throw error;
    if (!data || data.revoked_at) {
      return new Response(JSON.stringify({ valid: false, message: "No active certificate was found for that code." }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({
      valid: true,
      certificateCode: data.certificate_code,
      participantName: data.participant_name,
      moduleTitle: data.module_title,
      modulePeriod: data.module_period,
      issuedOn: data.issued_on,
      verifierName: data.verifier_name,
    }), { headers: corsHeaders });
  } catch (_error) {
    return new Response(JSON.stringify({ valid: false, message: "Certificate verification is temporarily unavailable." }), { status: 500, headers: corsHeaders });
  }
});
