<?php

/*
 * This file is part of Razy v1.0.2-beta.
 *
 * (c) Ray Fung <hello@rayfung.hk>
 *
 * This source file is subject to the MIT license that is bundled
 * with this source code in the file LICENSE.
 */

/** @var array{path: string} */
$oaaoDist = ['/' => 'oaaoai'];

/** @var array<string, array{path: string}> $domains */
$domains = [
	'localhost' => $oaaoDist,
	// Wildcard FQDN keys: {@see Application::matchDomain()} matches one label before the suffix
	// (e.g. foo.localhost, preview.invalid). Embedded / preview browsers sometimes send Host values
	// that do not equal `localhost` or the explicit `alias` list—without these, bootstrap returns
	// HTML error before JSON panel routes run.
	'*.localhost' => $oaaoDist,
	// `.invalid` is reserved (RFC 2606); safe for tooling that synthesizes unconventional Host names.
	'*.invalid' => $oaaoDist,
	'admin.localhost' => $oaaoDist,
];

// Map extra Host headers to the same distributor tree as localhost (browser often uses 127.0.0.1 or Docker Desktop).
// Without this, {@see Application::host()} throws — or you must duplicate the `domains` block per host.
// Compose service hostname `web` is used orchestrator→Apache (`http://web/…`); add here so bootstrap matches `localhost` distro.
// Platform god-mode console: {@code admin.localhost} → same distributor; tenant kind resolved via {@code oaao_tenant_host}.
/** @var array<string, string> $alias */
$alias = [
	'127.0.0.1'             => 'localhost',
	'host.docker.internal' => 'localhost',
	'web'                   => 'localhost',
];

/**
 * Production / whitelabel hosts.
 *
 * Razy {@see NetworkUtil::isFqdn()} rejects bare {@code *}, so {@code updateSites()} never registers a
 * catch-all key — use apex + {@code *.{apex}} wildcards and explicit FQDNs instead.
 */
$apex = getenv('OAAO_APEX_DOMAIN');
if ($apex === false || trim($apex) === '') {
	$apex = 'rayfung.hk';
}
$apex = strtolower(trim($apex));
if ($apex !== '') {
	$domains[$apex] = $oaaoDist;
	$domains['*.' . $apex] = $oaaoDist;
}

$adminHost = getenv('OAAO_PLATFORM_ADMIN_HOST');
if ($adminHost === false || trim($adminHost) === '') {
	$adminHost = $apex !== '' ? 'admin.' . $apex : 'admin.localhost';
}
$adminHost = strtolower(trim($adminHost));
if ($adminHost !== '' && $adminHost !== 'admin.localhost') {
	$domains[$adminHost] = $oaaoDist;
}

$customerHosts = getenv('OAAO_CUSTOMER_HOSTS');
if ($customerHosts === false || trim($customerHosts) === '') {
	$customerHosts = $apex !== '' ? 'oaao.' . $apex : '';
}
if ($customerHosts !== false && trim($customerHosts) !== '') {
	foreach (preg_split('/[\s,]+/', trim($customerHosts)) ?: [] as $hostEntry) {
		$hostEntry = strtolower(trim((string) $hostEntry));
		if ($hostEntry === '') {
			continue;
		}
		$domains[$hostEntry] = $oaaoDist;
	}
}

return [
	'domains' => $domains,
	'alias'   => $alias,
];
