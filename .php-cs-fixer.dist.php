<?php

declare(strict_types=1);

/**
 * W2-S2 — Baseline PHP coding style gate for the oaao.ai-v1 backbone.
 *
 * Phase 1 (this commit): conservative PSR-12-aligned ruleset, ADVISORY in CI
 * (continue-on-error). Establish baseline; let teams clean files opportunistically.
 *
 * Phase 2 (later sprint): flip CI to hard-fail after baseline is clean. Add
 * stricter rules (strict_types declaration on new files, ordered_imports, etc.).
 */

$finder = (new PhpCsFixer\Finder())
    ->in(__DIR__ . '/backbone/sites/oaaoai/oaaoai')
    // Razy generates / vendors these — skip.
    ->exclude(['vendor', 'cache', 'tmp', 'webassets/dist'])
    ->notPath('#/data/#')
    ->notName('*.tpl')
    ->notName('*.blade.php');

return (new PhpCsFixer\Config())
    ->setRiskyAllowed(false)
    ->setRules([
        '@PSR12' => true,
        // Conservative additions — high-signal, low-churn.
        'array_syntax' => ['syntax' => 'short'],
        'no_unused_imports' => true,
        'no_trailing_whitespace' => true,
        'no_trailing_whitespace_in_comment' => true,
        'single_blank_line_at_eof' => true,
        'no_whitespace_in_blank_line' => true,
        'trailing_comma_in_multiline' => ['elements' => ['arrays']],
        'whitespace_after_comma_in_array' => true,
        'binary_operator_spaces' => ['default' => 'single_space'],
    ])
    ->setFinder($finder)
    ->setCacheFile(__DIR__ . '/.php-cs-fixer.cache');
