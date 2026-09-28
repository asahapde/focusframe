from focusframe_api.contract import CONTRACT_PATH, openapi_document


def test_committed_contract_matches_the_server_schema():
    assert CONTRACT_PATH.read_text(encoding="utf-8") == openapi_document(), (
        "contract/openapi.json is stale: run `python -m focusframe_api.contract` "
        "and then `npm run gen:api` in web/"
    )
