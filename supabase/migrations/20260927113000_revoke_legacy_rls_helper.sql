-- The helper is not part of the public module API. Remove PostgreSQL's
-- default PUBLIC execute privilege; service_role retains explicit access.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
