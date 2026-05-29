<?php

declare(strict_types=1);

namespace oaaoai\user;

/**
 * UX-1-S5 — preference_tags + hidden style instruction under preferences_json.
 */
final class UserPreferenceProfile
{
    /** @var array<string, string> */
    private const TAG_ZH = [
        'q1_concise'        => '#簡潔',
        'q1_balanced'       => '#適中篇幅',
        'q1_detailed'       => '#較詳盡',
        'q1_very_detailed'  => '#深入說明',
        'q2_factual'        => '#事實導向',
        'q2_balanced'       => '#平衡語氣',
        'q2_creative'       => '#創意表達',
        'q2_playful'        => '#活潑語氣',
        'q3_steady'         => '#穩定用詞',
        'q3_mixed'          => '#適度變化',
        'q3_varied'         => '#多樣表達',
        'q4_brief'          => '#點到為止',
        'q4_balanced'       => '#適度延伸',
        'q4_thorough'       => '#主動展開',
        'q5_steady'         => '#穩健風格',
        'q5_expressive'     => '#熱情表達',
    ];

    /** @return array{tags: list<string>, summary: string, instruction: string} */
    public static function fromGuidedAnswers(array $answers, string $locale = 'en'): array
    {
        $zh = self::localeIsZh($locale);
        /** @var list<string> $tags */
        $tags = [];
        $seen = [];
        foreach ($answers as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $oid = trim((string) ($row['id'] ?? ''));
            if ($oid === '') {
                continue;
            }
            $tag = self::TAG_ZH[$oid] ?? null;
            if ($tag === null || isset($seen[$tag])) {
                continue;
            }
            $seen[$tag] = true;
            $tags[] = $tag;
        }

        return self::fromTags($tags, $zh);
    }

    /**
     * @param list<string> $tags
     *
     * @return array{tags: list<string>, summary: string, instruction: string}
     */
    public static function fromTags(array $tags, bool $zh = true): array
    {
        $clean = [];
        foreach ($tags as $t) {
            $s = trim((string) $t);
            if ($s === '') {
                continue;
            }
            if ($s[0] !== '#') {
                $s = '#' . $s;
            }
            $clean[] = $s;
        }
        $clean = array_values(array_unique($clean));

        $lines = [];
        foreach ($clean as $tag) {
            $line = self::instructionForTag($tag, $zh);
            if ($line !== '') {
                $lines[] = $line;
            }
        }

        if ($zh) {
            $instruction = $lines === []
                ? ''
                : "依使用者調校問卷所選風格回覆：\n" . implode("\n", array_map(static fn (string $l): string => '- ' . $l, $lines));
            $summary = $clean === []
                ? ''
                : implode(' · ', array_map(static fn (string $t): string => ltrim($t, '#'), $clean));
        } else {
            $instruction = $lines === []
                ? ''
                : "Follow the user's style survey choices:\n" . implode("\n", array_map(static fn (string $l): string => '- ' . $l, $lines));
            $summary = $clean === []
                ? ''
                : implode(' · ', array_map(static fn (string $t): string => ltrim($t, '#'), $clean));
        }

        return [
            'tags'        => $clean,
            'summary'     => $summary,
            'instruction' => $instruction,
        ];
    }

    /**
     * @param array<string, mixed>|null $prefs
     *
     * @return array{tags: list<string>, summary: string, instruction: string}
     */
    public static function fromPreferences(?array $prefs): array
    {
        if ($prefs === null) {
            return ['tags' => [], 'summary' => '', 'instruction' => ''];
        }
        $tags = $prefs['preference_tags'] ?? [];
        if (! \is_array($tags)) {
            $tags = [];
        }

        return [
            'tags'        => array_values(array_filter(array_map('strval', $tags))),
            'summary'     => trim((string) ($prefs['preference_tags_summary'] ?? '')),
            'instruction' => trim((string) ($prefs['preference_system_instruction'] ?? '')),
        ];
    }

