import unittest
from unittest.mock import patch


class TestTestHealthCollector(unittest.TestCase):

    @patch("livingcode.collectors.test_health._run_command")
    @patch("livingcode.collectors.test_health._find_untested_routes")
    @patch("livingcode.collectors.test_health._count_test_files")
    def test_collects_js_test_results(self, mock_count, mock_untested, mock_cmd):
        from livingcode.collectors.test_health import collect_test_health
        mock_cmd.side_effect = [
            (0, "Tests  107 passed (107)\nDuration  12.34s"),
            (0, "12 passed in 3.45s"),
        ]
        mock_count.return_value = (107, 250)
        mock_untested.return_value = ["api/cron/signals"]
        result = collect_test_health("/fake/repo")
        self.assertEqual(result.js_tests.total, 107)
        self.assertEqual(result.js_tests.passed, 107)
        self.assertEqual(result.js_tests.failed, 0)

    @patch("livingcode.collectors.test_health._run_command")
    @patch("livingcode.collectors.test_health._find_untested_routes")
    @patch("livingcode.collectors.test_health._count_test_files")
    def test_collects_python_test_results(self, mock_count, mock_untested, mock_cmd):
        from livingcode.collectors.test_health import collect_test_health
        mock_cmd.side_effect = [
            (0, "Tests  50 passed (50)\nDuration  5.00s"),
            (0, "12 passed in 3.45s"),
        ]
        mock_count.return_value = (50, 200)
        mock_untested.return_value = []
        result = collect_test_health("/fake/repo")
        self.assertEqual(result.python_tests.total, 12)
        self.assertEqual(result.python_tests.passed, 12)

    @patch("livingcode.collectors.test_health._run_command")
    @patch("livingcode.collectors.test_health._find_untested_routes")
    @patch("livingcode.collectors.test_health._count_test_files")
    def test_handles_js_test_failures(self, mock_count, mock_untested, mock_cmd):
        from livingcode.collectors.test_health import collect_test_health
        mock_cmd.side_effect = [
            (1, "Tests  3 failed | 104 passed (107)\nDuration  12.34s"),
            (0, "12 passed in 3.45s"),
        ]
        mock_count.return_value = (107, 250)
        mock_untested.return_value = []
        result = collect_test_health("/fake/repo")
        self.assertEqual(result.js_tests.failed, 3)
        self.assertEqual(result.js_tests.passed, 104)

    @patch("livingcode.collectors.test_health._run_command")
    @patch("livingcode.collectors.test_health._find_untested_routes")
    @patch("livingcode.collectors.test_health._count_test_files")
    def test_calculates_test_file_ratio(self, mock_count, mock_untested, mock_cmd):
        from livingcode.collectors.test_health import collect_test_health
        mock_cmd.side_effect = [
            (0, "Tests  50 passed (50)\nDuration  5.00s"),
            (0, "12 passed in 3.45s"),
        ]
        mock_count.return_value = (100, 200)
        mock_untested.return_value = []
        result = collect_test_health("/fake/repo")
        self.assertAlmostEqual(result.test_file_ratio, 100 / 300)

    @patch("livingcode.collectors.test_health._run_command")
    @patch("livingcode.collectors.test_health._find_untested_routes")
    @patch("livingcode.collectors.test_health._count_test_files")
    def test_parses_vitest_output_with_skipped(self, mock_count, mock_untested, mock_cmd):
        # Regression: real vitest summaries carry a "| N skipped" segment between
        # "passed" and "(total)". The original regex required passed to be
        # immediately followed by "(total)", so it silently returned 0/0/0 on
        # every real run (digest showed 0 JS tests while 2178 existed).
        from livingcode.collectors.test_health import collect_test_health
        mock_cmd.side_effect = [
            (0, "Tests  2178 passed | 5 skipped (2183)\nDuration  25.15s"),
            (0, "12 passed in 3.45s"),
        ]
        mock_count.return_value = (260, 900)
        mock_untested.return_value = []
        result = collect_test_health("/fake/repo")
        self.assertEqual(result.js_tests.passed, 2178)
        self.assertEqual(result.js_tests.failed, 0)
        self.assertEqual(result.js_tests.total, 2183)

    @patch("livingcode.collectors.test_health._run_command")
    @patch("livingcode.collectors.test_health._find_untested_routes")
    @patch("livingcode.collectors.test_health._count_test_files")
    def test_parses_vitest_output_with_failed_and_skipped(self, mock_count, mock_untested, mock_cmd):
        from livingcode.collectors.test_health import collect_test_health
        mock_cmd.side_effect = [
            (1, "Tests  3 failed | 104 passed | 2 skipped (109)\nDuration  9.0s"),
            (0, "12 passed in 3.45s"),
        ]
        mock_count.return_value = (100, 300)
        mock_untested.return_value = []
        result = collect_test_health("/fake/repo")
        self.assertEqual(result.js_tests.failed, 3)
        self.assertEqual(result.js_tests.passed, 104)
        self.assertEqual(result.js_tests.total, 109)

    @patch("livingcode.collectors.test_health._run_command")
    @patch("livingcode.collectors.test_health._find_untested_routes")
    @patch("livingcode.collectors.test_health._count_test_files")
    def test_handles_no_python_tests(self, mock_count, mock_untested, mock_cmd):
        from livingcode.collectors.test_health import collect_test_health
        mock_cmd.side_effect = [
            (0, "Tests  50 passed (50)\nDuration  5.00s"),
            (1, "no tests ran"),
        ]
        mock_count.return_value = (50, 200)
        mock_untested.return_value = []
        result = collect_test_health("/fake/repo")
        self.assertEqual(result.python_tests.total, 0)


if __name__ == "__main__":
    unittest.main()
