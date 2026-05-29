<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Endpoints-owned orchestrator payload fragments for chat send (embedding, planner, MM, …).
 */
final class EndpointsSendOrchestratorPayload
{
    /**
     * @param list<array{kind: string, id: int, vault_id: int, name: string}> $vaultSourceRefs
     * @param list<int> $vaultSourceIds
     * @return array<string, mixed>
     */
    public static function buildFragment(
        object $endpointsApi,
        bool $vaultAutoRag,
        array $vaultSourceRefs,
        array $vaultSourceIds,
    ): array {
        if (method_exists($endpointsApi, 'ensureFeatureRegistries')) {
            $endpointsApi->ensureFeatureRegistries();
        }

        $fragment = [];

        $emb = $endpointsApi->resolveOrchestratorEmbeddingPayload();
        if ($emb !== null) {
            $fragment['embedding'] = $emb;
        }
        if (method_exists($endpointsApi, 'resolveOrchestratorRerankPayload')) {
            $rerank = $endpointsApi->resolveOrchestratorRerankPayload();
            if ($rerank !== null) {
                $fragment['rerank'] = $rerank;
            }
        }
        $rag = $endpointsApi->resolveOrchestratorVaultRagConfig();
        if ($rag !== []) {
            $fragment['vault_rag'] = $rag;
        }
        $runPlannerMode = $endpointsApi->resolveRunPlannerMode();
        if ($vaultAutoRag && $vaultSourceRefs === [] && $vaultSourceIds === []) {
            $runPlannerMode = ChatRunPlannerPurposeConfig::MODE_LLM;
        }
        $fragment['run_planner_mode'] = $runPlannerMode;

        $asr = $endpointsApi->resolveOrchestratorAsrPayload();
        if ($asr !== null) {
            $fragment['asr'] = $asr;
        }
        if (method_exists($endpointsApi, 'resolveOrchestratorPolishPayload')) {
            $polish = $endpointsApi->resolveOrchestratorPolishPayload();
            if ($polish !== null) {
                $fragment['polish'] = $polish;
            }
        }
        if (method_exists($endpointsApi, 'resolveOrchestratorUiqePayload')) {
            $uiqe = $endpointsApi->resolveOrchestratorUiqePayload();
            if ($uiqe !== null) {
                $fragment['uiqe'] = $uiqe;
            }
        }
        if (method_exists($endpointsApi, 'resolveOrchestratorPlannerPayload')) {
            $planner = $endpointsApi->resolveOrchestratorPlannerPayload();
            if ($planner !== null) {
                $fragment['planner'] = $planner;
            }
        }
        if (method_exists($endpointsApi, 'resolveOrchestratorPlannerIntentPayload')) {
            $plannerIntent = $endpointsApi->resolveOrchestratorPlannerIntentPayload();
            if ($plannerIntent !== null) {
                $fragment['planner_intent'] = $plannerIntent;
            }
        }
        if (method_exists($endpointsApi, 'resolveOrchestratorKnowledgePayload')) {
            $knowledge = $endpointsApi->resolveOrchestratorKnowledgePayload();
            if ($knowledge !== null) {
                $knowledge['scope'] = 'platform';
                $fragment['knowledge'] = $knowledge;
            }
        }

        foreach (['understand' => 'resolveOrchestratorMmUnderstandPayload', 'generate' => 'resolveOrchestratorMmGeneratePayload', 'edit' => 'resolveOrchestratorMmEditPayload'] as $axis => $method) {
            if (! method_exists($endpointsApi, $method)) {
                continue;
            }
            $mm = $endpointsApi->{$method}();
            if ($mm !== null) {
                $fragment['mm_' . $axis] = $mm;
            }
        }

        return $fragment;
    }
}
