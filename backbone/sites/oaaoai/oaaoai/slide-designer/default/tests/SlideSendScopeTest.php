<?php

declare(strict_types=1);

use oaaoai\slide_designer\SlideSendScope;
use PHPUnit\Framework\TestCase;

final class SlideSendScopeTest extends TestCase
{
    public function test_empty_template_id_is_not_published(): void
    {
        $out = SlideSendScope::resolvePublishedTemplate(null, '');
        self::assertFalse($out['hasPublished']);
        self::assertSame('', $out['label']);
    }
}
