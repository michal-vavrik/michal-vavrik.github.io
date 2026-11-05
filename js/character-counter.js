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
	var tableDeclarations = document.getElementById('table-declarations');
	var tableDeclarationsCode = document.getElementById('table-declarations-code');
	var tableDataSizeOutput = document.getElementById('table-data-size');
	var tableCopyButton = document.getElementById('table-copy');
	var tableCopyStatus = document.getElementById('table-copy-status');
	var currentTableConfigurationSize = null;
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

	var declarations = document.getElementById('collection-declarations');
	var declarationsCode = document.getElementById('collection-declarations-code');
	var dataSizeOutput = document.getElementById('collection-data-size');
	var copyButton = document.getElementById('collection-copy');
	var copyStatus = document.getElementById('collection-copy-status');
	var currentDataProviderSize = null;

	function unsignedType(value) {
		if (value <= 255) {
			return 'USINT';
		}
		if (value <= 65535) {
			return 'UINT';
		}
		return 'UDINT';
	}

	function updateDeclarations(valueLength, textLength, count, dataProviderSize) {
		currentDataProviderSize = dataProviderSize;
		var lines = [
			'VAR CONSTANT',
			'\tMAX_ELEMENT : ' + unsignedType(count) + ' := ' + count + ';',
			'\tSIZE_VALUE : ' + unsignedType(valueLength) + ' := ' + valueLength + ';',
			'\tSIZE_TEXT : ' + unsignedType(textLength) + ' := ' + textLength + ';',
			'\tSIZE_DP_FIXED_CHARS : USINT := 2;',
			'\tSIZE_DP_ELEMENT_FIXED_CHARS : USINT := 23;',
			'\tSIZE_DATA_PROVIDER : ' + unsignedType(dataProviderSize) + ' := SIZE_DP_FIXED_CHARS + (SIZE_DP_ELEMENT_FIXED_CHARS + SIZE_VALUE + SIZE_TEXT) * MAX_ELEMENT;',
			'END_VAR'
		];
		declarationsCode.textContent = lines.join('\n');
		declarations.hidden = false;
		updateDataProviderSizeLabel();
		copyStatus.hidden = true;
		copyStatus.classList.remove('is-error');
	}

	function updateDataProviderSizeLabel() {
		if (currentDataProviderSize === null) {
			return;
		}
		dataSizeOutput.textContent = currentDataProviderSize.toLocaleString(window.I18n.getLang()) + ' ' + window.I18n.t('tools.collection.characters');
	}

	function updateTableConfigurationSizeLabel() {
		if (currentTableConfigurationSize === null) {
			return;
		}
		tableDataSizeOutput.textContent = currentTableConfigurationSize.toLocaleString(window.I18n.getLang()) + ' ' + window.I18n.t('tools.table.characters');
	}

	document.addEventListener('site:langchange', function () {
		updateDataProviderSizeLabel();
		updateTableConfigurationSizeLabel();
	});

	tableCopyButton.addEventListener('click', function () {
		Promise.resolve().then(function () {
			if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
				throw new Error('Clipboard API is unavailable.');
			}
			return navigator.clipboard.writeText(tableDeclarationsCode.textContent);
		}).then(function () {
			tableCopyStatus.textContent = window.I18n.t('tools.generator.copied');
			tableCopyStatus.hidden = false;
			tableCopyStatus.classList.remove('is-error');
		}).catch(function (error) {
			console.error('Unable to copy table configuration declarations.', error);
			tableCopyStatus.textContent = window.I18n.t('tools.generator.copyError');
			tableCopyStatus.hidden = false;
			tableCopyStatus.classList.add('is-error');
		});
	});

	function updateTableDeclarations(type, indexLength, count, elementFixedChars, fixedChars, configurationSize) {
		currentTableConfigurationSize = configurationSize;
		var lines = [
			'VAR CONSTANT',
			'\tMAX_ELEMENT : ' + unsignedType(count) + ' := ' + count + ';',
			'\tSIZE_INDEX : ' + unsignedType(indexLength) + ' := ' + indexLength + ';',
			'\tSIZE_TC_FIXED_CHARS : ' + unsignedType(fixedChars) + ' := ' + fixedChars + ';',
			'\tSIZE_TC_ELEMENT_FIXED_CHARS : ' + unsignedType(elementFixedChars) + ' := ' + elementFixedChars + ';',
			'\tSIZE_TABLE_CONFIGURATION : ' + unsignedType(configurationSize) + ' := SIZE_TC_FIXED_CHARS + (SIZE_TC_ELEMENT_FIXED_CHARS + SIZE_INDEX) * MAX_ELEMENT;',
			'END_VAR'
		];
		tableDeclarationsCode.textContent = lines.join('\n');
		tableDeclarations.hidden = false;
		updateTableConfigurationSizeLabel();
		tableCopyStatus.hidden = true;
		tableCopyStatus.classList.remove('is-error');
	}

	copyButton.addEventListener('click', function () {
		Promise.resolve().then(function () {
			if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
				throw new Error('Clipboard API is unavailable.');
			}
			return navigator.clipboard.writeText(declarationsCode.textContent);
		}).then(function () {
			copyStatus.textContent = window.I18n.t('tools.generator.copied');
			copyStatus.hidden = false;
			copyStatus.classList.remove('is-error');
		}).catch(function (error) {
			console.error('Unable to copy item collection declarations.', error);
			copyStatus.textContent = window.I18n.t('tools.generator.copyError');
			copyStatus.hidden = false;
			copyStatus.classList.add('is-error');
		});
	});

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
		var dataProviderSize = 2 + (23 + valueLength + textLength) * count;
		updateDeclarations(valueLength, textLength, count, dataProviderSize);
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
		var output = prefix + entries + ']}';
		setGeneratedText(output);
		var elementFixedChars = ',{"index":}'.length + flags.length;
		var fixedChars = prefix.length + 2;
		var configurationSize = fixedChars + (elementFixedChars + indexLength) * count;
		updateTableDeclarations(type, indexLength, count, elementFixedChars, fixedChars, configurationSize);
	});

	updateCount();
})();
