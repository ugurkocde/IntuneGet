-- Fail closed when WinGet expresses a dependency shape that the shared
-- customer and QA packager cannot reproduce safely yet. A newer immutable
-- installer tuple remains independently eligible.

alter table public.qa_package_blocks
  drop constraint if exists qa_package_blocks_block_code_check;

alter table public.qa_package_blocks
  add constraint qa_package_blocks_block_code_check
  check (block_code in (
    'user_scope_machine_dependencies',
    'user_scope_elevation_required',
    'trusted_installer_tuple_unavailable',
    'unsupported_dependency_shape',
    'unreviewed_dependency'
  ));
