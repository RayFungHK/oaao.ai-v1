"""Graph explore viz pruning — connected-component filter."""

from oaao_orchestrator.vault_arango import prune_graph_viz_elements


def _node(nid: str, label: str = "") -> dict:
    return {"data": {"id": nid, "label": label or nid, "type": "concept"}}


def _edge(src: str, tgt: str, eid: str = "") -> dict:
    return {"data": {"id": eid or f"{src}->{tgt}", "source": src, "target": tgt, "label": "related"}}


def test_prune_keeps_largest_connected_component() -> None:
    nodes = [_node("a"), _node("b"), _node("c"), _node("x"), _node("y"), _node("z")]
    edges = [_edge("a", "b"), _edge("b", "c"), _edge("x", "y")]
    kept_nodes, kept_edges, stats = prune_graph_viz_elements(nodes, edges, node_limit=36, max_isolated=10)
    kept_ids = {n["data"]["id"] for n in kept_nodes}
    assert kept_ids == {"a", "b", "c"}
    assert len(kept_edges) == 2
    assert stats["dropped_isolated"] == 3


def test_prune_caps_isolated_nodes_without_edges() -> None:
    nodes = [_node(f"n{i}") for i in range(20)]
    kept_nodes, kept_edges, stats = prune_graph_viz_elements(nodes, [], node_limit=36, max_isolated=8)
    assert len(kept_nodes) == 8
    assert kept_edges == []
    assert stats["dropped_isolated"] == 12
