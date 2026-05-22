<?php

declare(strict_types=1);

namespace oaaoai\vault;

/**
 * Output language options for transcript AI summaries ({@see document_transcript_summary.php}).
 */
final class VaultTranscriptSummaryLanguages
{
    public const DEFAULT_CODE = 'auto';

    /** @var list<string> */
    private const ALLOWED = ['auto', 'en', 'zh-Hant', 'zh-Hans', 'ja', 'ko', 'yue'];

    /**
     * @return list<array{id: string, label: string}>
     */
    public static function listForApi(): array
    {
        return [
            ['id' => 'auto', 'label' => 'Auto (match transcript)'],
            ['id' => 'en', 'label' => 'English'],
            ['id' => 'zh-Hant', 'label' => '繁體中文'],
            ['id' => 'zh-Hans', 'label' => '简体中文'],
            ['id' => 'ja', 'label' => '日本語'],
            ['id' => 'ko', 'label' => '한국어'],
            ['id' => 'yue', 'label' => '粵語'],
        ];
    }

    public static function normalize(string $raw): string
    {
        $code = trim($raw);
        if ($code === '') {
            return self::DEFAULT_CODE;
        }

        $lower = strtolower($code);
        if ($lower === 'auto' || $lower === 'default') {
            return 'auto';
        }
        if ($lower === 'en' || str_starts_with($lower, 'en-')) {
            return 'en';
        }
        if ($lower === 'zh-hant' || $lower === 'zh-tw' || $lower === 'zh-hk') {
            return 'zh-Hant';
        }
        if ($lower === 'zh-hans' || $lower === 'zh-cn' || $lower === 'zh') {
            return 'zh-Hans';
        }
        if ($lower === 'ja' || str_starts_with($lower, 'ja-')) {
            return 'ja';
        }
        if ($lower === 'ko' || str_starts_with($lower, 'ko-')) {
            return 'ko';
        }
        if ($lower === 'yue' || $lower === 'zh-yue') {
            return 'yue';
        }

        return \in_array($code, self::ALLOWED, true) ? $code : self::DEFAULT_CODE;
    }

    public static function promptSuffix(string $code): string
    {
        return match (self::normalize($code)) {
            'en'      => 'Write the entire summary in English.',
            'zh-Hant' => 'Write the entire summary in Traditional Chinese (繁體中文).',
            'zh-Hans' => 'Write the entire summary in Simplified Chinese (简体中文).',
            'ja'      => 'Write the entire summary in Japanese.',
            'ko'      => 'Write the entire summary in Korean.',
            'yue'     => 'Write the entire summary in Cantonese (粵語, traditional characters).',
            default   => 'Use the same language as the transcript unless the transcript is mixed; then prefer the dominant language.',
        };
    }
}
