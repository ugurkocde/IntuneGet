-- Keep unsupported immutable installer contracts out of both the QA VM and
-- customer packaging. A newer payload remains independently eligible.

alter table public.qa_package_blocks
  drop constraint if exists qa_package_blocks_block_code_check;

alter table public.qa_package_blocks
  add constraint qa_package_blocks_block_code_check
  check (block_code in (
    'user_scope_machine_dependencies',
    'user_scope_elevation_required',
    'trusted_installer_tuple_unavailable',
    'unreviewed_dependency'
  ));
