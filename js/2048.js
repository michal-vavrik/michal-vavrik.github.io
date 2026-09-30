(function () {
	'use strict';

	var SIZE = 4;
	var CELL_COUNT = SIZE * SIZE;
	var STORAGE_KEY = 'game-2048-best';
	var SWIPE_THRESHOLD = 24;
	var boardEl = document.getElementById('g2048-board');
	var cells = Array.prototype.slice.call(boardEl.querySelectorAll('.g2048__cell'));
	var scoreEl = document.getElementById('g2048-score');
	var bestEl = document.getElementById('g2048-best');
	var statusEl = document.getElementById('g2048-status');
	var restartBtn = document.getElementById('g2048-restart');
	var padEl = document.querySelector('.g2048__pad');
	var authModal = document.getElementById('auth-modal');
	var board = [];
	var score = 0;
	var best = readBest();
	var won = false;
	var statusKey = 'g2048.status.ready';

	function t(key, vars) {
		return window.I18n ? window.I18n.t(key, vars) : key;
	}

	function readBest() {
		try {
			var stored = parseInt(window.localStorage.getItem(STORAGE_KEY), 10);
			return isNaN(stored) || stored < 0 ? 0 : stored;
		} catch (err) {
			return 0;
		}
	}

	function writeBest(value) {
		try {
			window.localStorage.setItem(STORAGE_KEY, String(value));
		} catch (err) {
			/* Best-score persistence is optional; the game still works without storage. */
		}
	}

	function render() {
		for (var i = 0; i < CELL_COUNT; i += 1) {
			var value = board[i];
			var cell = cells[i];
			cell.textContent = value ? String(value) : '';
			if (value) {
				cell.setAttribute('data-value', String(value));
				cell.setAttribute('aria-label', t('g2048.tile.value', { value: value }));
			} else {
				cell.removeAttribute('data-value');
				cell.setAttribute('aria-label', t('g2048.tile.empty'));
			}
		}

		scoreEl.textContent = String(score);
		bestEl.textContent = String(best);
		statusEl.textContent = t(statusKey);
	}

	function spawnTile() {
		var empty = [];
		for (var i = 0; i < CELL_COUNT; i += 1) {
			if (board[i] === 0) {
				empty.push(i);
			}
		}
		if (!empty.length) {
			return;
		}

		var index = empty[Math.floor(Math.random() * empty.length)];
		board[index] = Math.random() < 0.9 ? 2 : 4;
	}

	function reset() {
		board = new Array(CELL_COUNT).fill(0);
		score = 0;
		won = false;
		statusKey = 'g2048.status.ready';
		spawnTile();
		spawnTile();
		render();
	}

	function lineIndexes(direction, line) {
		var indexes = [];
		for (var offset = 0; offset < SIZE; offset += 1) {
			if (direction === 'left') {
				indexes.push(line * SIZE + offset);
			} else if (direction === 'right') {
				indexes.push(line * SIZE + (SIZE - 1 - offset));
			} else if (direction === 'up') {
				indexes.push(offset * SIZE + line);
			} else {
				indexes.push((SIZE - 1 - offset) * SIZE + line);
			}
		}
		return indexes;
	}

	function slideLine(indexes) {
		var values = [];
		for (var i = 0; i < indexes.length; i += 1) {
			if (board[indexes[i]]) {
				values.push(board[indexes[i]]);
			}
		}

		var merged = [];
		for (var j = 0; j < values.length; j += 1) {
			if (values[j] === values[j + 1]) {
				var combined = values[j] * 2;
				merged.push(combined);
				score += combined;
				j += 1;
			} else {
				merged.push(values[j]);
			}
		}

		for (var k = 0; k < indexes.length; k += 1) {
			board[indexes[k]] = merged[k] || 0;
		}
	}

	function hasMoves() {
		for (var i = 0; i < CELL_COUNT; i += 1) {
			if (board[i] === 0) {
				return true;
			}
			if (i % SIZE < SIZE - 1 && board[i] === board[i + 1]) {
				return true;
			}
			if (i < CELL_COUNT - SIZE && board[i] === board[i + SIZE]) {
				return true;
			}
		}
		return false;
	}

	function move(direction) {
		if (!hasMoves()) {
			return;
		}

		var before = board.slice();
		var previousScore = score;
		for (var line = 0; line < SIZE; line += 1) {
			slideLine(lineIndexes(direction, line));
		}

		var changed = false;
		for (var i = 0; i < CELL_COUNT; i += 1) {
			if (before[i] !== board[i]) {
				changed = true;
				break;
			}
		}
		if (!changed) {
			score = previousScore;
			return;
		}

		if (score > best) {
			best = score;
			writeBest(best);
		}

		if (!won && board.some(function (value) { return value >= 2048; })) {
			won = true;
			statusKey = 'g2048.status.win';
		} else {
			statusKey = 'g2048.status.playing';
		}

		spawnTile();
		if (!hasMoves()) {
			statusKey = 'g2048.status.over';
		}
		render();
	}

	function isInteractiveTarget(target) {
		if (!target || !target.closest) {
			return false;
		}
		if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], nav, .header-controls')) {
			return true;
		}
		return Boolean(target.closest('button') && !target.closest('.game__controls, .g2048__pad'));
	}

	function onKeyDown(event) {
		if (authModal && !authModal.hidden) {
			return;
		}
		if (isInteractiveTarget(event.target)) {
			return;
		}

		var key = String(event.key).toLowerCase();
		var direction = {
			arrowleft: 'left',
			a: 'left',
			arrowright: 'right',
			d: 'right',
			arrowup: 'up',
			w: 'up',
			arrowdown: 'down',
			s: 'down'
		}[key];

		if (direction) {
			event.preventDefault();
			move(direction);
		}
	}

	function onTouchStart(event) {
		var touch = event.changedTouches[0];
		boardEl.dataset.touchStartX = String(touch.clientX);
		boardEl.dataset.touchStartY = String(touch.clientY);
	}

	function onTouchEnd(event) {
		if (boardEl.dataset.touchStartX === undefined) {
			return;
		}
		var startX = Number(boardEl.dataset.touchStartX);
		var startY = Number(boardEl.dataset.touchStartY);
		delete boardEl.dataset.touchStartX;
		delete boardEl.dataset.touchStartY;

		var touch = event.changedTouches[0];
		var dx = touch.clientX - startX;
		var dy = touch.clientY - startY;
		if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) {
			return;
		}
		if (Math.abs(dx) > Math.abs(dy)) {
			move(dx > 0 ? 'right' : 'left');
		} else {
			move(dy > 0 ? 'down' : 'up');
		}
	}

	restartBtn.addEventListener('click', reset);
	document.addEventListener('keydown', onKeyDown);
	boardEl.addEventListener('touchstart', onTouchStart, { passive: true });
	boardEl.addEventListener('touchend', onTouchEnd, { passive: true });
	boardEl.addEventListener('touchcancel', function () {
		delete boardEl.dataset.touchStartX;
		delete boardEl.dataset.touchStartY;
	});
	if (padEl) {
		padEl.addEventListener('click', function (event) {
			var button = event.target.closest('[data-direction]');
			if (button) {
				move(button.getAttribute('data-direction'));
			}
		});
	}

	document.addEventListener('site:langchange', render);
	reset();
})();
