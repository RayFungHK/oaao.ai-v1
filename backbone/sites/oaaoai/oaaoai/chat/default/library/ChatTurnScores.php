<?php

declare(strict_types=1);

namespace oaaoai\chat;

use Razy\Database;

/**
 * Turn score rows for thread UI — shared by {@code turn_scores} and {@code info_worker} APIs.
 */
final class ChatTurnScores
{
    /**
     * @param list<array{id: int, role: string, content: string, meta: array<string, mixed>|null}> $messages
     * @param array<int, array<string, mixed>> $scoreByTurn
     * @return array{0: list<array<string, mixed>>, 1: int}
     */
    public static function buildScoreRows(array $messages, array $scoreByTurn): array
    {
        /** @var array<int, int> $turnIndexToMessageId */
        $turnIndexToMessageId = [];
        $turn = 0;
        foreach ($messages as $row) {
            if (($row['role'] ?? '') !== 'assistant') {
                continue;
            }
            $turn += 1;
            $turnIndexToMessageId[$turn] = (int) $row['id'];
        }

        $scores = [];
        $rescorePending = 0;
        foreach ($turnIndexToMessageId as $ti => $mid) {
            $stored = $scoreByTurn[$ti] ?? null;
            $iqs = \is_array($stored) ? (float) ($stored['iqs'] ?? 0) : 0.0;
            $accs = \is_array($stored) ? (float) ($stored['accs'] ?? 0) : 0.0;
            $iqsDimsRaw = \is_array($stored) ? ($stored['iqs_dims_json'] ?? '{}') : '{}';
            $accsDimsRaw = \is_array($stored) ? ($stored['accs_dims_json'] ?? '{}') : '{}';
            $iqsReasonsRaw = \is_array($stored) ? ($stored['iqs_reasons_json'] ?? null) : null;
            $accsReasonsRaw = \is_array($stored) ? ($stored['accs_reasons_json'] ?? null) : null;
            $iqsDims = json_decode(\is_string($iqsDimsRaw) ? $iqsDimsRaw : '{}', true);
            $accsDims = json_decode(\is_string($accsDimsRaw) ? $accsDimsRaw : '{}', true);
            $iqsDims = TurnScorerVersion::normalizeScoreDims(\is_array($iqsDims) ? $iqsDims : []);
            $accsDims = TurnScorerVersion::normalizeScoreDims(\is_array($accsDims) ? $accsDims : []);
            $iqsReasons = $iqsReasonsRaw !== null && $iqsReasonsRaw !== ''
                ? (json_decode((string) $iqsReasonsRaw, true) ?: [])
                : [];
            $iqsReasons = \is_array($iqsReasons) ? $iqsReasons : [];
            $accsReasons = $accsReasonsRaw !== null && $accsReasonsRaw !== ''
                ? (json_decode((string) $accsReasonsRaw, true) ?: [])
                : [];
            $accsReasons = \is_array($accsReasons) ? $accsReasons : [];
            $storedVersion = \is_array($stored) ? (string) ($stored['scorer_version'] ?? '') : '';
            $iqsAction = '';
            if (isset($iqsReasons['action']) && \is_string($iqsReasons['action'])) {
                $iqsAction = $iqsReasons['action'];
            }
            [$storedIqsVer, $storedAccsVer] = TurnScorerVersion::parseStored($storedVersion);
            $needsIqs = TurnScorerVersion::needsIqsRescore($storedVersion, $iqs, $iqsDims);
            $needsAccs = TurnScorerVersion::needsAccsRescore($storedVersion, $accs, $accsDims, $iqsAction);
            if ($needsIqs || $needsAccs) {
                $rescorePending += 1;
            }
            $scores[] = [
                'turn_index'           => $ti,
                'assistant_message_id' => $mid,
                'iqs'                  => $iqs,
                'accs'                 => $accs,
                'iqs_dims'             => $iqsDims,
                'accs_dims'            => $accsDims,
                'iqs_reasons'          => $iqsReasons,
                'accs_reasons'         => $accsReasons,
                'scorer_version'       => $storedVersion,
                'iqs_version'          => $storedIqsVer !== '' ? $storedIqsVer : null,
                'accs_version'         => $storedAccsVer !== '' ? $storedAccsVer : null,
                'needs_iqs_rescore'    => $needsIqs,
                'needs_accs_rescore'   => $needsAccs,
                'scored_at'            => \is_array($stored) ? (float) ($stored['scored_at'] ?? 0) : 0,
                'complete'             => \is_array($stored) ? (int) ($stored['complete'] ?? 1) : 0,
                'topic_shift'          => \is_array($stored) ? (int) ($stored['topic_shift'] ?? 0) : 0,
            ];
        }

        return [$scores, $rescorePending];
    }

    /**
     * @return array{
     *   messages: list<array{id: int, role: string, content: string, meta: array<string, mixed>|null}>,
     *   score_by_turn: array<int, array<string, mixed>>,
     *   scores: list<array<string, mixed>>,
     *   rescore_pending: int
     * }
     */
    public static function loadForConversation(Database $splitDb, Database $canonDb, int $conversationId): array
    {
        $rawMessages = $splitDb->prepare()
            ->select('id, role, content, meta_json')
            ->from('message')
            ->where('conversation_id=?')
            ->assign(['conversation_id' => $conversationId])
            ->order('+id')
            ->limit(500)
            ->query()
            ->fetchAll();

        /** @var list<array{id: int, role: string, content: string, meta: array<string, mixed>|null}> $messages */
        $messages = [];
        if (\is_array($rawMessages)) {
            foreach ($rawMessages as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $mid = (int) ($row['id'] ?? 0);
                if ($mid < 1) {
                    continue;
                }
                $meta = null;
                $mj = $row['meta_json'] ?? null;
                if (\is_string($mj) && $mj !== '') {
                    $decoded = json_decode($mj, true);
                    $meta = \is_array($decoded) ? $decoded : null;
                }
                $messages[] = [
                    'id'      => $mid,
                    'role'    => strtolower(trim((string) ($row['role'] ?? ''))),
                    'content' => (string) ($row['content'] ?? ''),
                    'meta'    => $meta,
                ];
            }
        }

        /** @var array<int, array<string, mixed>> $scoreByTurn */
        $scoreByTurn = [];
        $rawScores = $canonDb->prepare()
            ->select(
                'turn_index, iqs, accs, iqs_dims_json, accs_dims_json, iqs_reasons_json, accs_reasons_json, scorer_version, scored_at, complete, topic_shift'
            )
            ->from('turn_score')
            ->where('conversation_id=?')
            ->assign(['conversation_id' => $conversationId])
            ->order('+turn_index')
            ->limit(500)
            ->query()
            ->fetchAll();

        if (\is_array($rawScores)) {
            foreach ($rawScores as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $ti = (int) ($row['turn_index'] ?? 0);
                if ($ti > 0) {
                    $scoreByTurn[$ti] = $row;
                }
            }
        }

        [$scores, $rescorePending] = self::buildScoreRows($messages, $scoreByTurn);

        return [
            'messages'        => $messages,
            'score_by_turn'   => $scoreByTurn,
            'scores'          => $scores,
            'rescore_pending' => $rescorePending,
        ];
    }
}
