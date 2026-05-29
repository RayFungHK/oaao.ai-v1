<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

use oaaoai\chat\ChatSendContext;

/**
 * Published slide template slug — thread display vs orchestrator enrichment ({@code chat.send.message}).
 */
final class SlideSendTemplateSlug
{
    public static function apply(ChatSendContext $ctx): void
    {
        if (! $ctx->hasPublishedSlideTemplate) {
            return;
        }

        $ctx->orchestratorUserContent = self::enrichOrchestratorMessage(
            $ctx->content,
            $ctx->slideTemplateId,
            $ctx->slideTemplateLabel,
        );
        $ctx->content = self::displayThreadMessage(
            $ctx->content,
            $ctx->slideTemplateId,
            $ctx->slideTemplateLabel,
        );
    }

    /** Text stored on the user message row — template shown via meta_json + UI pill. */
    public static function displayThreadMessage(string $content, string $templateId, string $label): string
    {
        $tid = trim($templateId);
        if ($tid === '') {
            return trim($content);
        }
        $lab = trim($label) !== '' ? trim($label) : $tid;
        $c = self::stripTemplateMetaSuffix(trim($content));
        if (self::isVagueTemplateComposerText($c, $lab)) {
            return '';
        }

        return $c;
    }

    /** Full instruction for orchestrator / planner only. */
    public static function enrichOrchestratorMessage(string $content, string $templateId, string $label): string
    {
        $tid = trim($templateId);
        if ($tid === '') {
            return trim($content);
        }
        $lab = trim($label) !== '' ? trim($label) : $tid;
        $c = self::stripTemplateMetaSuffix(trim($content));

        if (self::isVagueTemplateComposerText($c, $lab)) {
            return sprintf(
                'Create a slide presentation using the published slide template "%s" (template_id: %s). '
                . 'Apply its layout, typography, colors, and slide masters.',
                $lab,
                $tid,
            );
        }

        return $c . sprintf(
            "\n\n[Use published slide template: %s (template_id: %s).]",
            $lab,
            $tid,
        );
    }

    public static function stripTemplateMetaSuffix(string $content): string
    {
        $c = trim($content);
        if ($c === '') {
            return '';
        }

        $c = trim((string) preg_replace(
            '/\n\n\[Use published slide template:[^\]]+\]\.?\s*$/u',
            '',
            $c,
        ));

        return trim((string) preg_replace(
            '/\s*Create a slide presentation using the published slide template "[^"]+" '
            . '\(template_id:\s*[^)]+\)\.?\s*/iu',
            '',
            $c,
        ));
    }

    private static function isVagueTemplateComposerText(string $content, string $label): bool
    {
        $c = trim($content);
        if ($c === '') {
            return true;
        }
        $low = mb_strtolower($c, 'UTF-8');
        $labLow = mb_strtolower(trim($label), 'UTF-8');

        return preg_match('/^use\s+(this\s+)?template\.?$/iu', $c) === 1
            || preg_match('/^使用(此|這)?模板\.?$/u', $c) === 1
            || ($labLow !== '' && $low === $labLow)
            || preg_match(
                '/^create a slide presentation using (my selected|the published slide) template\.?$/i',
                $c,
            ) === 1
            || preg_match(
                '/^create a slide presentation using the published slide template "/i',
                $c,
            ) === 1;
    }
}
