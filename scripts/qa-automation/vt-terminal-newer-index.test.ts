import { it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

it('uses the case-insensitive newer-candidate index at catalog scale', async () => {
  const fixture = await historicalFixture();
  try {
    await fixture.pg.exec(fixture.read('../../supabase/migrations/20261018104456_qa_vt_terminal_newer_index.sql'));
    await fixture.pg.exec(fixture.read('../../supabase/tests/qa_vt_terminal_newer_index.sql'));
  } finally {
    await fixture.pg.close();
  }
}, 30000);
