"""Contract checks for PHP orchestrator bridge modules (static structure)."""

from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OAao = REPO / "backbone" / "sites" / "oaaoai" / "oaaoai"


def test_chat_orchestrator_api_library_exists() -> None:
    path = OAao / "chat" / "default" / "library" / "ChatOrchestratorApi.php"
    text = path.read_text(encoding="utf-8")
    assert "postInternalJson" in text
    assert "startChatRun" in text


def test_chat_controller_publishes_bridge_commands() -> None:
    text = (OAao / "chat" / "default" / "controller" / "chat.php").read_text(encoding="utf-8")
    assert "postOrchestratorInternalJson" in text
    assert "buildLiveMeetingOrchestratorExtras" in text
    assert "vaultRetrievalProfilesForVaultIds" in text


def test_vault_retrieval_profiles_module_local() -> None:
    text = (OAao / "vault" / "default" / "library" / "VaultRetrievalProfiles.php").read_text(
        encoding="utf-8",
    )
    assert "VaultArangoResolver" in text
    assert "fromVaultIds" in text


def test_send_does_not_require_vault_glossary_library() -> None:
    text = (OAao / "chat" / "default" / "controller" / "api" / "send.php").read_text(
        encoding="utf-8"
    )
    assert "VaultGlossary.php" not in text
    vault_payload = (
        OAao / "vault" / "default" / "library" / "VaultSendOrchestratorPayload.php"
    ).read_text(encoding="utf-8")
    assert "vaultRetrievalProfilesForVaultIds" in vault_payload
    assert "getWorkspaceGlossary" in vault_payload


def test_slide_designer_publishes_template_api() -> None:
    text = (OAao / "slide-designer" / "default" / "controller" / "slide-designer.php").read_text(
        encoding="utf-8",
    )
    assert "resolvePublishedTemplate" in text
    assert "orchestratorSlideDesignerBase" in text
    assert "enrichAndSyncAssistantSlideMeta" in text


def test_chat_conversation_material_no_slide_registry_require() -> None:
    text = (OAao / "chat" / "default" / "library" / "ChatConversationMaterial.php").read_text(
        encoding="utf-8",
    )
    assert "SlideProjectRegistry.php" not in text
    assert "resolveSlideMaterialByProjectId" in text or "slideApi" in text


def test_assistant_patch_uses_slide_api() -> None:
    text = (OAao / "chat" / "default" / "controller" / "api" / "assistant_patch.php").read_text(
        encoding="utf-8",
    )
    assert "enrichAndSyncAssistantSlideMeta" in text
    assert "SlideProjectRegistry.php" not in text


def test_send_uses_endpoints_api() -> None:
    endpoints_payload = (
        OAao / "endpoints" / "default" / "library" / "EndpointsSendOrchestratorPayload.php"
    ).read_text(encoding="utf-8")
    assert "resolveOrchestratorVaultRagConfig" in endpoints_payload
    text = (OAao / "chat" / "default" / "controller" / "api" / "send.php").read_text(
        encoding="utf-8"
    )
    assert "CanonicalEndpointsRepository" not in text
    assert "ChatSendOrchestratorStage::PAYLOAD" in text


def test_chat_send_pipeline_library_exists() -> None:
    send = (OAao / "chat" / "default" / "controller" / "api" / "send.php").read_text(
        encoding="utf-8",
    )
    assert "ChatSendPipeline" in send
    assert "ChatSendPhase::PREPARE" in send
    for name in ("ChatSendContext.php", "ChatSendPipeline.php", "ChatSendPhase.php"):
        assert (OAao / "chat" / "default" / "library" / name).is_file()
    assert (OAao / "vault" / "default" / "library" / "VaultSendScope.php").is_file()
    assert (OAao / "chat" / "default" / "library" / "ChatSendOrchestratorBinding.php").is_file()
    send_text = send
    assert "ChatSendPhase::SCOPE" in send_text
    assert "ChatSendOrchestratorStage::PAYLOAD" in send_text
    assert "MmModuleSettings.php" not in send_text
