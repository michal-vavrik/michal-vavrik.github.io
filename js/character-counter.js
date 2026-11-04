(function () {
	'use strict';

	var textInput = document.getElementById('character-counter-text');
	var countOutput = document.getElementById('character-counter-count');
	var clearButton = document.getElementById('character-counter-clear');

	if (!textInput || !countOutput || !clearButton) {
		return;
	}

	var segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
		? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
		: null;

	function countCharacters(text) {
		if (/^[\x00-\x7f]*$/.test(text)) {
			return text.length;
		}
		if (!segmenter) {
			return Array.from(text).length;
		}

		var count = 0;
		var segments = segmenter.segment(text);
		for (var segment of segments) {
			count++;
		}
		return count;
	}

	function updateCount() {
		countOutput.textContent = String(countCharacters(textInput.value));
	}

	textInput.addEventListener('input', updateCount);
	clearButton.addEventListener('click', function () {
		textInput.value = '';
		updateCount();
		textInput.focus();
	});

	var maxOutputLength = 10000000;
	var collectionForm = document.getElementById('item-collection-form');
	var tableForm = document.getElementById('table-configuration-form');
	var tabs = Array.from(document.querySelectorAll('.tools__tab'));

	function selectTab(selectedTab) {
		tabs.forEach(function (tab) {
			var selected = tab === selectedTab;
			tab.setAttribute('aria-selected', String(selected));
			tab.tabIndex = selected ? 0 : -1;
			document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
		});
	}

	tabs.forEach(function (tab, index) {
		tab.addEventListener('click', function () {
			selectTab(tab);
		});
		tab.addEventListener('keydown', function (event) {
			var nextIndex;
			if (event.key === 'ArrowRight') {
				nextIndex = (index + 1) % tabs.length;
			} else if (event.key === 'ArrowLeft') {
				nextIndex = (index + tabs.length - 1) % tabs.length;
			} else if (event.key === 'Home') {
				nextIndex = 0;
			} else if (event.key === 'End') {
				nextIndex = tabs.length - 1;
			} else {
				return;
			}
			event.preventDefault();
			selectTab(tabs[nextIndex]);
			tabs[nextIndex].focus();
		});
	});

	function repeatedEntries(entry, count) {
		return count === 0 ? '' : (entry + ',').repeat(count - 1) + entry;
	}

	function setGeneratedText(text) {
		textInput.value = text;
		updateCount();
		textInput.focus();
	}

	function digits(length) {
		return '0123456789'.repeat(Math.ceil(length / 10)).slice(0, length);
	}

	collectionForm.addEventListener('input', function () {
		document.getElementById('collection-error').hidden = true;
	});

	collectionForm.addEventListener('submit', function (event) {
		event.preventDefault();
		if (!collectionForm.reportValidity()) {
			return;
		}
		var valueLength = document.getElementById('collection-value-length').valueAsNumber;
		var textLength = document.getElementById('collection-text-length').valueAsNumber;
		var count = document.getElementById('collection-count').valueAsNumber;
		var entryLength = "{'value':'','text':''}".length + valueLength + textLength;
		var outputLength = 2 + count * entryLength + Math.max(0, count - 1);
		var error = document.getElementById('collection-error');
		error.hidden = outputLength <= maxOutputLength;
		if (!error.hidden) {
			return;
		}
		var entry = count === 0 ? '' : "{'value':'" + digits(valueLength) + "','text':'" + digits(textLength) + "'}";
		setGeneratedText('[' + repeatedEntries(entry, count) + ']');
	});

	tableForm.addEventListener('input', function () {
		document.getElementById('table-error').hidden = true;
	});

	tableForm.addEventListener('submit', function (event) {
		event.preventDefault();
		if (!tableForm.reportValidity()) {
			return;
		}
		var indexLength = document.getElementById('table-index-length').valueAsNumber;
		var count = document.getElementById('table-count').valueAsNumber;
		var type = tableForm.querySelector('input[name="table-type"]:checked').value;
		var prefix = '{"' + type + '":[';
		var flags = '';
		if (document.getElementById('table-visible').checked) {
			flags += ',"visible":false';
		}
		if (document.getElementById('table-disable').checked) {
			flags += ',"disable":false';
		}
		var entryLength = '{"index":}'.length + indexLength + flags.length;
		var outputLength = prefix.length + 2 + count * entryLength + Math.max(0, count - 1);
		var error = document.getElementById('table-error');
		error.hidden = outputLength <= maxOutputLength;
		if (!error.hidden) {
			return;
		}
		var entry = count === 0 ? '' : '{"index":' + digits(indexLength) + flags + '}';
		var entries = repeatedEntries(entry, count);
		setGeneratedText(prefix + entries + ']}');
	});

	updateCount();
})();
