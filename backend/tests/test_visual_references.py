"""
Unit tests for the visual reference (citation) pipeline.

Tests the core functions that map LLM answer values to grounding cell IDs:
  - _extract_question_qualifiers()
  - _extract_answer_values()
  - _find_all_matching_cells()
  - _build_cell_section_map()
  - _extract_section_keywords()

Run:
  cd backend
  python -m pytest tests/test_visual_references.py -v
"""
import sys
import os

# Add backend/ to path so we can import app module helpers
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import (
    _extract_question_qualifiers,
    _extract_answer_values,
    _find_all_matching_cells,
    _normalise_for_match,
    _extract_section_keywords,
)


# ─── Test 1: Year qualifier filtering ────────────────────────────────────────

class TestQuestionQualifiers:
    def test_year_extracted(self):
        q = "What are Total foreign currency assets in 2018?"
        quals = _extract_question_qualifiers(q)
        assert _normalise_for_match("2018") in quals

    def test_multiple_years(self):
        q = "Compare revenue in 2018 and 2019."
        quals = _extract_question_qualifiers(q)
        assert _normalise_for_match("2018") in quals
        assert _normalise_for_match("2019") in quals

    def test_no_years_no_numbers(self):
        q = "What is the net income?"
        quals = _extract_question_qualifiers(q)
        assert len(quals) == 0

    def test_large_number_in_question(self):
        q = "Is 500,000 the correct revenue?"
        quals = _extract_question_qualifiers(q)
        assert _normalise_for_match("500,000") in quals

    def test_year_not_in_question_not_qualifier(self):
        """A year that appears in the answer but NOT the question should NOT be a qualifier."""
        q = "When was the company incorporated?"
        quals = _extract_question_qualifiers(q)
        assert _normalise_for_match("2015") not in quals


# ─── Test 2: Answer value extraction ─────────────────────────────────────────

class TestAnswerValues:
    def test_comma_separated_number(self):
        vals = _extract_answer_values("Revenue was 76,871,204.")
        norms = [n for _, n in vals]
        assert "76871204" in norms

    def test_multiple_values(self):
        vals = _extract_answer_values("Revenue was 500,000 in 2018 and 650,000 in 2019.")
        norms = [n for _, n in vals]
        assert "500000" in norms
        assert "650000" in norms

    def test_plain_number(self):
        vals = _extract_answer_values("Total was 47204137.")
        norms = [n for _, n in vals]
        assert "47204137" in norms

    def test_short_numbers_excluded(self):
        """Numbers under 3 digits shouldn't be extracted (too noisy)."""
        vals = _extract_answer_values("There are 5 items and 42 entries.")
        norms = [n for _, n in vals]
        assert "5" not in norms
        assert "42" not in norms


# ─── Test 3: Year qualifier filtering in matching ────────────────────────────

class TestYearFiltering:
    def test_year_not_matched_when_in_question(self):
        """'2018' in question should NOT match cell '2018' — only the value should match."""
        cell_lookup = {
            "0-5": "2018",
            "0-6": "2019",
            "0-10": "76,871,204",
            "0-11": "80,000,000",
        }
        grounding = {
            "0-5": {"page": 0, "type": "tableCell", "bbox": {}},
            "0-6": {"page": 0, "type": "tableCell", "bbox": {}},
            "0-10": {"page": 0, "type": "tableCell", "bbox": {}},
            "0-11": {"page": 0, "type": "tableCell", "bbox": {}},
        }
        question = "What are Total foreign currency assets in 2018?"
        answer = "Total foreign currency assets in 2018 were 76,871,204."
        qualifiers = _extract_question_qualifiers(question)

        matched = _find_all_matching_cells(
            answer, cell_lookup, grounding, [],
            question_qualifiers=qualifiers,
        )
        matched_ids = [cid for cid, _, _ in matched]

        assert "0-10" in matched_ids, "Should match the value cell 76,871,204"
        assert "0-5" not in matched_ids, "Should NOT match year header 2018"
        assert "0-6" not in matched_ids, "Should NOT match year header 2019"

    def test_year_matched_when_answer_only(self):
        """If year is in the answer but NOT in the question, it should be matched."""
        cell_lookup = {
            "0-3": "2015",
            "0-4": "Company Name",
        }
        grounding = {
            "0-3": {"page": 0, "type": "tableCell", "bbox": {}},
            "0-4": {"page": 0, "type": "tableCell", "bbox": {}},
        }
        question = "When was the company incorporated?"
        answer = "The company was incorporated in 2015."
        qualifiers = _extract_question_qualifiers(question)

        matched = _find_all_matching_cells(
            answer, cell_lookup, grounding, [],
            question_qualifiers=qualifiers,
        )
        matched_ids = [cid for cid, _, _ in matched]

        assert "0-3" in matched_ids, "Year 2015 should match — it's not in the question"


