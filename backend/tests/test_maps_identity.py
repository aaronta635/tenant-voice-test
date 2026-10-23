"""The identity mappings: the LIKE pattern an email lookup sends, and how addresses compare."""

import pytest

from app.services import maps_identity


@pytest.mark.parametrize("value, pattern", [
    ("mei@demo.test", "mei@demo.test"),
    ("mei_lin@demo.test", "mei\\_lin@demo.test"),
    ("100%real@demo.test", "100\\%real@demo.test"),
    ("back\\slash@demo.test", "back\\\\slash@demo.test"),
    # PostgREST reads * as %, with no escape for it, so it can match only one character.
    ("star*@demo.test", "star_@demo.test"),
    ("a_b%c\\d*e@x", "a\\_b\\%c\\\\d_e@x"),
])
def test_an_ilike_pattern_escapes_like_wildcards(value, pattern):
    assert maps_identity.ilike_exact(value) == pattern


def test_addresses_compare_ignoring_case_and_surrounding_space():
    assert maps_identity.same_email(" Mei.Lin@Demo.test ", "mei.lin@demo.test")
    assert not maps_identity.same_email("meiXlin@demo.test", "mei_lin@demo.test")
    assert not maps_identity.same_email(None, "mei@demo.test")
