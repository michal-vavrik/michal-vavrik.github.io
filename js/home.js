(function () {
	'use strict';

	var auth = window.SiteAuth;
	var grid = document.getElementById('universe-grid');
	var empty = document.getElementById('universe-empty');
	var role = document.getElementById('universe-empty-role');
	var constellations = grid.querySelectorAll('[data-page]');

	function refresh() {
		var count = 0;
		var changed = false;
		Array.prototype.forEach.call(constellations, function (constellation) {
			var shouldHide = !auth.canAccess(constellation.getAttribute('data-page'));
			if (constellation.hidden !== shouldHide) {
				changed = true;
			}
			constellation.hidden = shouldHide;
			if (!shouldHide) {
				count++;
			}
		});
		var signedIn = auth.role() !== null;
		var hideEmpty = count !== 0 || !signedIn;
		if (empty.hidden !== hideEmpty) {
			changed = true;
		}
		grid.hidden = count === 0;
		empty.hidden = hideEmpty;
		role.hidden = !signedIn;
		if (changed) {
			document.dispatchEvent(new CustomEvent('site:constellationschange'));
		}
	}

	document.addEventListener('site:authchange', refresh);
	refresh();
})();
