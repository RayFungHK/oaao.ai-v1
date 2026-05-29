<?php

declare(strict_types=1);

use oaaoai\user\UserFeedbackModelTune;
use oaaoai\user\UserModelParams;
use PHPUnit\Framework\TestCase;

/**
 * UX-1-S10 — downvote bounded param adjustment.
 */
final class UserFeedbackModelTuneTest extends TestCase
{
    public function test_downvote_lowers_temperature_and_raises_penalties(): void
    {
        $before = UserModelParams::normalize([
            'temperature'       => 0.8,
            'top_p'             => 0.95,
            'presence_penalty'  => 0.0,
            'frequency_penalty' => 0.0,
        ]);
        $after = UserFeedbackModelTune::applyDownvote($before);

        self::assertNotNull($after['temperature']);
        self::assertLessThan(0.8, (float) $after['temperature']);
        self::assertNotNull($after['top_p']);
        self::assertLessThan(0.95, (float) $after['top_p']);
        self::assertGreaterThan(0.0, (float) ($after['presence_penalty'] ?? 0));
    }

    public function test_record_downvote_appends_audit(): void
    {
        $result = UserFeedbackModelTune::recordDownvote([], 42, 7, UserModelParams::defaults());
        $prefs = $result['preferences'];
        self::assertIsArray($prefs[UserFeedbackModelTune::AUDIT_KEY] ?? null);
        self::assertSame('down', $prefs[UserFeedbackModelTune::AUDIT_KEY][0]['vote'] ?? '');
        self::assertSame(42, (int) ($prefs[UserFeedbackModelTune::AUDIT_KEY][0]['message_id'] ?? 0));
    }
}
