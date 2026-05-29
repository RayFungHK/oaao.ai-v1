<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

/**
 * Slide template resolution for chat send composer ({@code slide_template_id}).
 */
final class SlideSendScope
{
    /**
     * @param object|null $slideDesignerApi {@see \\Module\\oaao\\slide_designer} API / controller with {@code resolvePublishedTemplate}
     * @return array{hasPublished: bool, label: string}
     */
    public static function resolvePublishedTemplate(?object $slideDesignerApi, string $templateId): array
    {
        $templateId = trim($templateId);
        if ($templateId === '') {
            return ['hasPublished' => false, 'label' => ''];
        }
        if ($slideDesignerApi === null || ! method_exists($slideDesignerApi, 'resolvePublishedTemplate')) {
            return ['hasPublished' => false, 'label' => ''];
        }

        $tplRow = $slideDesignerApi->resolvePublishedTemplate($templateId);
        if ($tplRow === null || ! \is_array($tplRow)) {
            return ['hasPublished' => false, 'label' => ''];
        }

        $label = trim((string) ($tplRow['label'] ?? ''));
        if ($label === '') {
            $label = $templateId;
        }

        return ['hasPublished' => true, 'label' => $label];
    }
}
