/**
 * Parser zdrojových dat testu NV194 (data/otazky.txt).
 *
 * Formát zdrojového souboru:
 *   # Název kapitoly        -> začátek nové kapitoly
 *   123. Text otázky        -> začátek otázky (číslo + tečka)
 *   a) text odpovědi        -> odpověď (a / b / c)
 *   správně: [a, c]         -> seznam správných odpovědí, ukončuje otázku
 *   [obr. 12.png]           -> odkaz na obrázek, může být kdekoli v textu
 *
 * Parser nepracuje s prázdnými řádky jako oddělovačem - řídí se výhradně
 * strukturálními značkami výše. Prázdné řádky jsou ignorovány.
 *
 * Text otázek a odpovědí se nijak neupravuje. Odstraňuje se pouze strukturální
 * prefix ("123. ", "a) ") a bílé znaky na začátku/konci řádku.
 *
 * Modul funguje jako UMD - v prohlížeči se vystaví jako window.NV194Parser,
 * v Node.js jako module.exports.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NV194Parser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CHAPTER_LINE = /^#\s*([\s\S]*)$/;
  var QUESTION_LINE = /^(\d+)\.(?=\s|$)\s*([\s\S]*)$/;
  var ANSWER_LINE = /^([a-c])\)\s*([\s\S]*)$/;
  var CORRECT_LINE = /^správně\s*:\s*\[([^\]]*)\]\s*$/i;
  var CORRECT_LINE_LOOSE = /^správně\s*:/i;

  /** Platný odkaz na obrázek, např. "[obr. 12.png]". */
  var IMAGE_TOKEN = /\[obr\.\s*([^\]]*?)\s*\]/g;
  /** Volnější vzor pro odhalení překlepů v zápisu odkazu, např. "[obr 12.png]". */
  var IMAGE_TOKEN_LOOSE = /\[\s*obr[^\]]*\]/gi;
  var IMAGE_FILENAME = /^[\w-]+\.(png|jpe?g|gif|webp|svg)$/i;

  var EXPECTED_LETTERS = ['a', 'b', 'c'];

  var ERROR_CODES = {
    ORPHAN_LINE: 'ORPHAN_LINE',
    ANSWER_WITHOUT_QUESTION: 'ANSWER_WITHOUT_QUESTION',
    CORRECT_WITHOUT_QUESTION: 'CORRECT_WITHOUT_QUESTION',
    MALFORMED_CORRECT_LINE: 'MALFORMED_CORRECT_LINE',
    DUPLICATE_CORRECT_LINE: 'DUPLICATE_CORRECT_LINE',
    ANSWER_AFTER_CORRECT: 'ANSWER_AFTER_CORRECT',
    STRAY_LINE_AFTER_CORRECT: 'STRAY_LINE_AFTER_CORRECT',
    DUPLICATE_ANSWER_LETTER: 'DUPLICATE_ANSWER_LETTER',
    UNEXPECTED_ANSWER_LETTER: 'UNEXPECTED_ANSWER_LETTER',
    ANSWER_COUNT: 'ANSWER_COUNT',
    EMPTY_QUESTION_TEXT: 'EMPTY_QUESTION_TEXT',
    EMPTY_ANSWER_TEXT: 'EMPTY_ANSWER_TEXT',
    MISSING_CORRECT: 'MISSING_CORRECT',
    EMPTY_CORRECT: 'EMPTY_CORRECT',
    INVALID_CORRECT_LETTER: 'INVALID_CORRECT_LETTER',
    DUPLICATE_CORRECT_LETTER: 'DUPLICATE_CORRECT_LETTER',
    CORRECT_WITHOUT_ANSWER: 'CORRECT_WITHOUT_ANSWER',
    DUPLICATE_QUESTION_ID: 'DUPLICATE_QUESTION_ID',
    QUESTION_WITHOUT_CHAPTER: 'QUESTION_WITHOUT_CHAPTER',
    EMPTY_CHAPTER_TITLE: 'EMPTY_CHAPTER_TITLE',
    INVALID_IMAGE_REF: 'INVALID_IMAGE_REF'
  };

  /**
   * Rozloží text na posloupnost uzlů typu text/obrázek, aby odkaz na obrázek
   * nezůstal obyčejným textem.
   *
   * @param {string} text
   * @param {number} line číslo řádku pro diagnostiku
   * @param {Array} errors výstupní pole chyb
   * @param {number|null} questionId
   * @returns {{nodes: Array, images: string[]}}
   */
  function parseContent(text, line, errors, questionId) {
    var nodes = [];
    var images = [];
    var lastIndex = 0;
    var match;

    IMAGE_TOKEN.lastIndex = 0;
    while ((match = IMAGE_TOKEN.exec(text)) !== null) {
      if (match.index > lastIndex) {
        pushTextNode(nodes, text.slice(lastIndex, match.index));
      }

      var src = match[1].trim();
      if (!IMAGE_FILENAME.test(src)) {
        errors.push(makeError(
          ERROR_CODES.INVALID_IMAGE_REF,
          'Odkaz na obrázek "' + match[0] + '" nemá platný název souboru.',
          line,
          questionId
        ));
      }

      nodes.push({ type: 'image', src: src, raw: match[0] });
      images.push(src);
      lastIndex = IMAGE_TOKEN.lastIndex;
    }

    if (lastIndex < text.length) {
      pushTextNode(nodes, text.slice(lastIndex));
    }

    reportMalformedImageRefs(text, images.length, line, errors, questionId);

    return { nodes: nodes, images: images };
  }

  function pushTextNode(nodes, value) {
    if (value.trim() === '') {
      return;
    }
    nodes.push({ type: 'text', value: value });
  }

  /**
   * Porovná počet korektně rozpoznaných odkazů s počtem všech závorek, které se
   * odkazu na obrázek podobají. Rozdíl znamená chybný zápis, který nesmí zapadnout.
   */
  function reportMalformedImageRefs(text, recognized, line, errors, questionId) {
    var loose = text.match(IMAGE_TOKEN_LOOSE);
    var looseCount = loose ? loose.length : 0;
    if (looseCount <= recognized) {
      return;
    }
    errors.push(makeError(
      ERROR_CODES.INVALID_IMAGE_REF,
      'Řádek obsahuje zápis připomínající odkaz na obrázek, který neodpovídá formátu "[obr. soubor.png]": ' +
        loose.join(', '),
      line,
      questionId
    ));
  }

  function makeError(code, message, line, questionId) {
    return {
      code: code,
      message: message,
      line: line,
      questionId: typeof questionId === 'number' ? questionId : null
    };
  }

  /**
   * Načte strukturovaný datový model z textu zdrojového souboru.
   *
   * @param {string} source obsah souboru otazky.txt
   * @returns {{questions: Array, chapters: Array, errors: Array, stats: Object}}
   */
  function parseNV194(source) {
    var lines = String(source).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    var questions = [];
    var chapters = [];
    var errors = [];
    var seenIds = Object.create(null);

    var currentChapter = null;
    var draft = null;

    function finalizeDraft() {
      if (draft === null) {
        return;
      }
      questions.push(buildQuestion(draft, errors, seenIds));
      draft = null;
    }

    for (var i = 0; i < lines.length; i++) {
      var lineNo = i + 1;
      var line = lines[i].trim();

      if (line === '') {
        continue;
      }

      var chapterMatch = CHAPTER_LINE.exec(line);
      if (chapterMatch) {
        finalizeDraft();
        var title = chapterMatch[1].trim();
        if (title === '') {
          errors.push(makeError(
            ERROR_CODES.EMPTY_CHAPTER_TITLE,
            'Kapitola nemá název.',
            lineNo,
            null
          ));
        }
        currentChapter = {
          index: chapters.length,
          title: title,
          line: lineNo,
          questionIds: []
        };
        chapters.push(currentChapter);
        continue;
      }

      // Číslovaný řádek vždy zahajuje novou otázku. Pokud předchozí otázka ještě
      // nebyla uzavřena řádkem "správně:", ohlásí se to při jejím uzavření jako
      // chyba - dvě otázky se nikdy tiše nesloučí.
      var questionMatch = QUESTION_LINE.exec(line);
      if (questionMatch) {
        finalizeDraft();
        draft = createDraft(Number(questionMatch[1]), questionMatch[2], lineNo, currentChapter);
        if (currentChapter === null) {
          errors.push(makeError(
            ERROR_CODES.QUESTION_WITHOUT_CHAPTER,
            'Otázka není uvedena pod žádnou kapitolou.',
            lineNo,
            draft.id
          ));
        } else {
          currentChapter.questionIds.push(draft.id);
        }
        continue;
      }

      if (draft === null) {
        errors.push(makeError(
          ERROR_CODES.ORPHAN_LINE,
          'Řádek nepatří k žádné otázce: "' + line + '"',
          lineNo,
          null
        ));
        continue;
      }

      var correctMatch = CORRECT_LINE.exec(line);
      if (correctMatch) {
        if (draft.correctLine !== null) {
          errors.push(makeError(
            ERROR_CODES.DUPLICATE_CORRECT_LINE,
            'Otázka obsahuje více řádků "správně:". Použit je první z nich (řádek ' + draft.correctLine + ').',
            lineNo,
            draft.id
          ));
          continue;
        }
        draft.correctRaw = correctMatch[1];
        draft.correctLine = lineNo;
        continue;
      }

      if (CORRECT_LINE_LOOSE.test(line)) {
        errors.push(makeError(
          ERROR_CODES.MALFORMED_CORRECT_LINE,
          'Řádek se správnými odpověďmi nemá tvar "správně: [a, b]": "' + line + '"',
          lineNo,
          draft.id
        ));
        continue;
      }

      var answerMatch = ANSWER_LINE.exec(line);
      if (answerMatch) {
        handleAnswerLine(draft, answerMatch[1], answerMatch[2], lineNo, errors);
        continue;
      }

      handleContinuationLine(draft, line, lineNo, errors);
    }

    finalizeDraft();

    chapters.forEach(function (chapter) {
      chapter.questionCount = chapter.questionIds.length;
    });

    return {
      questions: questions,
      chapters: chapters,
      errors: errors,
      stats: buildStats(questions, chapters, errors)
    };
  }

  function createDraft(id, text, lineNo, chapter) {
    return {
      id: id,
      line: lineNo,
      chapter: chapter,
      textParts: text.trim() === '' ? [] : [text],
      answers: [],
      answerIndex: Object.create(null),
      openAnswer: null,
      correctRaw: null,
      correctLine: null
    };
  }

  function handleAnswerLine(draft, letter, text, lineNo, errors) {
    if (draft.correctLine !== null) {
      errors.push(makeError(
        ERROR_CODES.ANSWER_AFTER_CORRECT,
        'Odpověď "' + letter + ')" je uvedena až za řádkem "správně:".',
        lineNo,
        draft.id
      ));
      return;
    }

    if (EXPECTED_LETTERS.indexOf(letter) === -1) {
      errors.push(makeError(
        ERROR_CODES.UNEXPECTED_ANSWER_LETTER,
        'Odpověď je označena písmenem "' + letter + '", povolena jsou pouze a/b/c.',
        lineNo,
        draft.id
      ));
      return;
    }

    if (draft.answerIndex[letter] !== undefined) {
      errors.push(makeError(
        ERROR_CODES.DUPLICATE_ANSWER_LETTER,
        'Odpověď "' + letter + ')" je uvedena vícekrát.',
        lineNo,
        draft.id
      ));
      return;
    }

    var answer = { letter: letter, line: lineNo, textParts: text.trim() === '' ? [] : [text] };
    draft.answers.push(answer);
    draft.answerIndex[letter] = answer;
    draft.openAnswer = answer;
  }

  /**
   * Řádek bez strukturální značky pokračuje v textu otázky nebo poslední odpovědi.
   * Díky tomu parser zvládne víceřádkové otázky i samostatný řádek s obrázkem
   * vložený mezi text otázky a odpovědi.
   */
  function handleContinuationLine(draft, line, lineNo, errors) {
    if (draft.correctLine !== null) {
      errors.push(makeError(
        ERROR_CODES.STRAY_LINE_AFTER_CORRECT,
        'Text za řádkem "správně:" nepatří k žádné otázce ani odpovědi: "' + line + '"',
        lineNo,
        draft.id
      ));
      return;
    }

    if (draft.openAnswer !== null) {
      draft.openAnswer.textParts.push(line);
      return;
    }

    draft.textParts.push(line);
  }

  function buildQuestion(draft, errors, seenIds) {
    var id = draft.id;

    if (seenIds[id] !== undefined) {
      errors.push(makeError(
        ERROR_CODES.DUPLICATE_QUESTION_ID,
        'Číslo otázky se opakuje, poprvé použito na řádku ' + seenIds[id] + '.',
        draft.line,
        id
      ));
    } else {
      seenIds[id] = draft.line;
    }

    var text = draft.textParts.join('\n').trim();
    if (text === '') {
      errors.push(makeError(
        ERROR_CODES.EMPTY_QUESTION_TEXT,
        'Otázka nemá žádný text.',
        draft.line,
        id
      ));
    }
    var questionContent = parseContent(text, draft.line, errors, id);

    var answers = draft.answers.map(function (answer) {
      var answerText = answer.textParts.join('\n').trim();
      if (answerText === '') {
        errors.push(makeError(
          ERROR_CODES.EMPTY_ANSWER_TEXT,
          'Odpověď "' + answer.letter + ')" nemá žádný text.',
          answer.line,
          id
        ));
      }
      var answerContent = parseContent(answerText, answer.line, errors, id);
      return {
        letter: answer.letter,
        text: answerText,
        content: answerContent.nodes,
        images: answerContent.images,
        hasImages: answerContent.images.length > 0,
        isCorrect: false,
        line: answer.line
      };
    });

    validateAnswerSet(answers, draft, errors);

    var correctAnswers = resolveCorrectAnswers(draft, answers, errors);
    correctAnswers.forEach(function (letter) {
      var answer = answers.filter(function (item) { return item.letter === letter; })[0];
      if (answer) {
        answer.isCorrect = true;
      }
    });

    var images = questionContent.images.slice();
    answers.forEach(function (answer) {
      images = images.concat(answer.images);
    });

    return {
      id: id,
      line: draft.line,
      chapter: draft.chapter ? draft.chapter.title : null,
      chapterIndex: draft.chapter ? draft.chapter.index : null,
      text: text,
      content: questionContent.nodes,
      images: images,
      hasImages: images.length > 0,
      answers: answers,
      correctAnswers: correctAnswers,
      correctCount: correctAnswers.length
    };
  }

  function validateAnswerSet(answers, draft, errors) {
    var letters = answers.map(function (answer) { return answer.letter; });
    var missing = EXPECTED_LETTERS.filter(function (letter) {
      return letters.indexOf(letter) === -1;
    });

    if (answers.length !== EXPECTED_LETTERS.length || missing.length > 0) {
      errors.push(makeError(
        ERROR_CODES.ANSWER_COUNT,
        'Otázka má ' + answers.length + ' odpovědí (' + (letters.join(', ') || 'žádná') +
          '), očekávány jsou právě tři: a, b, c.',
        draft.line,
        draft.id
      ));
    }
  }

  function resolveCorrectAnswers(draft, answers, errors) {
    if (draft.correctLine === null) {
      errors.push(makeError(
        ERROR_CODES.MISSING_CORRECT,
        'Otázka nemá řádek "správně: [...]" se správnými odpověďmi.',
        draft.line,
        draft.id
      ));
      return [];
    }

    var tokens = draft.correctRaw.split(',').map(function (token) {
      return token.trim();
    }).filter(function (token) {
      return token !== '';
    });

    if (tokens.length === 0) {
      errors.push(makeError(
        ERROR_CODES.EMPTY_CORRECT,
        'Řádek "správně:" neobsahuje žádnou odpověď.',
        draft.correctLine,
        draft.id
      ));
      return [];
    }

    var result = [];
    tokens.forEach(function (token) {
      var letter = token.toLowerCase();

      if (EXPECTED_LETTERS.indexOf(letter) === -1) {
        errors.push(makeError(
          ERROR_CODES.INVALID_CORRECT_LETTER,
          'Správná odpověď "' + token + '" není a/b/c.',
          draft.correctLine,
          draft.id
        ));
        return;
      }

      if (result.indexOf(letter) !== -1) {
        errors.push(makeError(
          ERROR_CODES.DUPLICATE_CORRECT_LETTER,
          'Správná odpověď "' + letter + '" je uvedena vícekrát.',
          draft.correctLine,
          draft.id
        ));
        return;
      }

      var exists = answers.some(function (answer) { return answer.letter === letter; });
      if (!exists) {
        errors.push(makeError(
          ERROR_CODES.CORRECT_WITHOUT_ANSWER,
          'Správná odpověď "' + letter + '" odkazuje na odpověď, která u otázky není.',
          draft.correctLine,
          draft.id
        ));
        return;
      }

      result.push(letter);
    });

    return result;
  }

  function buildStats(questions, chapters, errors) {
    var byCorrectCount = { 1: 0, 2: 0, 3: 0 };
    var imageRefs = 0;
    var uniqueImages = Object.create(null);
    var questionsWithImages = 0;
    var ids = [];

    questions.forEach(function (question) {
      var count = question.correctAnswers.length;
      byCorrectCount[count] = (byCorrectCount[count] || 0) + 1;

      imageRefs += question.images.length;
      question.images.forEach(function (src) { uniqueImages[src] = true; });
      if (question.hasImages) {
        questionsWithImages++;
      }
      ids.push(question.id);
    });

    var sortedIds = ids.slice().sort(function (a, b) { return a - b; });
    var minId = sortedIds.length ? sortedIds[0] : null;
    var maxId = sortedIds.length ? sortedIds[sortedIds.length - 1] : null;
    var idSet = Object.create(null);
    ids.forEach(function (id) { idSet[id] = true; });

    var missingIds = [];
    if (minId !== null) {
      for (var id = minId; id <= maxId; id++) {
        if (!idSet[id]) {
          missingIds.push(id);
        }
      }
    }

    return {
      questionCount: questions.length,
      chapterCount: chapters.length,
      minId: minId,
      maxId: maxId,
      missingIds: missingIds,
      byCorrectCount: byCorrectCount,
      imageRefCount: imageRefs,
      uniqueImages: Object.keys(uniqueImages).sort(compareImageNames),
      uniqueImageCount: Object.keys(uniqueImages).length,
      questionsWithImages: questionsWithImages,
      errorCount: errors.length
    };
  }

  function compareImageNames(a, b) {
    var na = parseInt(a, 10);
    var nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) {
      return na - nb;
    }
    return a < b ? -1 : (a > b ? 1 : 0);
  }

  return {
    parseNV194: parseNV194,
    ERROR_CODES: ERROR_CODES
  };
});
