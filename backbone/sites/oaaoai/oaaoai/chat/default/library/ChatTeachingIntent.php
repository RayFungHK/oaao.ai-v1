<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Detect handbook / vol teaching turns that should offer slide_designer (orchestrator inject mirrors this).
 */
final class ChatTeachingIntent
{
    public static function impliesSlideDesigner(string $userMessage): bool
    {
        $s = trim($userMessage);
        if ($s === '') {
            return false;
        }

        $low = mb_strtolower($s, 'UTF-8');
        $handbook = self::containsAny($low, ['handbook', '手冊', 'manual'])
            || self::containsAny($s, ['手冊']);
        $vol = self::containsAny($low, ['vol', 'volume', 'vol.', 'vol3', 'vol.3'])
            || preg_match('/第\s*[一二三四五六七八九十\d]+\s*[卷冊]/u', $s) === 1;
        $teaching = self::containsAny($low, ['教學', 'teaching', 'tutorial', '課程', 'lesson', 'curriculum'])
            || self::containsAny($s, ['教學', '教程']);
        $slides = self::containsAny($low, ['簡報', '投影片', 'slide', 'deck', 'presentation', 'ppt']);

        if ($slides && ($handbook || $teaching || $vol)) {
            return true;
        }

        return $teaching && ($handbook || $vol);
    }

    /**
     * User message targets a handbook / manual / named vault document — run vault RAG even without Auto Source toggle.
     */
    public static function impliesVaultGrounding(string $userMessage): bool
    {
        if (self::impliesSlideDesigner($userMessage)) {
            return true;
        }

        $s = trim($userMessage);
        if ($s === '') {
            return false;
        }

        $low = mb_strtolower($s, 'UTF-8');
        $handbook = self::containsAny($low, ['handbook', '手冊', 'manual'])
            || self::containsAny($s, ['手冊']);
        $vol = self::containsAny($low, ['vol', 'volume', 'vol.', 'vol3', 'vol.3'])
            || preg_match('/第\s*[一二三四五六七八九十\d]+\s*[卷冊]/u', $s) === 1;

        if ($handbook && $vol) {
            return true;
        }

        if (str_contains($low, 'regulatory handbook')) {
            return true;
        }

        if (self::impliesPersonalRecordVaultLookup($s, $low)) {
            return true;
        }

        return self::containsAny($low, ['知識庫', 'vault'])
            && ($handbook || self::containsAny($low, ['document', '文件', 'upload', '上傳']));
    }

    /**
     * User asks about prior notes / recordings in the knowledge base (e.g. wallet usage mp3).
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
     */
    public static function displayUserMessageForTemplate(string $content, string $templateId, string $label): string
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

    /**
     * Full instruction for orchestrator / planner only (not shown verbatim in the chat thread).
     */
    public static function enrichUserMessageForTemplate(string $content, string $templateId, string $label): string
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
        if (! self::impliesSlideDesigner($userMessage) && ! self::impliesSlideDesignerForTemplate($hasPublishedSlideTemplate)) {
            return $allowedAgents;
        }

        $kinds = PlannerAgentRegister::allKinds();
        if (! \in_array('slide_designer', $kinds, true)) {
            return $allowedAgents;
        }

        $out = $allowedAgents;
        if (! \in_array('slide_designer', $out, true)) {
            $out[] = 'slide_designer';
        }

        return array_values(array_unique($out));
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
