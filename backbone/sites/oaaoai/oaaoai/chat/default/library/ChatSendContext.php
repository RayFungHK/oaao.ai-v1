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

    /** @var array<string, array<string, mixed>> */
    private array $payloadFragments = [];

    /**
     * @param array<string, mixed> $input Decoded POST body
     */
    public function __construct(
        public readonly int $userId,
        public readonly ?int $workspaceId,
        public readonly array $input,
        public readonly int $chatEndpointId = 0,
        public readonly bool $isBubbleChat = false,
        public readonly bool $appendAssistantTurn = false,
        public readonly ?int $conversationId = null,
    ) {
        $this->slideTemplateId = self::parseSlideTemplateId($input);
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

    public string $slideTemplateId = '';

    public bool $hasPublishedSlideTemplate = false;

    public string $slideTemplateLabel = '';

    public string $content = '';

    public string $orchestratorUserContent = '';

    /** @var array<string, mixed>|null */
    public ?array $binding = null;

    public string $internalBase = '';

    public bool $orchReady = false;

    /** @var array<string, mixed>|null */
    public ?array $paramsDec = null;

    /** @var list<array<string, mixed>> */
    public array $attachmentRows = [];

    public ?string $conversationTitleOut = null;

    /** @var array<string, mixed> */
    public array $userMetaArr = [];

    /** @var array<string, int|float> */
    public array $inferenceApplied = [];

    /** @var array<string, mixed> */
    public array $inferenceSnapshot = [
        'mode'           => ChatInferenceControl::MODE_OFF,
        'params_applied' => [],
        'source'         => 'endpoint_defaults',
    ];

    /**
     * @param array<string, mixed> $input
     */
    public static function parseSlideTemplateId(array $input): string
    {
        return trim((string) ($input['slide_template_id'] ?? ''));
    }

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
     * @param array<string, mixed> $fragment
     */
    public function mergePayloadFragment(string $moduleApiName, array $fragment): void
    {
        if ($fragment === []) {
            return;
        }
        $k = strtolower(trim($moduleApiName));
        if ($k === '') {
            return;
        }
        $existing = $this->payloadFragments[$k] ?? [];
        $this->payloadFragments[$k] = array_merge($existing, $fragment);
    }

    /**
     * @return array<string, mixed>
     */
    public function mergedPayloadFragments(): array
    {
        $out = [];
        foreach ($this->payloadFragments as $fragment) {
            $out = array_merge($out, $fragment);
        }

        return $out;
    }

    /**
     * @return array<string, mixed>
     */
    public function drainPayloadFragments(): array
    {
        $out = $this->mergedPayloadFragments();
        $this->payloadFragments = [];

        return $out;
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function abort(int $httpStatus, array $payload): never
    {
        throw new ChatSendAbort($httpStatus, $payload);
    }
}
