"""CS-2-S3 — library convert helpers."""

from pathlib import Path

from oaao_orchestrator.library.convert import convert_payload_to_blocks, text_to_blocks


def test_text_to_blocks_paragraphs():
    blocks = text_to_blocks("Line one.\n\nLine two.")
    assert len(blocks) >= 2
    assert blocks[0]["type"] == "paragraph"


def test_convert_payload_text():
    blocks, md, status = convert_payload_to_blocks({"text": "Hello\n\nWorld"})
    assert status == "text"
    assert "Hello" in md
    assert len(blocks) >= 1


def test_convert_payload_file_txt(tmp_path: Path):
    p = tmp_path / "note.txt"
    p.write_text("First para.\n\nSecond para.", encoding="utf-8")
    blocks, md, status = convert_payload_to_blocks(
        {"absolute_path": str(p), "mime_type": "text/plain"},
    )
    assert status == "file_extract"
    assert "First" in md
    assert len(blocks) >= 1
