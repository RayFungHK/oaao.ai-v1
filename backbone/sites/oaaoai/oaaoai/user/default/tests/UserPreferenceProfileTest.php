<?php

declare(strict_types=1);

use oaaoai\user\UserPreferenceProfile;
use PHPUnit\Framework\TestCase;

/**
 * UX-1-S12 — PHP parity with {@see python/tests/test_preference_profile.py}.
 */
final class UserPreferenceProfileTest extends TestCase
{
    public function test_derive_preference_profile_zh_guided_answers(): void
    {
        $answers = [
            ['id' => 'q1_concise', 'step_index' => 0],
            ['id' => 'q2_factual', 'step_index' => 1],
            ['id' => 'q5_steady', 'step_index' => 4],
        ];
        $prof = UserPreferenceProfile::fromGuidedAnswers($answers, 'zh-Hant');

        self::assertContains('#簡潔', $prof['tags']);
        self::assertNotSame('', $prof['instruction']);
        self::assertStringContainsString('簡潔', $prof['summary']);
    }

    public function test_for_orchestrator_payload_includes_style_instruction(): void
    {
        $prefs = UserPreferenceProfile::mergeIntoPreferences([], [
            'tags'        => ['#簡潔'],
            'instruction' => 'Keep replies concise.',
        ]);
        $out = UserPreferenceProfile::forOrchestratorPayload($prefs);
        self::assertContains('#簡潔', $out['preference_tags'] ?? []);
        self::assertStringContainsString('concise', (string) ($out['preference_style_instruction'] ?? ''));
    }
}