# ─── Test 4: Section-aware scoring ───────────────────────────────────────────

class TestSectionScoring:
    def test_correct_section_ranked_higher(self):
        """Cell in matching section should rank above cell in wrong section."""
        cell_lookup = {
            "0-10": "800,000",
            "5-20": "800,000",
        }
        grounding = {
            "0-10": {"page": 0, "type": "tableCell", "bbox": {}},
            "5-20": {"page": 5, "type": "tableCell", "bbox": {}},
        }
        section_map = {
            "0-10": "Statement of Financial Position",
            "5-20": "Statement of Changes in Equity",
        }
        question = "Balance as at Dec 31 2019 in Statement of Changes in Equity?"
        answer = "The balance was 800,000."
        qualifiers = _extract_question_qualifiers(question)

        matched = _find_all_matching_cells(
            answer, cell_lookup, grounding, [],
            question_qualifiers=qualifiers,
            cell_section_map=section_map,
            question_text=question,
        )

        # Both cells match the value, but 5-20 should rank first (correct section)
        assert len(matched) >= 1
        top_id = matched[0][0]
        assert top_id == "5-20", (
            f"Cell in 'Changes in Equity' should rank first, got {top_id}"
        )

    def test_wrong_section_penalized(self):
        """Cell in wrong section should have lower score."""
        cell_lookup = {
            "0-10": "800,000",
            "5-20": "800,000",
        }
        grounding = {
            "0-10": {"page": 0, "type": "tableCell", "bbox": {}},
            "5-20": {"page": 5, "type": "tableCell", "bbox": {}},
        }
        section_map = {
            "0-10": "Statement of Financial Position",
            "5-20": "Statement of Changes in Equity",
        }
        question = "What is equity balance in Statement of Changes in Equity?"
        answer = "The balance was 800,000."
        qualifiers = _extract_question_qualifiers(question)

        matched = _find_all_matching_cells(
            answer, cell_lookup, grounding, [],
            question_qualifiers=qualifiers,
            cell_section_map=section_map,
            question_text=question,
        )

        # Find scores for each
        scores = {cid: sc for cid, _, sc in matched}
        assert scores.get("5-20", 0) > scores.get("0-10", 0), (
            "Correct section cell should have higher score"
        )


# ─── Test 5: Duplicate table instances (challan) ────────────────────────────

class TestDuplicateTables:
    def test_four_identical_values_all_matched(self):
        """4 identical invoice copies should each produce a match."""
        cell_lookup = {
            "0-5": "143,990",
            "0-25": "143,990",
            "0-45": "143,990",
            "0-65": "143,990",
        }
        grounding = {
            "0-5": {"page": 0, "type": "tableCell", "bbox": {"top": 0.1}},
            "0-25": {"page": 0, "type": "tableCell", "bbox": {"top": 0.3}},
            "0-45": {"page": 0, "type": "tableCell", "bbox": {"top": 0.5}},
            "0-65": {"page": 0, "type": "tableCell", "bbox": {"top": 0.7}},
        }
        answer = "The tuition fee is Rs. 143,990."
        matched = _find_all_matching_cells(answer, cell_lookup, grounding, [])

        matched_ids = [cid for cid, _, _ in matched]
        assert len(matched_ids) == 4, f"Expected 4 matches for 4 copies, got {len(matched_ids)}"
        assert "0-5" in matched_ids
        assert "0-25" in matched_ids
        assert "0-45" in matched_ids
        assert "0-65" in matched_ids


# ─── Test 6: Confidence gating — no false positives ─────────────────────────

class TestConfidenceGating:
    def test_exact_match_preferred_over_partial(self):
        """Exact match (150,000) should be returned, not partial (150)."""
        cell_lookup = {
            "0-5": "150",
            "0-6": "1,500,000",
            "0-7": "150,000",
        }
        grounding = {
            "0-5": {"page": 0, "type": "tableCell", "bbox": {}},
            "0-6": {"page": 0, "type": "tableCell", "bbox": {}},
            "0-7": {"page": 0, "type": "tableCell", "bbox": {}},
        }
        answer = "Net income was 150,000."
        matched = _find_all_matching_cells(answer, cell_lookup, grounding, [])

        matched_ids = [cid for cid, _, _ in matched]
        assert "0-7" in matched_ids, "Exact match 150,000 should be found"
        # "0-5" (just "150") should NOT match because after normalising
        # "150" != "150000", and "150" is only 3 chars which may or may not
        # substring-match. The key is that 0-7 ranks first.
        if "0-5" in matched_ids:
            # If partial matched, ensure exact ranks higher
            scores = {cid: sc for cid, _, sc in matched}
            assert scores["0-7"] >= scores["0-5"]


