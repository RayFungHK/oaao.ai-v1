<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Chat send-time helpers for slide templates and vault scope expansion.
 *
 * CS-AUDIT-4: Slide agent gating and vault scope use **data-driven** paths only.
 * Orchestrator planner owns {@code slide_action} / agent plan (see {@code planner_llm.py});
 * do not add English/Chinese keyword lists here.
 */
final class ChatTeachingIntent
{
    /**
     * @deprecated Use published template chip ({@see impliesSlideDesignerForTemplate}) only.
     * Planner injects slide_designer from {@code slide_action} + teaching context.
     */
    public static function impliesSlideDesigner(string $userMessage): bool
    {
        return false;
    }

    /**
     * @deprecated Replaced by composer filename match + vault_auto_rag in {@see send.php}.
     */
    public static function impliesVaultGrounding(string $userMessage): bool
    {
        return false;
    }

    /**
     * Whether to run {@see ChatVaultScope::composerRefsMatchingMessage} for this turn.
     */
    public static function shouldTryComposerVaultMatch(
        bool $vaultAutoRag,
        bool $hasExplicitVaultRefs,
        string $userMessage,
    ): bool {
        if ($vaultAutoRag || $hasExplicitVaultRefs) {
            return true;
        }

        return trim($userMessage) !== '';
    }

    /**
     * Expand vault composer scope when auto-RAG, explicit refs, composer doc match, or record lookup.
     */
    public static function shouldExpandVaultComposerScope(
        bool $vaultAutoRag,
        bool $hasExplicitVaultRefs,
        bool $composerRefsMatched,
        string $userMessage,
    ): bool {
        if ($vaultAutoRag || $hasExplicitVaultRefs || $composerRefsMatched) {
            return true;
        }

        return self::impliesPersonalRecordVaultLookup($userMessage);
    }

    /**
     * User asks about prior notes / recordings in the knowledge base (e.g. wallet usage mp3).
     * Filename scoring in {@see ChatVaultScope::embeddedAudioRefsForRecordLookup} uses these cues only.
     */
    public static function impliesPersonalRecordVaultLookup(string $message, ?string $low = null): bool
    {
        $s = trim($message);
        if ($s === '') {
            return false;
        }
        $low ??= mb_strtolower($s, 'UTF-8');
        $recordCues = ['記錄', '錄音', '錄製', '檔案', '文件', '筆記', 'mp3', 'audio', 'wav'];
        $lookupCues = ['之前', '先前', '以前', '用法', '怎麼', '如何', '有沒有', '有没有', '搜', '找', '查'];
        $hasRecord = self::containsAny($s, $recordCues) || self::containsAny($low, ['recorded', 'archive', 'stored'])
            || str_contains($s, '之前有');
        $hasLookup = self::containsAny($s, $lookupCues) || str_contains($s, '?') || str_contains($s, '？');
        if ((str_contains($s, '錢包') || str_contains($low, 'wallet'))
            && ($hasRecord || str_contains($s, '之前') || str_contains($s, '用法'))) {
            return true;
        }

        return $hasRecord && $hasLookup;
    }

    /**
     * User chose a published slide template in Chat ({@code slide_template_id} on send).
     */
    public static function impliesSlideDesignerForTemplate(bool $hasPublishedSlideTemplate): bool
    {
        return $hasPublishedSlideTemplate;
    }

    /**
     * Text stored on the user message row — template is shown via {@code meta_json} + UI pill, not bracket prose.
     *
     * @deprecated Use {@see \oaaoai\slide_designer\SlideSendTemplateSlug::displayThreadMessage}
     */
    public static function displayUserMessageForTemplate(string $content, string $templateId, string $label): string
    {
        return \oaaoai\slide_designer\SlideSendTemplateSlug::displayThreadMessage($content, $templateId, $label);
    }

    /**
     * Full instruction for orchestrator / planner only (not shown verbatim in the chat thread).
     *
     * @deprecated Use {@see \oaaoai\slide_designer\SlideSendTemplateSlug::enrichOrchestratorMessage}
     */
    public static function enrichUserMessageForTemplate(string $content, string $templateId, string $label): string
    {
        return \oaaoai\slide_designer\SlideSendTemplateSlug::enrichOrchestratorMessage($content, $templateId, $label);
    }

    /** @deprecated Use {@see \oaaoai\slide_designer\SlideSendTemplateSlug::stripTemplateMetaSuffix} */
    public static function stripTemplateMetaSuffix(string $content): string
    {
        return \oaaoai\slide_designer\SlideSendTemplateSlug::stripTemplateMetaSuffix($content);
    }

    /**
     * @param list<string> $allowedAgents
     *
     * @return list<string>
     */
    public static function ensureSlideDesignerAllowed(
        array $allowedAgents,
        string $userMessage,
        bool $hasPublishedSlideTemplate = false,
    ): array {
        $kinds = PlannerAgentRegister::allKinds();
        if (! \in_array('slide_designer', $kinds, true)) {
            return $allowedAgents;
        }

        $needsSlide = self::impliesSlideDesignerForTemplate($hasPublishedSlideTemplate)
            || self::userMessageImpliesSlideDesigner($userMessage);

        if (! $needsSlide) {
            return $allowedAgents;
        }

        $out = $allowedAgents;
        if (! \in_array('slide_designer', $out, true)) {
            $out[] = 'slide_designer';
        }

        return array_values(array_unique($out));
    }

    private static function userMessageImpliesSlideDesigner(string $userMessage): bool
    {
        $s = trim($userMessage);
        if ($s === '') {
            return false;
        }

        return preg_match('/簡報|投影片|\bslide\b|\bdeck\b|presentation|\bppt\b/iu', $s) === 1;
    }

    /**
     * @param list<string> $haystack
     */
    private static function containsAny(string $text, array $haystack): bool
    {
        foreach ($haystack as $needle) {
            if ($needle !== '' && str_contains($text, $needle)) {
                return true;
            }
        }

        return false;
    }
}
