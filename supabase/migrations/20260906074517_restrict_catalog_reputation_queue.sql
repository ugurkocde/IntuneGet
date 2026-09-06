REVOKE ALL ON FUNCTION public.request_catalog_file_reputation(text[], boolean) FROM anon, authenticated;
REVOKE ALL ON TABLE public.catalog_file_reputation FROM anon, authenticated;
GRANT SELECT ON TABLE public.catalog_file_reputation TO anon, authenticated;