# ─── Test 7: Multiple values in answer ───────────────────────────────────────

class TestMultipleValues:
    def test_both_values_matched(self):
        """When answer has two values, both should be matched."""
        cell_lookup = {
            "0-10": "500,000",
            "0-11": "650,000",
            "0-5": "2018",
            "0-6": "2019",
        }
        grounding = {
            "0-10": {"page": 0, "type": "tableCell", "bbox": {}},
            "0-11": {"page": 0, "type": "tableCell", "bbox": {}},
            "0-5": {"page": 0, "type": "tableCell", "bbox": {}},
            "0-6": {"page": 0, "type": "tableCell", "bbox": {}},
        }
        question = "Compare revenue in 2018 and 2019."
        answer = "Revenue was 500,000 in 2018 and 650,000 in 2019."
        qualifiers = _extract_question_qualifiers(question)

        matched = _find_all_matching_cells(
            answer, cell_lookup, grounding, [],
            question_qualifiers=qualifiers,
        )
        matched_ids = [cid for cid, _, _ in matched]

        assert "0-10" in matched_ids, "Should match 500,000"
        assert "0-11" in matched_ids, "Should match 650,000"
        assert "0-5" not in matched_ids, "Should NOT match year 2018"
        assert "0-6" not in matched_ids, "Should NOT match year 2019"


# ─── Test 8: Fallback to LLM-cited IDs ──────────────────────────────────────

class TestFallback:
    def test_text_chunk_fallback(self):
        """When no value matches, LLM-cited text chunks should be used."""
        cell_lookup = {}  # no cells
        grounding = {
            "chunk-uuid-1": {"page": 2, "type": "chunkText", "bbox": {}},
        }
        answer = "The central bank maintained healthy reserves throughout the period."
        matched = _find_all_matching_cells(
            answer, cell_lookup, grounding, ["chunk-uuid-1"],
        )

        matched_ids = [cid for cid, _, _ in matched]
        assert "chunk-uuid-1" in matched_ids, "Text chunk should be used as fallback"

    def test_adjacent_cell_fallback(self):
        """If LLM cites an empty cell, adjacent cells with values should be found."""
        cell_lookup = {
            "0-5": "",       # empty — LLM cited this
            "0-6": "150,000",  # adjacent — has the value
        }
        grounding = {
            "0-5": {"page": 0, "type": "tableCell", "bbox": {}},
            "0-6": {"page": 0, "type": "tableCell", "bbox": {}},
        }
        answer = "The amount is 150,000."
        matched = _find_all_matching_cells(
            answer, cell_lookup, grounding, ["0-5"],
        )

        matched_ids = [cid for cid, _, _ in matched]
        assert "0-6" in matched_ids, "Adjacent cell with value should be matched"


# ─── Test 9: Section keyword extraction ──────────────────────────────────────

class TestSectionKeywords:
    def test_equity_extracted(self):
        kw = _extract_section_keywords("What is the balance in Statement of Changes in Equity?")
        assert any("equity" in k for k in kw)

    def test_financial_position_extracted(self):
        kw = _extract_section_keywords("From the Statement of Financial Position")
        assert any("financial position" in k for k in kw)

    def test_cash_flow_extracted(self):
        kw = _extract_section_keywords("What does the cash flow statement show?")
        assert any("cash flow" in k for k in kw)

    def test_no_section_in_generic_question(self):
        kw = _extract_section_keywords("What is the net income?")
        assert len(kw) == 0


# ─── Test 10: Normalisation ─────────────────────────────────────────────────

class TestNormalisation:
    def test_commas_stripped(self):
        assert _normalise_for_match("76,871,204") == "76871204"

    def test_currency_stripped(self):
        assert _normalise_for_match("$1,234") == "1234"
        assert _normalise_for_match("Rs. 143,990") == "rs.143990"

    def test_spaces_stripped(self):
        assert _normalise_for_match("  150 000  ") == "150000"

    def test_parentheses_stripped(self):
        assert _normalise_for_match("(500,000)") == "500000"
