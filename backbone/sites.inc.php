<?php

/*
 * This file is part of Razy v1.0.2-beta.
 *
 * (c) Ray Fung <hello@rayfung.hk>
 *
 * This source file is subject to the MIT license that is bundled
 * with this source code in the file LICENSE.
 */

	return [
	'domains' => [
		/*
		 * The key is the domain and the value is the string of distribution path.
		 * You can set the value as an array for advanced distribution setup.
		 *
		 * The distribution folder must contain a dist.php
		 *
		 * Basic usage:
		 * 'domain.name' => (string) The module distribution path
		 *
		 * Advanced usage:
		 * (The module folder will not be loaded if it is a distribution folder)
		 * 'domain.name' => (array) [
		 *   'path' => (string) The module distribution path in sites folder
		 * ]
		 *
		 * Tagging:
		 * '/path' => 'mysite@v2'   // use the 'v2' tag from dist.php modules
		 *
		 * Per-domain config folder mapping is handled via config_mapping in dist.php.
		 */
		'localhost' => [
			// Path is relative to RELATIVE_ROOT (config relative_url_root), not the host path.
			// With docroot = repo root and the app in backbone/, URLs are localhost/backbone/…;
			// Razy strips /backbone for routing, so the distributor mount here stays '/'.
			'/' => 'oaaoai',
		],
		// Wildcard FQDN keys: {@see Application::matchDomain()} matches one label before the suffix
		// (e.g. foo.localhost, preview.invalid). Embedded / preview browsers sometimes send Host values
		// that do not equal `localhost` or the explicit `alias` list—without these, bootstrap returns
		// HTML error before JSON panel routes run.
		'*.localhost' => [
			'/' => 'oaaoai',
		],
		// `.invalid` is reserved (RFC 2606); safe for tooling that synthesizes unconventional Host names.
        '*.invalid' => [
            '/' => 'oaaoai',
        ],
        'admin.localhost' => [
            '/' => 'oaaoai',
        ],
    ],

    // Map extra Host headers to the same distributor tree as localhost (browser often uses 127.0.0.1 or Docker Desktop).
    // Without this, {@see Application::host()} throws — or you must duplicate the `domains` block per host.
    // Compose service hostname `web` is used orchestrator→Apache (`http://web/…`); add here so bootstrap matches `localhost` distro.
    // Platform god-mode console: {@code admin.localhost} → same distributor; tenant kind resolved via {@code oaao_tenant_host}.
    'alias' => [
		'127.0.0.1'             => 'localhost',
		'host.docker.internal' => 'localhost',
		'web'                   => 'localhost',
	],
];
