// Supabase project credentials (Project Settings → API in the dashboard).
// NOTE: the value originally supplied for the URL ('sb_publishable_...') was
// actually a publishable API key, not a project URL — it has no https://
// scheme or host, so createClient() could never reach a real endpoint with
// it. The anon key below is a valid JWT whose payload's "ref" claim
// (dcufzmecjdnjymgksvmh) names this project, so that's used to build the
// correct URL instead. If that's not actually this project, replace it with
// the exact URL from Project Settings → API → Project URL.
const SUPABASE_URL = 'https://dcufzmecjdnjymgksvmh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjdWZ6bWVjamRuanltZ2tzdm1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxMzEyODMsImV4cCI6MjEwMzcwNzI4M30.9m9P_6ecxxUoNU3gc8R2Jzf8c50sAENc3J9V_94228w';
// Named supabaseClient, not supabase — the CDN UMD bundle itself declares a
// top-level `var supabase = ...` as its own global export, and a `const
// supabase` here would collide with it ("Identifier 'supabase' has already
// been declared"), since var/const share the same global scope across
// separate <script> tags. Use window.supabase for the library namespace
// (createClient, etc.) and supabaseClient for the actual client instance.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
