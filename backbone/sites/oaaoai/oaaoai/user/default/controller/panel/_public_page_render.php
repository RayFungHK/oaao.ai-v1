<?php

declare(strict_types=1);

/**
 * Render standalone public auth pages with oaao.css + JIT-ready markup.
 */
function oaao_user_render_public_page(\Razy\Controller $controller, string $tplName, string $tokenAttr, string $token): void
{
    $prefix = defined('RELATIVE_ROOT') ? rtrim((string) RELATIVE_ROOT, '/') : '';
    $assetPrefix = $prefix !== '' ? $prefix : '';
    $html = $controller->loadTemplate($tplName)->output();
    $safeToken = htmlspecialchars($token, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $safeMount = htmlspecialchars($prefix, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $html = str_replace('%%OAao_MOUNT_PREFIX%%', $safeMount, $html);
    $html = str_replace('%%OAao_ASSET_PREFIX%%', htmlspecialchars($assetPrefix, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'), $html);
    $html = str_replace('data-' . $tokenAttr . '=""', 'data-' . $tokenAttr . '="' . $safeToken . '"', $html);
    echo $html;
}
