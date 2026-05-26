<?php



declare(strict_types=1);



/**

 * GET /mine/workspace-panel — SPA shell HTML for workspace/mines.

 */

return function (): void {

    header('Cache-Control: no-store, no-cache, must-revalidate');



    $auth = $this->api('auth');

    $core = $this->api('core');

    $pdo = $auth?->getDB()?->getDBAdapter();

    if ($pdo instanceof \PDO && $core) {

        $core->rejectCustomerProductApi($pdo);

    }



    if (! $auth) {

        $this->oaao_mine_json_exit(503, false, 'Authentication unavailable');

    }



    $user = $auth->getUser();

    if (! $user) {

        $this->oaao_mine_json_exit(401, false, 'Not authenticated', [

            'sign_in_path' => $auth->signInPath(),

        ]);

    }



    $html = $this->loadTemplate('workspace_panel')->output();

    $this->oaao_mine_json_exit(200, true, '', ['html' => $html]);

};


