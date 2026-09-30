/**
 * Hra Snake pro stránku snake.html.
 *
 * Celá hra běží v jednom <canvas> nad pevnou mřížkou buněk. Herní stav se
 * posouvá v pravidelném tiku, jehož délka se s rostoucím skóre zkracuje,
 * takže hra postupně zrychluje.
 *
 * Ovládání je záměrně vícecestné – klávesnice (šipky i WASD), tah prstem po
 * herní ploše a dotyková tlačítka pod plochou. Vstupy se ukládají do krátké
 * fronty, aby se při rychlém dvojstisku neztratil druhý tah.
 *
 * Nejlepší dosažené skóre se ukládá do localStorage a přežije zavření
 * prohlížeče.
 */
(function () {
	'use strict';

	var canvas = document.getElementById('snake-canvas');
	if (!canvas) {
		return;
	}

	var context = canvas.getContext('2d');
	var board = canvas.parentElement;
	var scoreEl = document.getElementById('snake-score');
	var bestEl = document.getElementById('snake-best');
	var overlayEl = document.getElementById('snake-overlay');
	var overlayTitleEl = document.getElementById('snake-overlay-title');
	var overlayTextEl = document.getElementById('snake-overlay-text');
	var startBtn = document.getElementById('snake-start');
	var restartBtn = document.getElementById('snake-restart');
	var padEl = document.getElementById('snake-pad');

	var STORAGE_KEY = 'snake-highscore';
	/** Počet buněk mřížky na stranu. */
	var GRID = 20;
	/** Délka tiku na začátku hry a nejkratší možná délka tiku (ms). */
	var START_SPEED = 140;
	var MIN_SPEED = 65;
	/** O kolik ms se tik zkrátí za každé snězené jídlo. */
	var SPEED_STEP = 4;
	/** Minimální délka tahu prstem, aby se bral jako záměrné gesto (px). */
	var SWIPE_THRESHOLD = 24;

	var DIRECTIONS = {
		up: { x: 0, y: -1 },
		down: { x: 0, y: 1 },
		left: { x: -1, y: 0 },
		right: { x: 1, y: 0 }
	};

	var KEY_DIRECTIONS = {
		ArrowUp: 'up',
		ArrowDown: 'down',
		ArrowLeft: 'left',
		ArrowRight: 'right',
		Up: 'up',
		Down: 'down',
		Left: 'left',
		Right: 'right',
		w: 'up',
		s: 'down',
		a: 'left',
		d: 'right'
	};

	/** 'ready' | 'running' | 'paused' | 'over' */
	var state = 'ready';
	var snake = [];
	var direction = 'right';
	/** Fronta dalších směrů – řeší rychlé dvojstisky v rámci jednoho tiku. */
	var queued = [];
	var food = null;
	var score = 0;
	var best = readBest();
	var speed = START_SPEED;
	var timer = null;
	var cellSize = 0;

	function t(key, vars) {
		return window.I18n ? window.I18n.t(key, vars) : key;
	}

	function readBest() {
		try {
			var stored = parseInt(window.localStorage.getItem(STORAGE_KEY), 10);
			return isNaN(stored) || stored < 0 ? 0 : stored;
		} catch (err) {
			// Přístup k localStorage může být zakázaný – hra funguje i bez něj.
			return 0;
		}
	}

	function writeBest(value) {
		try {
			window.localStorage.setItem(STORAGE_KEY, String(value));
		} catch (err) {
			/* Uložení nejlepšího skóre je nepovinné. */
		}
	}

	/* --- Vykreslování --- */

	/**
	 * Přizpůsobí rozlišení canvasu skutečné velikosti prvku i hustotě displeje,
	 * aby hra nebyla rozmazaná na retina obrazovkách.
	 */
	function resizeCanvas() {
		var rect = board.getBoundingClientRect();
		var size = Math.max(1, Math.round(Math.min(rect.width, rect.height)));
		var ratio = window.devicePixelRatio || 1;

		canvas.width = Math.round(size * ratio);
		canvas.height = Math.round(size * ratio);
		context.setTransform(ratio, 0, 0, ratio, 0, 0);

		cellSize = size / GRID;
		draw();
	}

	function roundedCell(x, y, inset, radius) {
		var left = x * cellSize + inset;
		var top = y * cellSize + inset;
		var size = cellSize - inset * 2;
		var r = Math.min(radius, size / 2);

		context.beginPath();
		context.moveTo(left + r, top);
		context.arcTo(left + size, top, left + size, top + size, r);
		context.arcTo(left + size, top + size, left, top + size, r);
		context.arcTo(left, top + size, left, top, r);
		context.arcTo(left, top, left + size, top, r);
		context.closePath();
	}

	function drawGrid() {
		var size = cellSize * GRID;

		context.clearRect(0, 0, size, size);
		context.fillStyle = 'rgba(8, 12, 22, 0.9)';
		context.fillRect(0, 0, size, size);

		context.strokeStyle = 'rgba(255, 255, 255, 0.04)';
		context.lineWidth = 1;
		for (var i = 1; i < GRID; i++) {
			var offset = Math.round(i * cellSize) + 0.5;
			context.beginPath();
			context.moveTo(offset, 0);
			context.lineTo(offset, size);
			context.stroke();
			context.beginPath();
			context.moveTo(0, offset);
			context.lineTo(size, offset);
			context.stroke();
		}
	}

	function drawFood() {
		if (!food) {
			return;
		}
		var inset = cellSize * 0.18;
		context.fillStyle = '#f472b6';
		context.shadowColor = 'rgba(244, 114, 182, 0.65)';
		context.shadowBlur = cellSize * 0.6;
		roundedCell(food.x, food.y, inset, cellSize * 0.5);
		context.fill();
		context.shadowBlur = 0;
	}

	function drawSnake() {
		for (var i = snake.length - 1; i >= 0; i--) {
			var segment = snake[i];
			var isHead = i === 0;
			// Ocas je tmavší než hlava – had má tak čitelný směr pohybu.
			var shade = snake.length > 1 ? i / snake.length : 0;

			context.fillStyle = isHead
				? '#a5b4fc'
				: 'rgba(' + Math.round(99 + 40 * (1 - shade)) + ', ' + Math.round(102 + 60 * (1 - shade)) + ', 241, ' + (0.95 - shade * 0.45).toFixed(3) + ')';
			roundedCell(segment.x, segment.y, cellSize * 0.04, cellSize * 0.28);
			context.fill();
		}
	}

	function draw() {
		if (!cellSize) {
			return;
		}
		drawGrid();
		drawFood();
		drawSnake();
	}

	/* --- Herní stav --- */

	function randomFood() {
		var free = [];
		for (var y = 0; y < GRID; y++) {
			for (var x = 0; x < GRID; x++) {
				if (!occupies(x, y)) {
					free.push({ x: x, y: y });
				}
			}
		}
		if (free.length === 0) {
			return null;
		}
		return free[Math.floor(Math.random() * free.length)];
	}

	function occupies(x, y) {
		for (var i = 0; i < snake.length; i++) {
			if (snake[i].x === x && snake[i].y === y) {
				return true;
			}
		}
		return false;
	}

	function resetGame() {
		var middle = Math.floor(GRID / 2);

		snake = [
			{ x: middle, y: middle },
			{ x: middle - 1, y: middle },
			{ x: middle - 2, y: middle }
		];
		direction = 'right';
		queued = [];
		score = 0;
		speed = START_SPEED;
		food = randomFood();
		updateScore();
		draw();
	}

	function updateScore() {
		scoreEl.textContent = String(score);
		bestEl.textContent = String(best);
	}

	/** Poslední skutečně naplánovaný směr – proti otočení hada o 180°. */
	function lastDirection() {
		return queued.length > 0 ? queued[queued.length - 1] : direction;
	}

	function turn(next) {
		if (!DIRECTIONS[next]) {
			return;
		}
		if (state === 'ready') {
			start();
		} else if (state !== 'running') {
			return;
		}

		var current = lastDirection();
		var isOpposite = DIRECTIONS[next].x === -DIRECTIONS[current].x
			&& DIRECTIONS[next].y === -DIRECTIONS[current].y;

		if (next === current || isOpposite || queued.length >= 2) {
			return;
		}
		queued.push(next);
	}

	function step() {
		if (queued.length > 0) {
			direction = queued.shift();
		}

		var move = DIRECTIONS[direction];
		var head = { x: snake[0].x + move.x, y: snake[0].y + move.y };

		var hitsWall = head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID;
		// Do ocasu, který se v tomto tahu odsune, náraz nepočítáme.
		var hitsSelf = false;
		for (var i = 0; i < snake.length - 1; i++) {
			if (snake[i].x === head.x && snake[i].y === head.y) {
				hitsSelf = true;
				break;
			}
		}

		if (hitsWall || hitsSelf) {
			gameOver();
			return;
		}

		snake.unshift(head);

		if (food && head.x === food.x && head.y === food.y) {
			score++;
			speed = Math.max(MIN_SPEED, START_SPEED - score * SPEED_STEP);
			food = randomFood();

			if (score > best) {
				best = score;
				writeBest(best);
			}
			updateScore();

			if (!food) {
				// Had zaplnil celou plochu – hra je dohraná.
				win();
				return;
			}
		} else {
			snake.pop();
		}

		draw();
		scheduleTick();
	}

	function scheduleTick() {
		window.clearTimeout(timer);
		if (state !== 'running') {
			return;
		}
		timer = window.setTimeout(step, speed);
	}

	/* --- Přechody mezi stavy --- */

	function showOverlay(titleKey, textKey, vars) {
		overlayTitleEl.textContent = t(titleKey);
		overlayTextEl.textContent = t(textKey, vars);
		overlayEl.hidden = false;
		// Klíče držíme na elementu, aby šlo hlášku přeložit i po změně jazyka.
		overlayEl.dataset.titleKey = titleKey;
		overlayEl.dataset.textKey = textKey;
		overlayEl.dataset.vars = vars ? JSON.stringify(vars) : '';
	}

	function hideOverlay() {
		overlayEl.hidden = true;
		overlayEl.dataset.titleKey = '';
		overlayEl.dataset.textKey = '';
		overlayEl.dataset.vars = '';
	}

	function setStartLabel(key) {
		startBtn.setAttribute('data-i18n', key);
		startBtn.textContent = t(key);
	}

	function toReady() {
		state = 'ready';
		window.clearTimeout(timer);
		resetGame();
		setStartLabel('snake.button.start');
		showOverlay('snake.overlay.ready.title', 'snake.overlay.ready.text');
	}

	function start() {
		if (state === 'over') {
			resetGame();
		}
		state = 'running';
		hideOverlay();
		setStartLabel('snake.button.pause');
		scheduleTick();
	}

	function pause() {
		if (state !== 'running') {
			return;
		}
		state = 'paused';
		window.clearTimeout(timer);
		setStartLabel('snake.button.resume');
		showOverlay('snake.overlay.paused.title', 'snake.overlay.paused.text');
	}

	function resume() {
		if (state !== 'paused') {
			return;
		}
		state = 'running';
		hideOverlay();
		setStartLabel('snake.button.pause');
		scheduleTick();
	}

	function togglePause() {
		if (state === 'running') {
			pause();
		} else if (state === 'paused') {
			resume();
		} else {
			start();
		}
	}

	function finish(titleKey, textKey) {
		state = 'over';
		window.clearTimeout(timer);

		if (score > best) {
			best = score;
			writeBest(best);
		}
		updateScore();
		draw();
		setStartLabel('snake.button.again');
		showOverlay(titleKey, textKey, { score: score });
	}

	function gameOver() {
		finish('snake.overlay.over.title', 'snake.overlay.over.text');
	}

	function win() {
		finish('snake.overlay.win.title', 'snake.overlay.win.text');
	}

	/* --- Vstupy --- */

	document.addEventListener('keydown', function (event) {
		// Při otevřeném přihlašovacím dialogu hru neovládáme.
		if (document.body.classList.contains('auth-modal-open')) {
			return;
		}

		var key = event.key;
		var mapped = KEY_DIRECTIONS[key] || KEY_DIRECTIONS[String(key).toLowerCase()];

		if (mapped) {
			event.preventDefault();
			turn(mapped);
			return;
		}

		if (key === ' ' || key === 'Spacebar') {
			event.preventDefault();
			togglePause();
			return;
		}

		if (key === 'Enter') {
			event.preventDefault();
			if (state === 'over') {
				toReady();
				start();
			} else if (state === 'ready') {
				start();
			}
		}
	});

	startBtn.addEventListener('click', function () {
		if (state === 'over') {
			toReady();
		}
		togglePause();
	});

	restartBtn.addEventListener('click', function () {
		toReady();
	});

	if (padEl) {
		padEl.addEventListener('click', function (event) {
			var button = event.target.closest('[data-direction]');
			if (button) {
				turn(button.getAttribute('data-direction'));
			}
		});
	}

	var touchStart = null;

	board.addEventListener('touchstart', function (event) {
		var touch = event.changedTouches[0];
		touchStart = { x: touch.clientX, y: touch.clientY };
	}, { passive: true });

	board.addEventListener('touchmove', function (event) {
		if (touchStart) {
			event.preventDefault();
		}
	}, { passive: false });

	board.addEventListener('touchend', function (event) {
		if (!touchStart) {
			return;
		}
		var touch = event.changedTouches[0];
		var dx = touch.clientX - touchStart.x;
		var dy = touch.clientY - touchStart.y;
		touchStart = null;

		if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) {
			// Krátké klepnutí jen pozastaví nebo rozjede hru.
			togglePause();
			return;
		}

		if (Math.abs(dx) > Math.abs(dy)) {
			turn(dx > 0 ? 'right' : 'left');
		} else {
			turn(dy > 0 ? 'down' : 'up');
		}
	}, { passive: true });

	document.addEventListener('visibilitychange', function () {
		if (document.hidden) {
			pause();
		}
	});

	window.addEventListener('blur', pause);
	window.addEventListener('resize', resizeCanvas);

	document.addEventListener('site:langchange', function () {
		if (!overlayEl.hidden && overlayEl.dataset.titleKey) {
			var vars = overlayEl.dataset.vars ? JSON.parse(overlayEl.dataset.vars) : undefined;
			overlayTitleEl.textContent = t(overlayEl.dataset.titleKey);
			overlayTextEl.textContent = t(overlayEl.dataset.textKey, vars);
		}
	});

	toReady();
	resizeCanvas();
})();
