(function () {
	'use strict';

	var canvas = document.getElementById('tetris-canvas');
	if (!canvas) {
		return;
	}

	var context = canvas.getContext('2d');
	var nextCanvas = document.getElementById('tetris-next');
	var nextContext = nextCanvas.getContext('2d');
	var board = canvas.parentElement;
	var scoreEl = document.getElementById('tetris-score');
	var bestEl = document.getElementById('tetris-best');
	var levelEl = document.getElementById('tetris-level');
	var overlayEl = document.getElementById('tetris-overlay');
	var overlayTitleEl = document.getElementById('tetris-overlay-title');
	var overlayTextEl = document.getElementById('tetris-overlay-text');
	var startBtn = document.getElementById('tetris-start');
	var pauseBtn = document.getElementById('tetris-pause');
	var restartBtn = document.getElementById('tetris-restart');
	var authModal = document.getElementById('auth-modal');

	var COLUMNS = 10;
	var ROWS = 20;
	var STORAGE_KEY = 'tetris-highscore';
	var COLORS = {
		I: '#38bdf8',
		J: '#6366f1',
		L: '#f97316',
		O: '#facc15',
		S: '#22c55e',
		T: '#c084fc',
		Z: '#f43f5e'
	};
	var SHAPES = {
		I: [[1, 1, 1, 1]],
		J: [[1, 0, 0], [1, 1, 1]],
		L: [[0, 0, 1], [1, 1, 1]],
		O: [[1, 1], [1, 1]],
		S: [[0, 1, 1], [1, 1, 0]],
		T: [[0, 1, 0], [1, 1, 1]],
		Z: [[1, 1, 0], [0, 1, 1]]
	};
	var state = 'ready';
	var grid = [];
	var bag = [];
	var current = null;
	var nextType = null;
	var score = 0;
	var lines = 0;
	var level = 1;
	var best = readBest();
	var timer = null;
	var cellWidth = 0;
	var cellHeight = 0;
	var pausedAutomatically = false;

	function t(key) {
		return window.I18n ? window.I18n.t(key) : key;
	}

	function readBest() {
		try {
			var value = parseInt(window.localStorage.getItem(STORAGE_KEY), 10);
			return isNaN(value) || value < 0 ? 0 : value;
		} catch (err) {
			return 0;
		}
	}

	function writeBest(value) {
		try {
			window.localStorage.setItem(STORAGE_KEY, String(value));
		} catch (err) {
			/* Best score persistence is optional. */
		}
	}

	function refillBag() {
		var types = Object.keys(SHAPES);
		for (var i = types.length - 1; i > 0; i--) {
			var j = Math.floor(Math.random() * (i + 1));
			var swap = types[i];
			types[i] = types[j];
			types[j] = swap;
		}
		bag = bag.concat(types);
	}

	function takeFromBag() {
		if (!bag.length) {
			refillBag();
		}
		return bag.shift();
	}

	function copyMatrix(matrix) {
		return matrix.map(function (row) {
			return row.slice();
		});
	}

	function makePiece(type) {
		var shape = copyMatrix(SHAPES[type]);
		return {
			type: type,
			shape: shape,
			x: Math.floor((COLUMNS - shape[0].length) / 2),
			y: 0
		};
	}

	function updateHud() {
		scoreEl.textContent = String(score);
		bestEl.textContent = String(best);
		levelEl.textContent = String(level);
	}

	function setOverlay(titleKey, textKey) {
		overlayTitleEl.textContent = t(titleKey);
		overlayTextEl.textContent = t(textKey);
		overlayEl.hidden = false;
	}

	function updatePauseButton() {
		pauseBtn.textContent = t(state === 'paused' ? 'tetris.button.resume' : 'tetris.button.pause');
	}

	function createGrid() {
		grid = [];
		for (var y = 0; y < ROWS; y++) {
			grid.push(new Array(COLUMNS).fill(null));
		}
	}

	function resetGame() {
		createGrid();
		bag = [];
		score = 0;
		lines = 0;
		level = 1;
		nextType = takeFromBag();
		current = makePiece(takeFromBag());
		updateHud();
		draw();
		drawNext();
	}

	function isValid(piece, offsetX, offsetY, shape) {
		var matrix = shape || piece.shape;
		for (var y = 0; y < matrix.length; y++) {
			for (var x = 0; x < matrix[y].length; x++) {
				if (!matrix[y][x]) {
					continue;
				}
				var boardX = piece.x + x + (offsetX || 0);
				var boardY = piece.y + y + (offsetY || 0);
				if (boardX < 0 || boardX >= COLUMNS || boardY >= ROWS) {
					return false;
				}
				if (boardY >= 0 && grid[boardY][boardX]) {
					return false;
				}
			}
		}
		return true;
	}

	function rotateMatrix(matrix) {
		var rotated = [];
		for (var x = 0; x < matrix[0].length; x++) {
			var row = [];
			for (var y = matrix.length - 1; y >= 0; y--) {
				row.push(matrix[y][x]);
			}
			rotated.push(row);
		}
		return rotated;
	}

	function rotatePiece() {
		var rotated = rotateMatrix(current.shape);
		var kicks = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]];
		for (var i = 0; i < kicks.length; i++) {
			if (isValid(current, kicks[i][0], kicks[i][1], rotated)) {
				current.x += kicks[i][0];
				current.y += kicks[i][1];
				current.shape = rotated;
				draw();
				return;
			}
		}
	}

	function movePiece(dx, dy) {
		if (!isValid(current, dx, dy)) {
			return false;
		}
		current.x += dx;
		current.y += dy;
		return true;
	}

	function updateScore(value) {
		score += value;
		if (score > best) {
			best = score;
			writeBest(best);
		}
		updateHud();
	}

	function clearLines() {
		var cleared = 0;
		for (var y = ROWS - 1; y >= 0; y--) {
			if (grid[y].every(function (cell) { return cell !== null; })) {
				grid.splice(y, 1);
				grid.unshift(new Array(COLUMNS).fill(null));
				cleared++;
				y++;
			}
		}
		if (cleared) {
			lines += cleared;
			level = Math.floor(lines / 10) + 1;
			updateScore([0, 100, 300, 500, 800][cleared] * level);
			resetTimer();
		}
	}

	function lockPiece() {
		for (var y = 0; y < current.shape.length; y++) {
			for (var x = 0; x < current.shape[y].length; x++) {
				if (!current.shape[y][x]) {
					continue;
				}
				var boardY = current.y + y;
				if (boardY < 0) {
					endGame();
					return;
				}
				grid[boardY][current.x + x] = current.type;
			}
		}
		clearLines();
		spawnPiece();
	}

	function spawnPiece() {
		current = makePiece(nextType);
		nextType = takeFromBag();
		drawNext();
		if (!isValid(current, 0, 0)) {
			endGame();
		}
	}

	function gravityStep() {
		if (state !== 'running') {
			return;
		}
		if (!movePiece(0, 1)) {
			lockPiece();
		}
		draw();
	}

	function gravityDelay() {
		return Math.max(80, 800 * Math.pow(0.82, level - 1));
	}

	function resetTimer() {
		if (timer) {
			window.clearInterval(timer);
			timer = null;
		}
		if (state === 'running') {
			timer = window.setInterval(gravityStep, gravityDelay());
		}
	}

	function startGame() {
		if (state === 'running') {
			return;
		}
		if (state === 'ready' || state === 'over') {
			resetGame();
		}
		state = 'running';
		pausedAutomatically = false;
		overlayEl.hidden = true;
		updatePauseButton();
		resetTimer();
		draw();
	}

	function pauseGame(autoPaused) {
		if (state !== 'running') {
			return;
		}
		state = 'paused';
		pausedAutomatically = !!autoPaused;
		if (timer) {
			window.clearInterval(timer);
			timer = null;
		}
		setOverlay('tetris.status.paused', autoPaused ? 'tetris.status.autoPausedHint' : 'tetris.status.pausedHint');
		updatePauseButton();
	}

	function endGame() {
		state = 'over';
		pausedAutomatically = false;
		if (timer) {
			window.clearInterval(timer);
			timer = null;
		}
		setOverlay('tetris.status.over', 'tetris.status.overHint');
		updatePauseButton();
		draw();
	}

	function hardDrop() {
		var distance = 0;
		while (movePiece(0, 1)) {
			distance++;
		}
		updateScore(distance * 2);
		lockPiece();
		draw();
	}

	function performAction(action) {
		if (state === 'ready' || state === 'over') {
			startGame();
		}
		if (state !== 'running') {
			return;
		}
		if (action === 'left' || action === 'right') {
			movePiece(action === 'left' ? -1 : 1, 0);
		} else if (action === 'rotate') {
			rotatePiece();
		} else if (action === 'soft') {
			if (movePiece(0, 1)) {
				updateScore(1);
			} else {
				lockPiece();
			}
		} else if (action === 'drop') {
			hardDrop();
			return;
		}
		draw();
	}

	function roundedBlock(ctx, x, y, color, size) {
		var inset = size * 0.07;
		var left = x + inset;
		var top = y + inset;
		var side = size - inset * 2;
		var radius = size * 0.17;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo(left + radius, top);
		ctx.arcTo(left + side, top, left + side, top + side, radius);
		ctx.arcTo(left + side, top + side, left, top + side, radius);
		ctx.arcTo(left, top + side, left, top, radius);
		ctx.arcTo(left, top, left + side, top, radius);
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
		ctx.fillRect(left + radius, top + size * 0.12, side - radius * 2, Math.max(1, size * 0.035));
	}

	function draw() {
		if (!context || !cellWidth || !cellHeight) {
			return;
		}
		context.clearRect(0, 0, COLUMNS, ROWS);
		context.fillStyle = 'rgba(8, 12, 22, 0.96)';
		context.fillRect(0, 0, COLUMNS, ROWS);
		context.strokeStyle = 'rgba(255, 255, 255, 0.065)';
		context.lineWidth = 0.025;
		for (var x = 1; x < COLUMNS; x++) {
			context.beginPath();
			context.moveTo(x, 0);
			context.lineTo(x, ROWS);
			context.stroke();
		}
		for (var y = 1; y < ROWS; y++) {
			context.beginPath();
			context.moveTo(0, y);
			context.lineTo(COLUMNS, y);
			context.stroke();
		}
		for (var row = 0; row < ROWS; row++) {
			for (var col = 0; col < COLUMNS; col++) {
				if (grid[row][col]) {
					roundedBlock(context, col, row, COLORS[grid[row][col]], 1);
				}
			}
		}
		if (current) {
			for (var py = 0; py < current.shape.length; py++) {
				for (var px = 0; px < current.shape[py].length; px++) {
					if (current.shape[py][px] && current.y + py >= 0) {
						roundedBlock(context, current.x + px, current.y + py, COLORS[current.type], 1);
					}
				}
			}
		}
	}

	function drawNext() {
		var ratio = window.devicePixelRatio || 1;
		var size = 140;
		nextCanvas.width = Math.round(size * ratio);
		nextCanvas.height = Math.round(size * ratio);
		nextContext.setTransform(ratio, 0, 0, ratio, 0, 0);
		nextContext.clearRect(0, 0, size, size);
		if (!nextType) {
			return;
		}
		var shape = SHAPES[nextType];
		var blockSize = 25;
		var offsetX = (size - shape[0].length * blockSize) / 2;
		var offsetY = (size - shape.length * blockSize) / 2;
		for (var y = 0; y < shape.length; y++) {
			for (var x = 0; x < shape[y].length; x++) {
				if (shape[y][x]) {
					roundedBlock(nextContext, offsetX + x * blockSize, offsetY + y * blockSize, COLORS[nextType], blockSize);
				}
			}
		}
	}

	function resizeCanvas() {
		var rect = board.getBoundingClientRect();
		var ratio = window.devicePixelRatio || 1;
		var width = Math.max(1, Math.round(rect.width * ratio));
		var height = Math.max(1, Math.round(rect.height * ratio));
		canvas.width = width;
		canvas.height = height;
		cellWidth = width / COLUMNS;
		cellHeight = height / ROWS;
		context.setTransform(cellWidth, 0, 0, cellHeight, 0, 0);
		draw();
	}

	function isGameKeyTarget(target) {
		if (!target || target.isContentEditable) {
			return true;
		}
		if (/^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName)) {
			return true;
		}
		return target.tagName === 'BUTTON' && !target.closest('.tetris');
	}

	function onKeyDown(event) {
		var key = event.key;
		var gameplayKey = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'Spacebar'].indexOf(key) !== -1;
		var pauseKey = key.toLowerCase() === 'p';
		if ((!gameplayKey && !pauseKey) || isGameKeyTarget(event.target)) {
			return;
		}
		if (authModal && !authModal.hidden) {
			return;
		}
		var selection = window.getSelection();
		if (selection && !selection.isCollapsed) {
			return;
		}
		if (gameplayKey) {
			event.preventDefault();
		}
		if (pauseKey) {
			if (state === 'running') {
				pauseGame(false);
			} else if (state === 'paused') {
				startGame();
			}
			return;
		}
		if (key === 'ArrowLeft') {
			performAction('left');
		} else if (key === 'ArrowRight') {
			performAction('right');
		} else if (key === 'ArrowDown') {
			performAction('soft');
		} else if (key === 'ArrowUp') {
			performAction('rotate');
		} else {
			performAction('drop');
		}
	}

	startBtn.addEventListener('click', startGame);
	pauseBtn.addEventListener('click', function () {
		if (state === 'running') {
			pauseGame(false);
		} else if (state === 'paused') {
			startGame();
		}
	});
	restartBtn.addEventListener('click', function () {
		state = 'ready';
		resetGame();
		startGame();
	});
	document.addEventListener('keydown', onKeyDown);
	document.addEventListener('site:langchange', function () {
		updatePauseButton();
		if (state === 'ready') {
			setOverlay('tetris.status.ready', 'tetris.status.readyHint');
		} else if (state === 'paused') {
			setOverlay('tetris.status.paused', pausedAutomatically ? 'tetris.status.autoPausedHint' : 'tetris.status.pausedHint');
		} else if (state === 'over') {
			setOverlay('tetris.status.over', 'tetris.status.overHint');
		}
	});
	document.addEventListener('visibilitychange', function () {
		if (document.hidden) {
			pauseGame(true);
		}
	});
	window.addEventListener('blur', function () {
		pauseGame(true);
	});
	Array.prototype.forEach.call(document.querySelectorAll('.tetris__pad-button'), function (button) {
		button.addEventListener('click', function () {
			performAction(button.getAttribute('data-action'));
		});
	});
	window.addEventListener('resize', resizeCanvas);

	resetGame();
	updatePauseButton();
	resizeCanvas();
	setOverlay('tetris.status.ready', 'tetris.status.readyHint');
})();
