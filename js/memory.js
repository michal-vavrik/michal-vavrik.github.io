(function () {
	'use strict';

	var board = document.getElementById('memory-board');
	if (!board) {
		return;
	}

	var difficulty = document.getElementById('memory-difficulty');
	var restartButton = document.getElementById('memory-restart');
	var timeValue = document.getElementById('memory-time');
	var movesValue = document.getElementById('memory-moves');
	var pairsValue = document.getElementById('memory-pairs');
	var announcement = document.getElementById('memory-announcement');

	var SYMBOLS = [
		'😀', '😃', '😄', '😁', '😆', '😅', '😂', '🙂', '🙃', '😉', '😊', '😇',
		'🥰', '😍', '🤩', '😎', '🤓', '🥳', '😺', '😸', '🐶', '🐱', '🐭', '🐹',
		'🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔',
		'🐧', '🐦', '🐤', '🦄', '🐝', '🦋', '🐢', '🐍', '🦎', '🐙', '🦀', '🐬',
		'🐳', '🦈', '🐘', '🦒', '🦓', '🦜', '🦩', '🌵', '🌲', '🌻', '🌹', '🍎',
		'🍋', '🍉', '🍇', '🍓', '🍒', '🍍', '🥑', '🥕', '🌽', '🍕', '🍩', '🎈'
	];
	var MISMATCH_DELAY = 900;

	var cards = [];
	var selected = [];
	var matchedPairs = 0;
	var moves = 0;
	var pairCount = 8;
	var startedAt = null;
	var elapsedSeconds = 0;
	var timer = null;
	var mismatchTimer = null;
	var generation = 0;
	var won = false;
	var lastAnnouncement = '';

	function t(key, vars) {
		return window.I18n ? window.I18n.t(key, vars) : key;
	}

	function shuffle(items) {
		for (var i = items.length - 1; i > 0; i--) {
			var j = Math.floor(Math.random() * (i + 1));
			var item = items[i];
			items[i] = items[j];
			items[j] = item;
		}
		return items;
	}

	function formatTime(seconds) {
		var minutes = Math.floor(seconds / 60);
		var remainder = seconds % 60;
		return String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
	}

	function setAnnouncement(key, vars) {
		lastAnnouncement = key;
		announcement.textContent = key ? t(key, vars) : '';
	}

	function updateStats() {
		timeValue.textContent = formatTime(elapsedSeconds);
		movesValue.textContent = String(moves);
		pairsValue.textContent = matchedPairs + ' / ' + pairCount;
	}

	function cardLabel(card, index) {
		if (card.matched || card.revealed) {
			return t('memory.card.revealed', { number: index + 1, symbol: card.symbol });
		}
		return t('memory.card.hidden', { number: index + 1 });
	}

	function renderCards() {
		for (var i = 0; i < cards.length; i++) {
			var card = cards[i];
			var button = card.element;
			button.textContent = card.revealed || card.matched ? card.symbol : '?';
			button.setAttribute('aria-label', cardLabel(card, i));
			button.setAttribute('aria-pressed', card.revealed || card.matched ? 'true' : 'false');
			button.disabled = card.matched;
			button.classList.toggle('memory__card--revealed', card.revealed && !card.matched);
			button.classList.toggle('memory__card--matched', card.matched);
		}
	}

	function updateElapsed() {
		if (startedAt === null) {
			return;
		}
		elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
		updateStats();
	}

	function beginTimer() {
		if (startedAt !== null) {
			return;
		}
		startedAt = Date.now();
		timer = window.setInterval(updateElapsed, 250);
	}

	function finishGame() {
		updateElapsed();
		won = true;
		if (timer !== null) {
			window.clearInterval(timer);
			timer = null;
		}
		setAnnouncement('memory.status.win', {
			time: formatTime(elapsedSeconds),
			moves: moves
		});
	}

	function handleCardClick(card) {
		if (won || mismatchTimer !== null || card.matched || card.revealed) {
			return;
		}

		beginTimer();
		card.revealed = true;
		selected.push(card);
		renderCards();

		if (selected.length < 2) {
			setAnnouncement('memory.status.oneCard');
			return;
		}

		moves++;
		if (selected[0].symbol === selected[1].symbol) {
			selected[0].matched = true;
			selected[1].matched = true;
			selected = [];
			matchedPairs++;
			updateStats();
			renderCards();

			if (matchedPairs === pairCount) {
				finishGame();
			} else {
				setAnnouncement('memory.status.match');
			}
			return;
		}

		updateStats();
		setAnnouncement('memory.status.mismatch');
		var currentGeneration = generation;
		mismatchTimer = window.setTimeout(function () {
			mismatchTimer = null;
			if (generation !== currentGeneration) {
				return;
			}
			selected[0].revealed = false;
			selected[1].revealed = false;
			selected = [];
			renderCards();
		}, MISMATCH_DELAY);
	}

	function startGame() {
		generation++;
		if (mismatchTimer !== null) {
			window.clearTimeout(mismatchTimer);
			mismatchTimer = null;
		}
		if (timer !== null) {
			window.clearInterval(timer);
			timer = null;
		}

		var size = parseInt(difficulty.value, 10);
		if ([4, 6, 8, 10, 12].indexOf(size) === -1) {
			throw new Error('Unsupported Pexeso board size: ' + difficulty.value);
		}
		pairCount = size * size / 2;
		matchedPairs = 0;
		moves = 0;
		selected = [];
		startedAt = null;
		elapsedSeconds = 0;
		won = false;
		setAnnouncement('');
		board.style.setProperty('--memory-columns', String(size));
		board.replaceChildren();

		var symbols = shuffle(SYMBOLS.slice()).slice(0, pairCount);
		var deck = shuffle(symbols.concat(symbols));
		cards = deck.map(function (symbol, index) {
			var button = document.createElement('button');
			button.type = 'button';
			button.className = 'memory__card';
			button.setAttribute('aria-pressed', 'false');
			button.setAttribute('aria-label', t('memory.card.hidden', { number: index + 1 }));
			button.addEventListener('click', function () {
				handleCardClick(cards[index]);
			});
			board.appendChild(button);
			return {
				symbol: symbol,
				element: button,
				revealed: false,
				matched: false
			};
		});
		renderCards();
		updateStats();
	}

	function refreshLanguage() {
		renderCards();
		updateStats();
		if (lastAnnouncement) {
			announcement.textContent = t(lastAnnouncement, {
				time: formatTime(elapsedSeconds),
				moves: moves
			});
		}
	}

	difficulty.addEventListener('change', startGame);
	restartButton.addEventListener('click', startGame);
	document.addEventListener('site:langchange', refreshLanguage);
	startGame();
}());
