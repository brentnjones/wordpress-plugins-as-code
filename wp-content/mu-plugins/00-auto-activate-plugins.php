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

	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}

	$installed = array_keys( get_plugins() );
	$active    = (array) get_option( 'active_plugins', array() );
	$inactive  = array_diff( $installed, $active );

	if ( empty( $inactive ) ) {
		return;
	}

	activate_plugins( $inactive );
}, 20 );
