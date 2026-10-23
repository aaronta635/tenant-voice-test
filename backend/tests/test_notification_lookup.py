"""notifications.notified: which links a person already has a notice with, looked up a chunk at a time.

A tenant's broad preferences can make hundreds of listings fresh matches;
one in() of every link would make a request URL the gateway refuses, so the
lookup sends _common.IN_CHUNK links at a time.
"""

import pytest

from app.services import _common, notifications
from tests import fake_supabase
from tests.factories_identity import users_row

pytestmark = pytest.mark.usefixtures("strict_schema")

MEI = "c3000000-0000-4000-8000-000000000001"


def test_hundreds_of_links_are_looked_up_a_chunk_at_a_time(strict_schema, monkeypatch):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test")])
    links = [f"/matches/property/{index:08d}-0000-4000-8000-000000000000" for index in range(250)]
    strict_schema.seed("notifications", [
        {"user_id": MEI, "title": "New match", "body": "", "category": "system", "link": link}
        for link in (links[3], links[180])
    ])
    sent = []
    real_in = fake_supabase.FakeTableQuery.in_

    def counted(query, column, values):
        sent.append(list(values))
        return real_in(query, column, values)

    monkeypatch.setattr(fake_supabase.FakeTableQuery, "in_", counted)

    assert notifications.notified(MEI, links) == {links[3], links[180]}
    # Every link is asked about, never more than IN_CHUNK in one request.
    assert max(len(values) for values in sent) <= _common.IN_CHUNK
    assert {link for values in sent for link in values} == set(links)
