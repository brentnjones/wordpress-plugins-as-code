<?php
/**
 * Plugin Name: Auto-activate composer-managed plugins
 * Description: Activates every plugin present in wp-content/plugins so that
 *              plugin management stays entirely in composer.json - no manual
 *              step in wp-admin is needed after adding/removing a plugin.
 */

add_action( 'init', static function () {
	// Safe no-op until WordPress has been installed (DB tables don't exist yet).
	if ( ! is_blog_installed() ) {
		return;
	}

	// Only run in wp-admin: some plugins' activation hooks redirect/exit
	// (e.g. setup wizards), which must not happen on a front-end request.
	if ( ! is_admin() || wp_doing_ajax() || wp_doing_cron() ) {
		return;
	}

	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}

	$installed = array_keys( get_plugins() );
	$active    = (array) get_option( 'active_plugins', array() );
	$inactive  = array_diff( $installed, $active );

	if ( empty( $inactive ) ) {
		return;
	}

	// Activate one at a time and isolate failures: some plugins' activation
	// hooks (setup wizards, requirement checks) can throw/fatal, and a single
	// bad one must not block the rest or blank the whole request.
	foreach ( $inactive as $plugin ) {
		try {
			$result = activate_plugin( $plugin );
			if ( is_wp_error( $result ) ) {
				error_log( sprintf( 'auto-activate-plugins: failed to activate %s: %s', $plugin, $result->get_error_message() ) );
			}
		} catch ( \Throwable $e ) {
			error_log( sprintf( 'auto-activate-plugins: exception activating %s: %s', $plugin, $e->getMessage() ) );
		}
	}
}, 20 );
