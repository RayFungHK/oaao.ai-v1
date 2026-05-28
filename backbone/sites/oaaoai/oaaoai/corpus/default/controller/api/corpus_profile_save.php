<?php

declare(strict_types=1);

use oaaoai\corpus\CorpusRepository;

/**
 * POST /corpus/api/corpus_profile_save — create or update profile.
 *
 * Body: { corpus_id?, name, description?, tags?, workspace_id? }
 */
return function (): void {
    require_once __DIR__ . '/_corpus_api_bootstrap.php';

    $ctx = oaao_corpus_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $scopeWid = oaao_corpus_resolve_workspace_scope(
        $this,
        $ctx,
        oaao_corpus_workspace_from_request($input),
    );
    if ($scopeWid === false) {
        return;
    }

    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Name required']);

        return;
    }
    if (mb_strlen($name) > 200) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Name too long']);

        return;
    }

    $description = isset($input['description']) ? trim((string) $input['description']) : null;
    if ($description === '') {
        $description = null;
    }

    $tags = null;
    if (isset($input['tags']) && \is_array($input['tags'])) {
        try {
            $tags = CorpusRepository::encodeTagsJson($input['tags']);
        } catch (\JsonException) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid tags']);

            return;
        }
    }

    $styleJson = null;
    if (array_key_exists('style_json', $input)) {
        if ($input['style_json'] === null) {
            $styleJson = null;
        } elseif (\is_array($input['style_json'])) {
            try {
                $styleJson = CorpusRepository::encodeStyleJson($input['style_json']);
            } catch (\JsonException) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'Invalid style_json']);

                return;
            }
        } else {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid style_json']);

            return;
        }
    }

    $repo = new CorpusRepository($ctx['db']);
    $corpusId = isset($input['corpus_id']) ? (int) $input['corpus_id'] : 0;
    $now = gmdate('Y-m-d H:i:s');

    try {
        if ($corpusId > 0) {
            $existing = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid);
            if ($existing === null) {
                http_response_code(404);
                echo json_encode(['success' => false, 'message' => 'Corpus not found']);

                return;
            }

            $fields = [
                'name'        => $name,
                'description' => $description,
                'updated_at'  => $now,
            ];
            if ($tags !== null) {
                $fields['tags_json'] = $tags;
            }
            if (array_key_exists('style_json', $input)) {
                $fields['style_json'] = $styleJson;
            }
            $repo->updateProfile($corpusId, $fields);
            $row = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid);
        } else {
            $corpusId = $repo->insertProfile([
                'tenant_id'    => $ctx['tenant_id'],
                'workspace_id' => $scopeWid,
                'name'         => $name,
                'description'  => $description,
                'tags_json'    => $tags,
                'style_json'   => null,
                'status'       => 'draft',
                'error_message'=> null,
                'created_by'   => $ctx['uid'],
                'created_at'   => $now,
                'updated_at'   => $now,
            ]);
            if ($corpusId < 1) {
                http_response_code(500);
                echo json_encode(['success' => false, 'message' => 'Could not create corpus']);

                return;
            }
            $row = $repo->getProfileInScope($corpusId, $ctx['tenant_id'], $ctx['uid'], $scopeWid);
        }

        if ($row === null) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not load corpus']);

            return;
        }

        echo json_encode([
            'success' => true,
            'data'    => [
                'profile' => CorpusRepository::profileForApi($row, $repo->countSources($corpusId)),
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        error_log('oaaoai/corpus corpus_profile_save: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not save corpus']);
    }
};
