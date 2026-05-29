<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Mutable per-request state for {@see ChatSendPipeline} hooks.
 *
 * Core fields are set at construction; module listeners mutate composer / orchestrator fragments.
 * Avoid adding cross-module types here — modules write into namespaced keys via {@see self::moduleData()}.
 */
final class ChatSendContext
{
    /** @var array<string, mixed> */
    private array $moduleData = [];

    /**
     * @param array<string, mixed> $input Decoded POST body
     */
    public function __construct(
        public readonly int $userId,
        public readonly int $workspaceId,
        public readonly array $input,
        public readonly int $chatEndpointId = 0,
        public readonly bool $isBubbleChat = false,
        public readonly bool $appendAssistantTurn = false,
        public readonly ?int $conversationId = null,
    ) {
    }

    /** @var list<int> */
    public array $vaultSourceIds = [];

    /**
     * @var list<array{kind: string, id: int, vault_id: int, name: string}>
     */
    public array $vaultSourceRefs = [];

    public bool $vaultAutoRag = false;

    public bool $enableWebSearch = false;

    /** @var list<int> */
    public array $attachmentIds = [];

    /**
     * Module-owned scratch space — key is module api_name ({@code vault}, {@code slide_designer}, …).
     *
     * @return array<string, mixed>
     */
    public function moduleData(string $moduleApiName): array
    {
        $k = strtolower(trim($moduleApiName));
        if ($k === '') {
            return [];
        }
        if (! isset($this->moduleData[$k]) || ! \is_array($this->moduleData[$k])) {
            $this->moduleData[$k] = [];
        }

        return $this->moduleData[$k];
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function abort(int $httpStatus, array $payload): never
    {
        throw new ChatSendAbort($httpStatus, $payload);
    }
}
