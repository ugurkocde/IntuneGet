alter table public.qa_package_blocks
  drop constraint qa_package_blocks_block_code_check;

alter table public.qa_package_blocks
  add constraint qa_package_blocks_block_code_check
  check (
    block_code in (
      'user_scope_machine_dependencies',
      'trusted_installer_tuple_unavailable',
      'unreviewed_dependency'
    )
  );

comment on column public.qa_package_blocks.block_code is
  'Fail-closed compatibility reason that prevents unsafe or unverifiable package generation.';