    /**
     * @param array<string, mixed> $prefs
     * @param array{tags?: list<string>, summary?: string, instruction?: string} $profile
     *
     * @return array<string, mixed>
     */
    public static function mergeIntoPreferences(array $prefs, array $profile): array
    {
        if (isset($profile['tags']) && \is_array($profile['tags'])) {
            $built = self::fromTags($profile['tags'], true);
            $prefs['preference_tags'] = $built['tags'];
            $prefs['preference_tags_summary'] = $profile['summary'] ?? $built['summary'];
            $prefs['preference_system_instruction'] = $profile['instruction'] ?? $built['instruction'];
        } else {
            if (isset($profile['summary'])) {
                $prefs['preference_tags_summary'] = trim((string) $profile['summary']);
            }
            if (isset($profile['instruction'])) {
                $prefs['preference_system_instruction'] = trim((string) $profile['instruction']);
            }
        }

        return $prefs;
    }

    /**
     * Merged into user_personalization orchestrator payload (instruction hidden from Settings body).
     *
     * @param array<string, mixed> $prefs
     *
     * @return array<string, mixed>
     */
    public static function forOrchestratorPayload(array $prefs): array
    {
        $block = self::fromPreferences($prefs);
        $out = [];
        if ($block['tags'] !== []) {
            $out['preference_tags'] = $block['tags'];
        }
        if ($block['summary'] !== '') {
            $out['preference_tags_summary'] = $block['summary'];
        }
        if ($block['instruction'] !== '') {
            $out['preference_style_instruction'] = $block['instruction'];
        }

        return $out;
    }

    public static function loadBlockForUser(\PDO $pdo, int $userId): array
    {
        if ($userId < 1) {
            return self::fromPreferences(null);
        }
        $stmt = $pdo->prepare('SELECT preferences_json FROM oaao_user WHERE user_id = ? LIMIT 1');
        $stmt->execute([$userId]);
        $raw = $stmt->fetchColumn();
        if (! \is_string($raw) || $raw === '') {
            return self::fromPreferences(null);
        }
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return self::fromPreferences(null);
        }

        return self::fromPreferences(\is_array($decoded) ? $decoded : null);
    }

    private static function localeIsZh(string $locale): bool
    {
        $lo = strtolower(trim($locale));

        return str_starts_with($lo, 'zh') || str_contains($lo, 'hant') || str_contains($lo, 'hk');
    }

    private static function instructionForTag(string $tag, bool $zh): string
    {
        $map = $zh ? [
            '#簡潔'     => '回覆保持簡短，先給結論與要點，避免冗長鋪陳。',
            '#適中篇幅' => '篇幅適中，有重點也有必要細節，避免過短或過長。',
            '#較詳盡'   => '在需要時補充步驟、理由與例子，但仍保持結構清楚。',
            '#深入說明' => '願意深入解釋背景、步驟與取捨，協助使用者真正理解。',
            '#事實導向' => '以可查證事實、步驟與結論為主，少花俏修辭。',
            '#平衡語氣' => '語氣清楚務實，帶一點溫度但不誇張。',
            '#創意表達' => '可提出新角度與可行想法，適合腦力激盪。',
            '#活潑語氣' => '合適時語氣輕鬆、有熱情，但仍尊重情境。',
            '#穩定用詞' => '用詞與結構保持一致，減少隨機換說法。',
            '#適度變化' => '大致一致，偶爾換句話說以避免呆板。',
            '#多樣表達' => '用詞與句式可明顯變化，避免每次套同一句型。',
            '#點到為止' => '跟進與補充保持簡短，不主動延伸過多。',
            '#適度延伸' => '有幫助時才適度延伸，不囉嗦。',
            '#主動展開' => '願意主動補充細節、風險與下一步。',
            '#穩健風格' => '整體沉穩、一致、以事實與步驟為主。',
            '#熱情表達' => '整體熱情、有互動感，適合討論與發想。',
        ] : [];

        return $map[$tag] ?? '';
    }
}
