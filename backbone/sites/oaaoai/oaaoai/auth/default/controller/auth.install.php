<?php

/**
 * GET /install — First-time setup page.
 * Returns a simple JSON response indicating install is needed.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode([
        'success' => true,
        'message' => 'Installation required',
        'installed' => false,
    ]);
};
