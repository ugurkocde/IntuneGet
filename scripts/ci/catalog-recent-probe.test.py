"""No database or credentials: reject false concurrency evidence."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('recent_probe', Path(__file__).with_name('catalog-recent-update-count-postgres.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class ProbeEvidence(unittest.TestCase):
    def test_interval_ignores_query_results(self):
        self.assertEqual(probe.query_interval('\n42\nt0=100.25\n{}\nt1=100.5\n'), (100.25, 100.5))

    def test_missing_reversed_and_duplicate_timestamps_fail(self):
        for output in ['42\n', 't0=2\nt1=1', 't0=1\nt0=1\nt1=2']:
            with self.subTest(output=output), self.assertRaises(AssertionError):
                probe.query_interval(output)

    def test_real_overlap_reports_server_and_client_separately(self):
        workers = [{'start':10+i/1000, 'end':10.1+i/1000, 'client_ms':120+i} for i in range(8)]
        result = probe.measure_overlap(workers, {'start':10.01, 'end':10.02, 'client_ms':40})
        self.assertTrue(result['overlap8'])
        self.assertEqual(result['max_server_ms'], 100)
        self.assertEqual(result['max_client_ms'], 127)
        self.assertEqual(result['unrelated_server_ms'], 10)
        self.assertEqual(result['unrelated_client_ms'], 40)

    def test_serial_workers_and_late_probe_cannot_claim_concurrency(self):
        serial = [{'start':i, 'end':i+0.1, 'client_ms':100} for i in range(8)]
        with self.assertRaisesRegex(AssertionError, '8-way overlap'):
            probe.measure_overlap(serial, {'start':0, 'end':8, 'client_ms':1})
        overlapping = [{'start':0, 'end':1, 'client_ms':100} for _ in range(8)]
        with self.assertRaisesRegex(AssertionError, 'Probe did not overlap'):
            probe.measure_overlap(overlapping, {'start':1, 'end':2, 'client_ms':1})
        with self.assertRaisesRegex(AssertionError, 'Eight workers'):
            probe.measure_overlap(overlapping[:7], {'start':0, 'end':1, 'client_ms':1})

    def test_probe_must_start_after_every_worker(self):
        workers = [{'start':i/100, 'end':1, 'client_ms':100} for i in range(8)]
        with self.assertRaisesRegex(AssertionError, 'Probe started before all workers'):
            probe.measure_overlap(workers, {'start':0.01, 'end':0.2, 'client_ms':1})


if __name__ == '__main__':
    unittest.main()
