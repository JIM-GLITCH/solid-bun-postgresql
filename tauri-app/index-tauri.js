var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// ../node_modules/moo/moo.js
var require_moo = __commonJS((exports, module) => {
  (function(root, factory) {
    if (typeof define === "function" && define.amd) {
      define([], factory);
    } else if (typeof module === "object" && module.exports) {
      module.exports = factory();
    } else {
      root.moo = factory();
    }
  })(exports, function() {
    var hasOwnProperty = Object.prototype.hasOwnProperty;
    var toString = Object.prototype.toString;
    var hasSticky = typeof new RegExp().sticky === "boolean";
    function isRegExp(o) {
      return o && toString.call(o) === "[object RegExp]";
    }
    function isObject(o) {
      return o && typeof o === "object" && !isRegExp(o) && !Array.isArray(o);
    }
    function reEscape(s) {
      return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    }
    function reGroups(s) {
      var re = new RegExp("|" + s);
      return re.exec("").length - 1;
    }
    function reCapture(s) {
      return "(" + s + ")";
    }
    function reUnion(regexps) {
      if (!regexps.length)
        return "(?!)";
      var source = regexps.map(function(s) {
        return "(?:" + s + ")";
      }).join("|");
      return "(?:" + source + ")";
    }
    function regexpOrLiteral(obj) {
      if (typeof obj === "string") {
        return "(?:" + reEscape(obj) + ")";
      } else if (isRegExp(obj)) {
        if (obj.ignoreCase)
          throw new Error("RegExp /i flag not allowed");
        if (obj.global)
          throw new Error("RegExp /g flag is implied");
        if (obj.sticky)
          throw new Error("RegExp /y flag is implied");
        if (obj.multiline)
          throw new Error("RegExp /m flag is implied");
        return obj.source;
      } else {
        throw new Error("Not a pattern: " + obj);
      }
    }
    function pad(s, length) {
      if (s.length > length) {
        return s;
      }
      return Array(length - s.length + 1).join(" ") + s;
    }
    function lastNLines(string2, numLines) {
      var position = string2.length;
      var lineBreaks = 0;
      while (true) {
        var idx = string2.lastIndexOf(`
`, position - 1);
        if (idx === -1) {
          break;
        } else {
          lineBreaks++;
        }
        position = idx;
        if (lineBreaks === numLines) {
          break;
        }
        if (position === 0) {
          break;
        }
      }
      var startPosition = lineBreaks < numLines ? 0 : position + 1;
      return string2.substring(startPosition).split(`
`);
    }
    function objectToRules(object) {
      var keys = Object.getOwnPropertyNames(object);
      var result = [];
      for (var i = 0;i < keys.length; i++) {
        var key = keys[i];
        var thing = object[key];
        var rules = [].concat(thing);
        if (key === "include") {
          for (var j = 0;j < rules.length; j++) {
            result.push({ include: rules[j] });
          }
          continue;
        }
        var match = [];
        rules.forEach(function(rule) {
          if (isObject(rule)) {
            if (match.length)
              result.push(ruleOptions(key, match));
            result.push(ruleOptions(key, rule));
            match = [];
          } else {
            match.push(rule);
          }
        });
        if (match.length)
          result.push(ruleOptions(key, match));
      }
      return result;
    }
    function arrayToRules(array) {
      var result = [];
      for (var i = 0;i < array.length; i++) {
        var obj = array[i];
        if (obj.include) {
          var include = [].concat(obj.include);
          for (var j = 0;j < include.length; j++) {
            result.push({ include: include[j] });
          }
          continue;
        }
        if (!obj.type) {
          throw new Error("Rule has no type: " + JSON.stringify(obj));
        }
        result.push(ruleOptions(obj.type, obj));
      }
      return result;
    }
    function ruleOptions(type, obj) {
      if (!isObject(obj)) {
        obj = { match: obj };
      }
      if (obj.include) {
        throw new Error("Matching rules cannot also include states");
      }
      var options = {
        defaultType: type,
        lineBreaks: !!obj.error || !!obj.fallback,
        pop: false,
        next: null,
        push: null,
        error: false,
        fallback: false,
        value: null,
        type: null,
        shouldThrow: false
      };
      for (var key in obj) {
        if (hasOwnProperty.call(obj, key)) {
          options[key] = obj[key];
        }
      }
      if (typeof options.type === "string" && type !== options.type) {
        throw new Error("Type transform cannot be a string (type '" + options.type + "' for token '" + type + "')");
      }
      var match = options.match;
      options.match = Array.isArray(match) ? match : match ? [match] : [];
      options.match.sort(function(a, b) {
        return isRegExp(a) && isRegExp(b) ? 0 : isRegExp(b) ? -1 : isRegExp(a) ? 1 : b.length - a.length;
      });
      return options;
    }
    function toRules(spec) {
      return Array.isArray(spec) ? arrayToRules(spec) : objectToRules(spec);
    }
    var defaultErrorRule = ruleOptions("error", { lineBreaks: true, shouldThrow: true });
    function compileRules(rules, hasStates) {
      var errorRule = null;
      var fast = Object.create(null);
      var fastAllowed = true;
      var unicodeFlag = null;
      var groups = [];
      var parts = [];
      for (var i = 0;i < rules.length; i++) {
        if (rules[i].fallback) {
          fastAllowed = false;
        }
      }
      for (var i = 0;i < rules.length; i++) {
        var options = rules[i];
        if (options.include) {
          throw new Error("Inheritance is not allowed in stateless lexers");
        }
        if (options.error || options.fallback) {
          if (errorRule) {
            if (!options.fallback === !errorRule.fallback) {
              throw new Error("Multiple " + (options.fallback ? "fallback" : "error") + " rules not allowed (for token '" + options.defaultType + "')");
            } else {
              throw new Error("fallback and error are mutually exclusive (for token '" + options.defaultType + "')");
            }
          }
          errorRule = options;
        }
        var match = options.match.slice();
        if (fastAllowed) {
          while (match.length && typeof match[0] === "string" && match[0].length === 1) {
            var word2 = match.shift();
            fast[word2.charCodeAt(0)] = options;
          }
        }
        if (options.pop || options.push || options.next) {
          if (!hasStates) {
            throw new Error("State-switching options are not allowed in stateless lexers (for token '" + options.defaultType + "')");
          }
          if (options.fallback) {
            throw new Error("State-switching options are not allowed on fallback tokens (for token '" + options.defaultType + "')");
          }
        }
        if (match.length === 0) {
          continue;
        }
        fastAllowed = false;
        groups.push(options);
        for (var j = 0;j < match.length; j++) {
          var obj = match[j];
          if (!isRegExp(obj)) {
            continue;
          }
          if (unicodeFlag === null) {
            unicodeFlag = obj.unicode;
          } else if (unicodeFlag !== obj.unicode && options.fallback === false) {
            throw new Error("If one rule is /u then all must be");
          }
        }
        var pat = reUnion(match.map(regexpOrLiteral));
        var regexp = new RegExp(pat);
        if (regexp.test("")) {
          throw new Error("RegExp matches empty string: " + regexp);
        }
        var groupCount = reGroups(pat);
        if (groupCount > 0) {
          throw new Error("RegExp has capture groups: " + regexp + `
Use (?: … ) instead`);
        }
        if (!options.lineBreaks && regexp.test(`
`)) {
          throw new Error("Rule should declare lineBreaks: " + regexp);
        }
        parts.push(reCapture(pat));
      }
      var fallbackRule = errorRule && errorRule.fallback;
      var flags = hasSticky && !fallbackRule ? "ym" : "gm";
      var suffix = hasSticky || fallbackRule ? "" : "|";
      if (unicodeFlag === true)
        flags += "u";
      var combined = new RegExp(reUnion(parts) + suffix, flags);
      return { regexp: combined, groups, fast, error: errorRule || defaultErrorRule };
    }
    function compile(rules) {
      var result = compileRules(toRules(rules));
      return new Lexer({ start: result }, "start");
    }
    function checkStateGroup(g, name, map) {
      var state = g && (g.push || g.next);
      if (state && !map[state]) {
        throw new Error("Missing state '" + state + "' (in token '" + g.defaultType + "' of state '" + name + "')");
      }
      if (g && g.pop && +g.pop !== 1) {
        throw new Error("pop must be 1 (in token '" + g.defaultType + "' of state '" + name + "')");
      }
    }
    function compileStates(states, start) {
      var all = states.$all ? toRules(states.$all) : [];
      delete states.$all;
      var keys = Object.getOwnPropertyNames(states);
      if (!start)
        start = keys[0];
      var ruleMap = Object.create(null);
      for (var i = 0;i < keys.length; i++) {
        var key = keys[i];
        ruleMap[key] = toRules(states[key]).concat(all);
      }
      for (var i = 0;i < keys.length; i++) {
        var key = keys[i];
        var rules = ruleMap[key];
        var included = Object.create(null);
        for (var j = 0;j < rules.length; j++) {
          var rule = rules[j];
          if (!rule.include)
            continue;
          var splice = [j, 1];
          if (rule.include !== key && !included[rule.include]) {
            included[rule.include] = true;
            var newRules = ruleMap[rule.include];
            if (!newRules) {
              throw new Error("Cannot include nonexistent state '" + rule.include + "' (in state '" + key + "')");
            }
            for (var k = 0;k < newRules.length; k++) {
              var newRule = newRules[k];
              if (rules.indexOf(newRule) !== -1)
                continue;
              splice.push(newRule);
            }
          }
          rules.splice.apply(rules, splice);
          j--;
        }
      }
      var map = Object.create(null);
      for (var i = 0;i < keys.length; i++) {
        var key = keys[i];
        map[key] = compileRules(ruleMap[key], true);
      }
      for (var i = 0;i < keys.length; i++) {
        var name = keys[i];
        var state = map[name];
        var groups = state.groups;
        for (var j = 0;j < groups.length; j++) {
          checkStateGroup(groups[j], name, map);
        }
        var fastKeys = Object.getOwnPropertyNames(state.fast);
        for (var j = 0;j < fastKeys.length; j++) {
          checkStateGroup(state.fast[fastKeys[j]], name, map);
        }
      }
      return new Lexer(map, start);
    }
    function keywordTransform(map) {
      var isMap = typeof Map !== "undefined";
      var reverseMap = isMap ? new Map : Object.create(null);
      var types = Object.getOwnPropertyNames(map);
      for (var i = 0;i < types.length; i++) {
        var tokenType = types[i];
        var item = map[tokenType];
        var keywordList = Array.isArray(item) ? item : [item];
        keywordList.forEach(function(keyword) {
          if (typeof keyword !== "string") {
            throw new Error("keyword must be string (in keyword '" + tokenType + "')");
          }
          if (isMap) {
            reverseMap.set(keyword, tokenType);
          } else {
            reverseMap[keyword] = tokenType;
          }
        });
      }
      return function(k) {
        return isMap ? reverseMap.get(k) : reverseMap[k];
      };
    }
    var Lexer = function(states, state) {
      this.startState = state;
      this.states = states;
      this.buffer = "";
      this.stack = [];
      this.reset();
    };
    Lexer.prototype.reset = function(data, info) {
      this.buffer = data || "";
      this.index = 0;
      this.line = info ? info.line : 1;
      this.col = info ? info.col : 1;
      this.queuedToken = info ? info.queuedToken : null;
      this.queuedText = info ? info.queuedText : "";
      this.queuedThrow = info ? info.queuedThrow : null;
      this.setState(info ? info.state : this.startState);
      this.stack = info && info.stack ? info.stack.slice() : [];
      return this;
    };
    Lexer.prototype.save = function() {
      return {
        line: this.line,
        col: this.col,
        state: this.state,
        stack: this.stack.slice(),
        queuedToken: this.queuedToken,
        queuedText: this.queuedText,
        queuedThrow: this.queuedThrow
      };
    };
    Lexer.prototype.setState = function(state) {
      if (!state || this.state === state)
        return;
      this.state = state;
      var info = this.states[state];
      this.groups = info.groups;
      this.error = info.error;
      this.re = info.regexp;
      this.fast = info.fast;
    };
    Lexer.prototype.popState = function() {
      this.setState(this.stack.pop());
    };
    Lexer.prototype.pushState = function(state) {
      this.stack.push(this.state);
      this.setState(state);
    };
    var eat = hasSticky ? function(re, buffer) {
      return re.exec(buffer);
    } : function(re, buffer) {
      var match = re.exec(buffer);
      if (match[0].length === 0) {
        return null;
      }
      return match;
    };
    Lexer.prototype._getGroup = function(match) {
      var groupCount = this.groups.length;
      for (var i = 0;i < groupCount; i++) {
        if (match[i + 1] !== undefined) {
          return this.groups[i];
        }
      }
      throw new Error("Cannot find token type for matched text");
    };
    function tokenToString() {
      return this.value;
    }
    Lexer.prototype.next = function() {
      var index = this.index;
      if (this.queuedGroup) {
        var token = this._token(this.queuedGroup, this.queuedText, index);
        this.queuedGroup = null;
        this.queuedText = "";
        return token;
      }
      var buffer = this.buffer;
      if (index === buffer.length) {
        return;
      }
      var group = this.fast[buffer.charCodeAt(index)];
      if (group) {
        return this._token(group, buffer.charAt(index), index);
      }
      var re = this.re;
      re.lastIndex = index;
      var match = eat(re, buffer);
      var error = this.error;
      if (match == null) {
        return this._token(error, buffer.slice(index, buffer.length), index);
      }
      var group = this._getGroup(match);
      var text = match[0];
      if (error.fallback && match.index !== index) {
        this.queuedGroup = group;
        this.queuedText = text;
        return this._token(error, buffer.slice(index, match.index), index);
      }
      return this._token(group, text, index);
    };
    Lexer.prototype._token = function(group, text, offset) {
      var lineBreaks = 0;
      if (group.lineBreaks) {
        var matchNL = /\n/g;
        var nl = 1;
        if (text === `
`) {
          lineBreaks = 1;
        } else {
          while (matchNL.exec(text)) {
            lineBreaks++;
            nl = matchNL.lastIndex;
          }
        }
      }
      var token = {
        type: typeof group.type === "function" && group.type(text) || group.defaultType,
        value: typeof group.value === "function" ? group.value(text) : text,
        text,
        toString: tokenToString,
        offset,
        lineBreaks,
        line: this.line,
        col: this.col
      };
      var size = text.length;
      this.index += size;
      this.line += lineBreaks;
      if (lineBreaks !== 0) {
        this.col = size - nl + 1;
      } else {
        this.col += size;
      }
      if (group.shouldThrow) {
        var err = new Error(this.formatError(token, "invalid syntax"));
        throw err;
      }
      if (group.pop)
        this.popState();
      else if (group.push)
        this.pushState(group.push);
      else if (group.next)
        this.setState(group.next);
      return token;
    };
    if (typeof Symbol !== "undefined" && Symbol.iterator) {
      var LexerIterator = function(lexer) {
        this.lexer = lexer;
      };
      LexerIterator.prototype.next = function() {
        var token = this.lexer.next();
        return { value: token, done: !token };
      };
      LexerIterator.prototype[Symbol.iterator] = function() {
        return this;
      };
      Lexer.prototype[Symbol.iterator] = function() {
        return new LexerIterator(this);
      };
    }
    Lexer.prototype.formatError = function(token, message) {
      if (token == null) {
        var text = this.buffer.slice(this.index);
        var token = {
          text,
          offset: this.index,
          lineBreaks: text.indexOf(`
`) === -1 ? 0 : 1,
          line: this.line,
          col: this.col
        };
      }
      var numLinesAround = 2;
      var firstDisplayedLine = Math.max(token.line - numLinesAround, 1);
      var lastDisplayedLine = token.line + numLinesAround;
      var lastLineDigits = String(lastDisplayedLine).length;
      var displayedLines = lastNLines(this.buffer, this.line - token.line + numLinesAround + 1).slice(0, 5);
      var errorLines = [];
      errorLines.push(message + " at line " + token.line + " col " + token.col + ":");
      errorLines.push("");
      for (var i = 0;i < displayedLines.length; i++) {
        var line = displayedLines[i];
        var lineNo = firstDisplayedLine + i;
        errorLines.push(pad(String(lineNo), lastLineDigits) + "  " + line);
        if (lineNo === token.line) {
          errorLines.push(pad("", lastLineDigits + token.col + 1) + "^");
        }
      }
      return errorLines.join(`
`);
    };
    Lexer.prototype.clone = function() {
      return new Lexer(this.states, this.state);
    };
    Lexer.prototype.has = function(tokenType) {
      return true;
    };
    return {
      compile,
      states: compileStates,
      error: Object.freeze({ error: true }),
      fallback: Object.freeze({ fallback: true }),
      keywords: keywordTransform
    };
  });
});

// ../node_modules/nearley/lib/nearley.js
var require_nearley = __commonJS((exports, module) => {
  (function(root, factory) {
    if (typeof module === "object" && module.exports) {
      module.exports = factory();
    } else {
      root.nearley = factory();
    }
  })(exports, function() {
    function Rule(name, symbols, postprocess) {
      this.id = ++Rule.highestId;
      this.name = name;
      this.symbols = symbols;
      this.postprocess = postprocess;
      return this;
    }
    Rule.highestId = 0;
    Rule.prototype.toString = function(withCursorAt) {
      var symbolSequence = typeof withCursorAt === "undefined" ? this.symbols.map(getSymbolShortDisplay).join(" ") : this.symbols.slice(0, withCursorAt).map(getSymbolShortDisplay).join(" ") + " ● " + this.symbols.slice(withCursorAt).map(getSymbolShortDisplay).join(" ");
      return this.name + " → " + symbolSequence;
    };
    function State(rule, dot2, reference, wantedBy) {
      this.rule = rule;
      this.dot = dot2;
      this.reference = reference;
      this.data = [];
      this.wantedBy = wantedBy;
      this.isComplete = this.dot === rule.symbols.length;
    }
    State.prototype.toString = function() {
      return "{" + this.rule.toString(this.dot) + "}, from: " + (this.reference || 0);
    };
    State.prototype.nextState = function(child) {
      var state = new State(this.rule, this.dot + 1, this.reference, this.wantedBy);
      state.left = this;
      state.right = child;
      if (state.isComplete) {
        state.data = state.build();
        state.right = undefined;
      }
      return state;
    };
    State.prototype.build = function() {
      var children2 = [];
      var node = this;
      do {
        children2.push(node.right.data);
        node = node.left;
      } while (node.left);
      children2.reverse();
      return children2;
    };
    State.prototype.finish = function() {
      if (this.rule.postprocess) {
        this.data = this.rule.postprocess(this.data, this.reference, Parser.fail);
      }
    };
    function Column(grammar, index) {
      this.grammar = grammar;
      this.index = index;
      this.states = [];
      this.wants = {};
      this.scannable = [];
      this.completed = {};
    }
    Column.prototype.process = function(nextColumn) {
      var states = this.states;
      var wants = this.wants;
      var completed = this.completed;
      for (var w = 0;w < states.length; w++) {
        var state = states[w];
        if (state.isComplete) {
          state.finish();
          if (state.data !== Parser.fail) {
            var wantedBy = state.wantedBy;
            for (var i = wantedBy.length;i--; ) {
              var left = wantedBy[i];
              this.complete(left, state);
            }
            if (state.reference === this.index) {
              var exp = state.rule.name;
              (this.completed[exp] = this.completed[exp] || []).push(state);
            }
          }
        } else {
          var exp = state.rule.symbols[state.dot];
          if (typeof exp !== "string") {
            this.scannable.push(state);
            continue;
          }
          if (wants[exp]) {
            wants[exp].push(state);
            if (completed.hasOwnProperty(exp)) {
              var nulls = completed[exp];
              for (var i = 0;i < nulls.length; i++) {
                var right = nulls[i];
                this.complete(state, right);
              }
            }
          } else {
            wants[exp] = [state];
            this.predict(exp);
          }
        }
      }
    };
    Column.prototype.predict = function(exp) {
      var rules = this.grammar.byName[exp] || [];
      for (var i = 0;i < rules.length; i++) {
        var r = rules[i];
        var wantedBy = this.wants[exp];
        var s = new State(r, 0, this.index, wantedBy);
        this.states.push(s);
      }
    };
    Column.prototype.complete = function(left, right) {
      var copy = left.nextState(right);
      this.states.push(copy);
    };
    function Grammar(rules, start) {
      this.rules = rules;
      this.start = start || this.rules[0].name;
      var byName = this.byName = {};
      this.rules.forEach(function(rule) {
        if (!byName.hasOwnProperty(rule.name)) {
          byName[rule.name] = [];
        }
        byName[rule.name].push(rule);
      });
    }
    Grammar.fromCompiled = function(rules, start) {
      var lexer = rules.Lexer;
      if (rules.ParserStart) {
        start = rules.ParserStart;
        rules = rules.ParserRules;
      }
      var rules = rules.map(function(r) {
        return new Rule(r.name, r.symbols, r.postprocess);
      });
      var g = new Grammar(rules, start);
      g.lexer = lexer;
      return g;
    };
    function StreamLexer() {
      this.reset("");
    }
    StreamLexer.prototype.reset = function(data, state) {
      this.buffer = data;
      this.index = 0;
      this.line = state ? state.line : 1;
      this.lastLineBreak = state ? -state.col : 0;
    };
    StreamLexer.prototype.next = function() {
      if (this.index < this.buffer.length) {
        var ch = this.buffer[this.index++];
        if (ch === `
`) {
          this.line += 1;
          this.lastLineBreak = this.index;
        }
        return { value: ch };
      }
    };
    StreamLexer.prototype.save = function() {
      return {
        line: this.line,
        col: this.index - this.lastLineBreak
      };
    };
    StreamLexer.prototype.formatError = function(token, message) {
      var buffer = this.buffer;
      if (typeof buffer === "string") {
        var lines = buffer.split(`
`).slice(Math.max(0, this.line - 5), this.line);
        var nextLineBreak = buffer.indexOf(`
`, this.index);
        if (nextLineBreak === -1)
          nextLineBreak = buffer.length;
        var col = this.index - this.lastLineBreak;
        var lastLineDigits = String(this.line).length;
        message += " at line " + this.line + " col " + col + `:

`;
        message += lines.map(function(line, i) {
          return pad(this.line - lines.length + i + 1, lastLineDigits) + " " + line;
        }, this).join(`
`);
        message += `
` + pad("", lastLineDigits + col) + `^
`;
        return message;
      } else {
        return message + " at index " + (this.index - 1);
      }
      function pad(n, length) {
        var s = String(n);
        return Array(length - s.length + 1).join(" ") + s;
      }
    };
    function Parser(rules, start, options) {
      if (rules instanceof Grammar) {
        var grammar = rules;
        var options = start;
      } else {
        var grammar = Grammar.fromCompiled(rules, start);
      }
      this.grammar = grammar;
      this.options = {
        keepHistory: false,
        lexer: grammar.lexer || new StreamLexer
      };
      for (var key in options || {}) {
        this.options[key] = options[key];
      }
      this.lexer = this.options.lexer;
      this.lexerState = undefined;
      var column = new Column(grammar, 0);
      var table = this.table = [column];
      column.wants[grammar.start] = [];
      column.predict(grammar.start);
      column.process();
      this.current = 0;
    }
    Parser.fail = {};
    Parser.prototype.feed = function(chunk) {
      var lexer = this.lexer;
      lexer.reset(chunk, this.lexerState);
      var token;
      while (true) {
        try {
          token = lexer.next();
          if (!token) {
            break;
          }
        } catch (e) {
          var nextColumn = new Column(this.grammar, this.current + 1);
          this.table.push(nextColumn);
          var err = new Error(this.reportLexerError(e));
          err.offset = this.current;
          err.token = e.token;
          throw err;
        }
        var column = this.table[this.current];
        if (!this.options.keepHistory) {
          delete this.table[this.current - 1];
        }
        var n = this.current + 1;
        var nextColumn = new Column(this.grammar, n);
        this.table.push(nextColumn);
        var literal = token.text !== undefined ? token.text : token.value;
        var value2 = lexer.constructor === StreamLexer ? token.value : token;
        var scannable = column.scannable;
        for (var w = scannable.length;w--; ) {
          var state = scannable[w];
          var expect = state.rule.symbols[state.dot];
          if (expect.test ? expect.test(value2) : expect.type ? expect.type === token.type : expect.literal === literal) {
            var next = state.nextState({ data: value2, token, isToken: true, reference: n - 1 });
            nextColumn.states.push(next);
          }
        }
        nextColumn.process();
        if (nextColumn.states.length === 0) {
          var err = new Error(this.reportError(token));
          err.offset = this.current;
          err.token = token;
          throw err;
        }
        if (this.options.keepHistory) {
          column.lexerState = lexer.save();
        }
        this.current++;
      }
      if (column) {
        this.lexerState = lexer.save();
      }
      this.results = this.finish();
      return this;
    };
    Parser.prototype.reportLexerError = function(lexerError) {
      var tokenDisplay, lexerMessage;
      var token = lexerError.token;
      if (token) {
        tokenDisplay = "input " + JSON.stringify(token.text[0]) + " (lexer error)";
        lexerMessage = this.lexer.formatError(token, "Syntax error");
      } else {
        tokenDisplay = "input (lexer error)";
        lexerMessage = lexerError.message;
      }
      return this.reportErrorCommon(lexerMessage, tokenDisplay);
    };
    Parser.prototype.reportError = function(token) {
      var tokenDisplay = (token.type ? token.type + " token: " : "") + JSON.stringify(token.value !== undefined ? token.value : token);
      var lexerMessage = this.lexer.formatError(token, "Syntax error");
      return this.reportErrorCommon(lexerMessage, tokenDisplay);
    };
    Parser.prototype.reportErrorCommon = function(lexerMessage, tokenDisplay) {
      var lines = [];
      lines.push(lexerMessage);
      var lastColumnIndex = this.table.length - 2;
      var lastColumn = this.table[lastColumnIndex];
      var expectantStates = lastColumn.states.filter(function(state) {
        var nextSymbol = state.rule.symbols[state.dot];
        return nextSymbol && typeof nextSymbol !== "string";
      });
      if (expectantStates.length === 0) {
        lines.push("Unexpected " + tokenDisplay + `. I did not expect any more input. Here is the state of my parse table:
`);
        this.displayStateStack(lastColumn.states, lines);
      } else {
        lines.push("Unexpected " + tokenDisplay + `. Instead, I was expecting to see one of the following:
`);
        var stateStacks = expectantStates.map(function(state) {
          return this.buildFirstStateStack(state, []) || [state];
        }, this);
        stateStacks.forEach(function(stateStack) {
          var state = stateStack[0];
          var nextSymbol = state.rule.symbols[state.dot];
          var symbolDisplay = this.getSymbolDisplay(nextSymbol);
          lines.push("A " + symbolDisplay + " based on:");
          this.displayStateStack(stateStack, lines);
        }, this);
      }
      lines.push("");
      return lines.join(`
`);
    };
    Parser.prototype.displayStateStack = function(stateStack, lines) {
      var lastDisplay;
      var sameDisplayCount = 0;
      for (var j = 0;j < stateStack.length; j++) {
        var state = stateStack[j];
        var display = state.rule.toString(state.dot);
        if (display === lastDisplay) {
          sameDisplayCount++;
        } else {
          if (sameDisplayCount > 0) {
            lines.push("    ^ " + sameDisplayCount + " more lines identical to this");
          }
          sameDisplayCount = 0;
          lines.push("    " + display);
        }
        lastDisplay = display;
      }
    };
    Parser.prototype.getSymbolDisplay = function(symbol) {
      return getSymbolLongDisplay(symbol);
    };
    Parser.prototype.buildFirstStateStack = function(state, visited) {
      if (visited.indexOf(state) !== -1) {
        return null;
      }
      if (state.wantedBy.length === 0) {
        return [state];
      }
      var prevState = state.wantedBy[0];
      var childVisited = [state].concat(visited);
      var childResult = this.buildFirstStateStack(prevState, childVisited);
      if (childResult === null) {
        return null;
      }
      return [state].concat(childResult);
    };
    Parser.prototype.save = function() {
      var column = this.table[this.current];
      column.lexerState = this.lexerState;
      return column;
    };
    Parser.prototype.restore = function(column) {
      var index = column.index;
      this.current = index;
      this.table[index] = column;
      this.table.splice(index + 1);
      this.lexerState = column.lexerState;
      this.results = this.finish();
    };
    Parser.prototype.rewind = function(index) {
      if (!this.options.keepHistory) {
        throw new Error("set option `keepHistory` to enable rewinding");
      }
      this.restore(this.table[index]);
    };
    Parser.prototype.finish = function() {
      var considerations = [];
      var start = this.grammar.start;
      var column = this.table[this.table.length - 1];
      column.states.forEach(function(t) {
        if (t.rule.name === start && t.dot === t.rule.symbols.length && t.reference === 0 && t.data !== Parser.fail) {
          considerations.push(t);
        }
      });
      return considerations.map(function(c) {
        return c.data;
      });
    };
    function getSymbolLongDisplay(symbol) {
      var type = typeof symbol;
      if (type === "string") {
        return symbol;
      } else if (type === "object") {
        if (symbol.literal) {
          return JSON.stringify(symbol.literal);
        } else if (symbol instanceof RegExp) {
          return "character matching " + symbol;
        } else if (symbol.type) {
          return symbol.type + " token";
        } else if (symbol.test) {
          return "token matching " + String(symbol.test);
        } else {
          throw new Error("Unknown symbol type: " + symbol);
        }
      }
    }
    function getSymbolShortDisplay(symbol) {
      var type = typeof symbol;
      if (type === "string") {
        return symbol;
      } else if (type === "object") {
        if (symbol.literal) {
          return JSON.stringify(symbol.literal);
        } else if (symbol instanceof RegExp) {
          return symbol.toString();
        } else if (symbol.type) {
          return "%" + symbol.type;
        } else if (symbol.test) {
          return "<" + String(symbol.test) + ">";
        } else {
          throw new Error("Unknown symbol type: " + symbol);
        }
      }
    }
    return {
      Parser,
      Grammar,
      Rule
    };
  });
});

// ../node_modules/pgsql-ast-parser/index.js
var require_pgsql_ast_parser = __commonJS((exports) => {
  (function(e, a) {
    for (var i in a)
      e[i] = a[i];
  })(exports, function(modules) {
    var installedModules = {};
    function __webpack_require__(moduleId) {
      if (installedModules[moduleId]) {
        return installedModules[moduleId].exports;
      }
      var module2 = installedModules[moduleId] = {
        i: moduleId,
        l: false,
        exports: {}
      };
      modules[moduleId].call(module2.exports, module2, module2.exports, __webpack_require__);
      module2.l = true;
      return module2.exports;
    }
    __webpack_require__.m = modules;
    __webpack_require__.c = installedModules;
    __webpack_require__.d = function(exports2, name, getter) {
      if (!__webpack_require__.o(exports2, name)) {
        Object.defineProperty(exports2, name, { enumerable: true, get: getter });
      }
    };
    __webpack_require__.r = function(exports2) {
      if (typeof Symbol !== "undefined" && Symbol.toStringTag) {
        Object.defineProperty(exports2, Symbol.toStringTag, { value: "Module" });
      }
      Object.defineProperty(exports2, "__esModule", { value: true });
    };
    __webpack_require__.t = function(value2, mode) {
      if (mode & 1)
        value2 = __webpack_require__(value2);
      if (mode & 8)
        return value2;
      if (mode & 4 && typeof value2 === "object" && value2 && value2.__esModule)
        return value2;
      var ns = Object.create(null);
      __webpack_require__.r(ns);
      Object.defineProperty(ns, "default", { enumerable: true, value: value2 });
      if (mode & 2 && typeof value2 != "string")
        for (var key in value2)
          __webpack_require__.d(ns, key, function(key2) {
            return value2[key2];
          }.bind(null, key));
      return ns;
    };
    __webpack_require__.n = function(module2) {
      var getter = module2 && module2.__esModule ? function getDefault() {
        return module2["default"];
      } : function getModuleExports() {
        return module2;
      };
      __webpack_require__.d(getter, "a", getter);
      return getter;
    };
    __webpack_require__.o = function(object, property) {
      return Object.prototype.hasOwnProperty.call(object, property);
    };
    __webpack_require__.p = "";
    return __webpack_require__(__webpack_require__.s = 7);
  }([
    function(module2, exports2) {
      module2.exports = require_moo();
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.unbox = exports2.doubleQuoted = exports2.box = exports2.track = exports2.tracking = exports2.trackingComments = exports2.lexerAny = exports2.lexer = undefined;
      const moo_1 = __webpack_require__(0);
      const keywords_1 = __webpack_require__(3);
      const keywordsMap = {};
      for (const k of keywords_1.sqlKeywords) {
        keywordsMap["kw_" + k.toLowerCase()] = k;
      }
      const caseInsensitiveKeywords = (map) => {
        const transform = (0, moo_1.keywords)(map);
        return (text) => transform(text.toUpperCase());
      };
      exports2.lexer = (0, moo_1.compile)({
        word: {
          match: /[eE](?!')[A-Za-z0-9_]*|[a-df-zA-DF-Z_][A-Za-z0-9_]*/,
          type: caseInsensitiveKeywords(keywordsMap),
          value: (x) => x.toLowerCase()
        },
        wordQuoted: {
          match: /"(?:[^"\*]|"")+"/,
          type: () => "quoted_word",
          value: (x) => x.substring(1, x.length - 1)
        },
        string: {
          match: /'(?:[^']|\'\')*'/,
          value: (x) => {
            return x.substring(1, x.length - 1).replace(/''/g, "'");
          }
        },
        eString: {
          match: /\b(?:e|E)'(?:[^'\\]|[\r\n\s]|(?:\\\s)|(?:\\\n)|(?:\\.)|(?:\'\'))+'/,
          value: (x) => {
            return x.substring(2, x.length - 1).replace(/''/g, "'").replace(/\\([\s\n])/g, (_, x2) => x2).replace(/\\./g, (m) => JSON.parse('"' + m + '"'));
          }
        },
        qparam: {
          match: /\$\d+/
        },
        commentLine: /\-\-.*?$[\s\r\n]*/,
        commentFullOpen: /\/\*/,
        commentFullClose: /\*\/[\s\r\n]*/,
        star: "*",
        comma: ",",
        space: { match: /[\s\t\n\v\f\r]+/, lineBreaks: true },
        int: /\-?\d+(?![\.\d])/,
        float: /\-?(?:(?:\d*\.\d+)|(?:\d+\.\d*))/,
        lparen: "(",
        rparen: ")",
        lbracket: "[",
        rbracket: "]",
        semicolon: ";",
        dot: /\.(?!\d)/,
        op_cast: "::",
        op_colon: ":",
        op_plus: "+",
        op_eq: "=",
        op_neq: {
          match: /(?:!=)|(?:\<\>)/,
          value: () => "!="
        },
        op_membertext: "->>",
        op_member: "->",
        op_minus: "-",
        op_div: /\//,
        op_not_ilike: /\!~~\*/,
        op_not_like: /\!~~/,
        op_ilike: /~~\*/,
        op_like: /~~/,
        op_mod: "%",
        op_exp: "^",
        op_additive: {
          match: ["||", "-", "#-", "&&"]
        },
        op_compare: {
          match: [">", ">=", "<", "<=", "@>", "<@", "?", "?|", "?&", "#>>", ">>", "<<", "~", "~*", "!~", "!~*", "@@"]
        },
        ops_others: {
          match: ["|", "&", "^", "#"]
        },
        codeblock: {
          match: /\$\$(?:.|[\s\t\n\v\f\r])*?\$\$/s,
          lineBreaks: true,
          value: (x) => x.substring(2, x.length - 2)
        }
      });
      exports2.lexer.next = ((next) => () => {
        let tok;
        let commentFull = null;
        while (tok = next.call(exports2.lexer)) {
          if (tok.type === "commentFullOpen") {
            if (commentFull === null) {
              commentFull = {
                nested: 0,
                offset: tok.offset,
                text: tok.text
              };
              continue;
            }
            commentFull.nested++;
          }
          if (commentFull != null) {
            commentFull.text += tok.text;
            if (tok.type === "commentFullClose") {
              if (commentFull.nested === 0) {
                comments === null || comments === undefined || comments.push(makeComment(commentFull));
                commentFull = null;
                continue;
              }
              commentFull.nested--;
            }
            continue;
          }
          if (tok.type === "space") {
            continue;
          }
          if (tok.type === "commentLine") {
            comments === null || comments === undefined || comments.push(makeComment(tok));
            continue;
          }
          break;
        }
        if (trackingLoc && tok) {
          const start = tok.offset;
          const loc = {
            start,
            end: start + tok.text.length
          };
          tok._location = loc;
        }
        return tok;
      })(exports2.lexer.next);
      exports2.lexerAny = exports2.lexer;
      let comments = null;
      const makeComment = ({ offset, text }) => ({
        _location: { start: offset, end: offset + text.length },
        comment: text
      });
      function trackingComments(act) {
        if (comments) {
          throw new Error("WAT ? Recursive comments tracking \uD83E\uDD14\uD83E\uDD28 ?");
        }
        try {
          comments = [];
          const ast = act();
          return { comments, ast };
        } finally {
          comments = null;
        }
      }
      exports2.trackingComments = trackingComments;
      let trackingLoc = false;
      function tracking(act) {
        if (trackingLoc) {
          return act();
        }
        try {
          trackingLoc = true;
          return act();
        } finally {
          trackingLoc = false;
        }
      }
      exports2.tracking = tracking;
      function track(xs, ret) {
        if (!trackingLoc || !ret || typeof ret !== "object") {
          return ret;
        }
        const start = seek(xs, true);
        const end = seek(xs, false);
        if (!start || !end) {
          return ret;
        }
        if (start === end) {
          ret._location = start;
        } else {
          const loc = {
            start: start.start,
            end: end.end
          };
          ret._location = loc;
        }
        return ret;
      }
      exports2.track = track;
      const literal = Symbol("_literal");
      const doubleQuotedSym = Symbol("_doublequoted");
      function box(xs, value2, doubleQuoted2) {
        if (!trackingLoc && !doubleQuoted2) {
          return value2;
        }
        return track(xs, { [literal]: value2, [doubleQuotedSym]: doubleQuoted2 });
      }
      exports2.box = box;
      function unwrapNoBox(e) {
        if (Array.isArray(e) && e.length === 1) {
          e = unwrapNoBox(e[0]);
        }
        if (Array.isArray(e) && !e.length) {
          return null;
        }
        return e;
      }
      function doubleQuoted(value2) {
        const uw = unwrapNoBox(value2);
        if (typeof value2 === "object" && (uw === null || uw === undefined ? undefined : uw[doubleQuotedSym])) {
          return { doubleQuoted: true };
        }
        return;
      }
      exports2.doubleQuoted = doubleQuoted;
      function unbox(value2) {
        var _a;
        if (typeof value2 === "object") {
          return (_a = value2 === null || value2 === undefined ? undefined : value2[literal]) !== null && _a !== undefined ? _a : value2;
        }
        return value2;
      }
      exports2.unbox = unbox;
      function seek(xs, start) {
        if (!xs) {
          return null;
        }
        if (Array.isArray(xs)) {
          const diff = start ? 1 : -1;
          for (let i = start ? 0 : xs.length - 1;i >= 0 && i < xs.length; i += diff) {
            const v = seek(xs[i], start);
            if (v) {
              return v;
            }
          }
          return null;
        }
        if (typeof xs !== "object") {
          return null;
        }
        return xs._location;
      }
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.AstDefaultMapper = exports2.arrayNilMap = exports2.assignChanged = exports2.astMapper = undefined;
      const utils_1 = __webpack_require__(6);
      function astMapper(modifierBuilder) {
        const instance = new AstDefaultMapper;
        instance.wrapped = modifierBuilder(instance);
        return instance;
      }
      exports2.astMapper = astMapper;
      function assignChanged(orig, assign2) {
        if (!orig) {
          return orig;
        }
        let changed = false;
        for (const k of Object.keys(assign2)) {
          if (orig[k] !== assign2[k]) {
            changed = true;
            break;
          }
        }
        if (!changed) {
          return orig;
        }
        return (0, utils_1.trimNullish)({
          ...orig,
          ...assign2
        }, 0);
      }
      exports2.assignChanged = assignChanged;
      function arrayNilMap(collection, mapper) {
        if (!(collection === null || collection === undefined ? undefined : collection.length)) {
          return collection;
        }
        let changed = false;
        let ret = collection;
        for (let i = 0;i < collection.length; i++) {
          const orig = collection[i];
          const val = mapper(orig);
          if (!changed && (!val || val !== orig)) {
            changed = true;
            ret = collection.slice(0, i);
          }
          if (!val) {
            continue;
          }
          if (changed) {
            ret.push(val);
          }
        }
        return ret;
      }
      exports2.arrayNilMap = arrayNilMap;
      function withAccepts(val) {
        switch (val === null || val === undefined ? undefined : val.type) {
          case "select":
          case "delete":
          case "insert":
          case "update":
          case "union":
          case "union all":
          case "with":
            return true;
          default:
            return false;
        }
      }

      class AstDefaultMapper {
        super() {
          return new SkipModifier(this);
        }
        statement(val) {
          switch (val.type) {
            case "alter table":
              return this.alterTable(val);
            case "alter index":
              return this.alterIndex(val);
            case "commit":
            case "start transaction":
            case "rollback":
              return this.transaction(val);
            case "create index":
              return this.createIndex(val);
            case "create table":
              return this.createTable(val);
            case "truncate table":
              return this.truncateTable(val);
            case "delete":
              return this.delete(val);
            case "insert":
              return this.insert(val);
            case "with":
              return this.with(val);
            case "with recursive":
              return this.withRecursive(val);
            case "select":
              return this.selection(val);
            case "update":
              return this.update(val);
            case "create extension":
              return this.createExtension(val);
            case "tablespace":
              return this.tablespace(val);
            case "set":
              return this.setGlobal(val);
            case "set timezone":
              return this.setTimezone(val);
            case "set names":
              return this.setNames(val);
            case "create sequence":
              return this.createSequence(val);
            case "alter sequence":
              return this.alterSequence(val);
            case "begin":
              return this.begin(val);
            case "drop table":
            case "drop index":
            case "drop sequence":
            case "drop type":
            case "drop trigger":
              return this.drop(val);
            case "create enum":
              return this.createEnum(val);
            case "alter enum":
              return this.alterEnum(val);
            case "create composite type":
              return this.createCompositeType(val);
            case "union":
            case "union all":
              return this.union(val);
            case "show":
              return this.show(val);
            case "prepare":
              return this.prepare(val);
            case "deallocate":
              return this.deallocate(val);
            case "create view":
              return this.createView(val);
            case "create materialized view":
              return this.createMaterializedView(val);
            case "refresh materialized view":
              return this.refreshMaterializedView(val);
            case "create schema":
              return this.createSchema(val);
            case "raise":
              return this.raise(val);
            case "comment":
              return this.comment(val);
            case "do":
              return this.do(val);
            case "create function":
              return this.createFunction(val);
            case "drop function":
              return this.dropFunction(val);
            case "values":
              return this.values(val);
            default:
              throw utils_1.NotSupported.never(val);
          }
        }
        comment(val) {
          return val;
        }
        createView(val) {
          const query2 = this.select(val.query);
          if (!query2) {
            return null;
          }
          const ref = this.tableRef(val.name);
          if (!ref) {
            return null;
          }
          return assignChanged(val, {
            query: query2,
            name: ref
          });
        }
        createMaterializedView(val) {
          const query2 = this.select(val.query);
          if (!query2) {
            return null;
          }
          const ref = this.tableRef(val.name);
          if (!ref) {
            return null;
          }
          return assignChanged(val, {
            query: query2,
            name: ref
          });
        }
        refreshMaterializedView(val) {
          return val;
        }
        do(val) {
          return val;
        }
        createFunction(val) {
          const args = arrayNilMap(val.arguments, (a) => {
            const type = this.dataType(a.type);
            return assignChanged(a, { type });
          });
          let returns;
          if (val.returns) {
            switch (val.returns.kind) {
              case "table":
                returns = assignChanged(val.returns, {
                  columns: arrayNilMap(val.returns.columns, (v) => {
                    const type = this.dataType(v.type);
                    return type && assignChanged(v, { type });
                  })
                });
                break;
              case undefined:
              case null:
              case "array":
                returns = this.dataType(val.returns);
                break;
              default:
                throw utils_1.NotSupported.never(val.returns);
            }
          }
          return assignChanged(val, {
            returns,
            arguments: args
          });
        }
        dropFunction(val) {
          const args = arrayNilMap(val.arguments, (a) => {
            const type = this.dataType(a.type);
            return assignChanged(a, { type });
          });
          return assignChanged(val, {
            arguments: args
          });
        }
        show(val) {
          return val;
        }
        createEnum(val) {
          return val;
        }
        alterEnum(val) {
          return val;
        }
        createCompositeType(val) {
          const attributes = arrayNilMap(val.attributes, (a) => assignChanged(a, {
            dataType: this.dataType(a.dataType)
          }));
          return assignChanged(val, { attributes });
        }
        drop(val) {
          return val;
        }
        alterSequence(seq) {
          if (seq.change.type === "set options") {
            if (seq.change.as) {
              this.dataType(seq.change.as);
            }
          }
          return seq;
        }
        begin(begin) {
          return begin;
        }
        createSequence(seq) {
          if (seq.options.as) {
            this.dataType(seq.options.as);
          }
          return seq;
        }
        tablespace(val) {
          return val;
        }
        setGlobal(val) {
          return val;
        }
        setTimezone(val) {
          return val;
        }
        setNames(val) {
          return val;
        }
        update(val) {
          if (!val) {
            return val;
          }
          const table = this.tableRef(val.table);
          if (!table) {
            return null;
          }
          const from = val.from && this.from(val.from);
          const where = val.where && this.expr(val.where);
          const sets = arrayNilMap(val.sets, (x) => this.set(x));
          if (!(sets === null || sets === undefined ? undefined : sets.length)) {
            return null;
          }
          const returning = arrayNilMap(val.returning, (c) => this.selectionColumn(c));
          return assignChanged(val, {
            table,
            where,
            sets,
            from,
            returning
          });
        }
        insert(val) {
          var _a, _b;
          const into = this.tableRef(val.into);
          if (!into) {
            return null;
          }
          const select = val.insert && this.select(val.insert);
          if (!select) {
            return null;
          }
          const returning = arrayNilMap(val.returning, (c) => this.selectionColumn(c));
          let on2 = (_a = val.onConflict) === null || _a === undefined ? undefined : _a.on;
          switch (on2 === null || on2 === undefined ? undefined : on2.type) {
            case "on constraint":
              break;
            case "on expr":
              on2 = assignChanged(on2, {
                exprs: arrayNilMap(on2.exprs, (e) => this.expr(e))
              });
              break;
            case null:
            case undefined:
              break;
            default:
              throw utils_1.NotSupported.never(on2);
          }
          let ocdo = (_b = val.onConflict) === null || _b === undefined ? undefined : _b.do;
          if (ocdo && ocdo !== "do nothing") {
            const sets = arrayNilMap(ocdo.sets, (x) => this.set(x));
            if (!(sets === null || sets === undefined ? undefined : sets.length)) {
              ocdo = "do nothing";
            } else if (ocdo.sets !== sets) {
              ocdo = { sets };
            }
          }
          return assignChanged(val, {
            into,
            insert: select,
            returning,
            onConflict: !ocdo ? val.onConflict : assignChanged(val.onConflict, {
              do: ocdo,
              on: on2
            })
          });
        }
        raise(val) {
          return assignChanged(val, {
            formatExprs: val.formatExprs && arrayNilMap(val.formatExprs, (x) => this.expr(x)),
            using: val.using && arrayNilMap(val.using, (u) => {
              return assignChanged(u, {
                value: this.expr(u.value)
              });
            })
          });
        }
        delete(val) {
          const from = this.tableRef(val.from);
          if (!from) {
            return null;
          }
          const where = val.where && this.expr(val.where);
          const returning = arrayNilMap(val.returning, (c) => this.selectionColumn(c));
          return assignChanged(val, {
            where,
            returning,
            from
          });
        }
        createSchema(val) {
          return val;
        }
        createTable(val) {
          const columns = arrayNilMap(val.columns, (col) => {
            switch (col.kind) {
              case "column":
                return this.createColumn(col);
              case "like table":
                return this.likeTable(col);
              default:
                throw utils_1.NotSupported.never(col);
            }
          });
          if (!(columns === null || columns === undefined ? undefined : columns.length)) {
            return null;
          }
          return assignChanged(val, {
            columns
          });
        }
        likeTable(col) {
          const like = this.tableRef(col.like);
          if (!like) {
            return null;
          }
          return assignChanged(col, { like });
        }
        truncateTable(val) {
          return val;
        }
        constraint(c) {
          switch (c.type) {
            case "not null":
            case "null":
            case "primary key":
            case "unique":
            case "add generated":
              if (c.type === "add generated" && c.expression) {
                const expression = this.expr(c.expression);
                if (!expression) {
                  return null;
                }
                return assignChanged(c, {
                  expression
                });
              }
              return c;
            case "default": {
              const def = this.expr(c.default);
              if (!def) {
                return null;
              }
              return assignChanged(c, {
                default: def
              });
            }
            case "check": {
              const def = this.expr(c.expr);
              if (!def) {
                return null;
              }
              return assignChanged(c, {
                expr: def
              });
            }
            case "reference": {
              const foreignTable = this.tableRef(c.foreignTable);
              if (!foreignTable) {
                return null;
              }
              return assignChanged(c, {
                foreignTable
              });
            }
            default:
              throw utils_1.NotSupported.never(c);
          }
        }
        set(st) {
          const value2 = this.expr(st.value);
          if (!value2) {
            return null;
          }
          return assignChanged(st, {
            value: value2
          });
        }
        dataType(dataType) {
          return dataType;
        }
        tableRef(st) {
          return st;
        }
        transaction(val) {
          return val;
        }
        createExtension(val) {
          return val;
        }
        createIndex(val) {
          const expressions = arrayNilMap(val.expressions, (e) => {
            const expression = this.expr(e.expression);
            if (expression === e.expression) {
              return e;
            }
            if (!expression) {
              return null;
            }
            return {
              ...e,
              expression
            };
          });
          if (!(expressions === null || expressions === undefined ? undefined : expressions.length)) {
            return null;
          }
          return assignChanged(val, {
            expressions
          });
        }
        prepare(st) {
          const statement = this.statement(st.statement);
          if (!statement) {
            return null;
          }
          return assignChanged(st, {
            args: arrayNilMap(st.args, (a) => this.dataType(a)),
            statement
          });
        }
        deallocate(st) {
          return st;
        }
        alterIndex(st) {
          return st;
        }
        alterTable(st) {
          var _a;
          const table = this.tableRef(st.table);
          if (!table) {
            return null;
          }
          let changes = [];
          let hasChanged = false;
          for (let i = 0;i < (((_a = st.changes) === null || _a === undefined ? undefined : _a.length) || 0); i++) {
            const currentChange = st.changes[i];
            const change = this.tableAlteration(currentChange, st.table);
            hasChanged = hasChanged || change != currentChange;
            if (!!change) {
              changes.push(change);
            }
          }
          if (!changes.length) {
            return null;
          }
          if (!hasChanged) {
            return st;
          }
          return assignChanged(st, {
            table,
            changes
          });
        }
        tableAlteration(change, table) {
          switch (change.type) {
            case "add column":
              return this.addColumn(change, table);
            case "add constraint":
              return this.addConstraint(change, table);
            case "alter column":
              return this.alterColumn(change, table);
            case "rename":
              return this.renameTable(change, table);
            case "rename column":
              return this.renameColumn(change, table);
            case "rename constraint":
              return this.renameConstraint(change, table);
            case "drop column":
              return this.dropColumn(change, table);
            case "drop constraint":
              return this.dropConstraint(change, table);
            case "owner":
              return this.setTableOwner(change, table);
            default:
              throw utils_1.NotSupported.never(change);
          }
        }
        dropColumn(change, table) {
          return change;
        }
        dropConstraint(change, table) {
          return change;
        }
        setTableOwner(change, table) {
          return change;
        }
        renameConstraint(change, table) {
          return change;
        }
        renameColumn(change, table) {
          return change;
        }
        renameTable(change, table) {
          return change;
        }
        alterColumn(change, inTable) {
          let alter;
          switch (change.alter.type) {
            case "set default":
              alter = this.setColumnDefault(change.alter, inTable, change.column);
              break;
            case "set type":
              alter = this.setColumnType(change.alter, inTable, change.column);
              break;
            case "drop default":
            case "set not null":
            case "drop not null":
              alter = this.alterColumnSimple(change.alter, inTable, change.column);
              break;
            case "add generated":
              alter = this.alterColumnAddGenerated(change.alter, inTable, change.column);
              break;
            default:
              throw utils_1.NotSupported.never(change.alter);
          }
          if (!alter) {
            return null;
          }
          return assignChanged(change, {
            alter
          });
        }
        setColumnType(alter, inTable, inColumn) {
          const dataType = this.dataType(alter.dataType);
          return assignChanged(alter, {
            dataType
          });
        }
        alterColumnAddGenerated(alter, inTable, inColumn) {
          return alter;
        }
        alterColumnSimple(alter, inTable, inColumn) {
          return alter;
        }
        setColumnDefault(alter, inTable, inColumn) {
          const def = this.expr(alter.default);
          if (!def) {
            return null;
          }
          return assignChanged(alter, {
            default: def
          });
        }
        addConstraint(change, inTable) {
          return change;
        }
        addColumn(change, inTable) {
          const column = this.createColumn(change.column);
          if (!column) {
            return null;
          }
          return assignChanged(change, {
            column
          });
        }
        createColumn(col) {
          var _a;
          const dataType = this.dataType(col.dataType);
          if (!dataType) {
            return null;
          }
          const constraints = (_a = arrayNilMap(col.constraints, (m) => this.constraint(m))) !== null && _a !== undefined ? _a : undefined;
          return assignChanged(col, {
            dataType,
            constraints
          });
        }
        select(val) {
          switch (val.type) {
            case "select":
              return this.selection(val);
            case "union":
            case "union all":
              return this.union(val);
            case "with":
              return this.with(val);
            case "values":
              return this.values(val);
            case "with recursive":
              return this.withRecursive(val);
            default:
              throw utils_1.NotSupported.never(val);
          }
        }
        selection(val) {
          var _a, _b;
          const from = arrayNilMap(val.from, (c) => this.from(c));
          const columns = arrayNilMap(val.columns, (c) => this.selectionColumn(c));
          const where = val.where && this.expr(val.where);
          const groupBy = arrayNilMap(val.groupBy, (c) => this.expr(c));
          const having = val.having && this.expr(val.having);
          const orderBy = this.orderBy(val.orderBy);
          const limit = assignChanged(val.limit, {
            limit: this.expr((_a = val.limit) === null || _a === undefined ? undefined : _a.limit),
            offset: this.expr((_b = val.limit) === null || _b === undefined ? undefined : _b.offset)
          });
          return assignChanged(val, {
            from,
            columns,
            where,
            groupBy,
            having,
            orderBy,
            limit
          });
        }
        orderBy(orderBy) {
          return arrayNilMap(orderBy, (c) => {
            const by = this.expr(c.by);
            if (!by) {
              return null;
            }
            if (by === c.by) {
              return c;
            }
            return {
              ...c,
              by
            };
          });
        }
        union(val) {
          const left = this.select(val.left);
          const right = this.select(val.right);
          if (!left || !right) {
            return left !== null && left !== undefined ? left : right;
          }
          return assignChanged(val, {
            left,
            right
          });
        }
        with(val) {
          const bind = arrayNilMap(val.bind, (s) => {
            const statement = this.statement(s.statement);
            return withAccepts(statement) ? assignChanged(s, { statement }) : null;
          });
          if (!bind) {
            return null;
          }
          const _in = this.statement(val.in);
          if (!withAccepts(_in)) {
            return null;
          }
          return assignChanged(val, {
            bind,
            in: _in
          });
        }
        withRecursive(val) {
          const statement = this.union(val.bind);
          if (!statement) {
            return null;
          }
          if (statement.type !== "union" && statement.type !== "union all") {
            return null;
          }
          const _in = this.statement(val.in);
          if (!withAccepts(_in)) {
            return null;
          }
          return assignChanged(val, {
            bind: statement,
            in: _in
          });
        }
        from(from) {
          switch (from.type) {
            case "table":
              return this.fromTable(from);
            case "statement":
              return this.fromStatement(from);
            case "call":
              return this.fromCall(from);
            default:
              throw utils_1.NotSupported.never(from);
          }
        }
        fromCall(from) {
          const call = this.call(from);
          if (!call || call.type !== "call") {
            return null;
          }
          return assignChanged(from, call);
        }
        fromStatement(from) {
          const statement = this.select(from.statement);
          if (!statement) {
            return null;
          }
          const join = from.join && this.join(from.join);
          return assignChanged(from, {
            statement,
            join
          });
        }
        values(from) {
          const values = arrayNilMap(from.values, (x) => arrayNilMap(x, (y) => this.expr(y)));
          if (!(values === null || values === undefined ? undefined : values.length)) {
            return null;
          }
          return assignChanged(from, {
            values
          });
        }
        join(join) {
          const on2 = join.on && this.expr(join.on);
          if (!on2 && !join.using) {
            return join;
          }
          return assignChanged(join, {
            on: on2
          });
        }
        fromTable(from) {
          const nfrom = this.tableRef(from.name);
          if (!nfrom) {
            return null;
          }
          const join = from.join && this.join(from.join);
          return assignChanged(from, {
            name: nfrom,
            join
          });
        }
        selectionColumn(val) {
          const expr = this.expr(val.expr);
          if (!expr) {
            return null;
          }
          return assignChanged(val, {
            expr
          });
        }
        expr(val) {
          if (!val) {
            return val;
          }
          switch (val.type) {
            case "binary":
              return this.binary(val);
            case "unary":
              return this.unary(val);
            case "ref":
              return this.ref(val);
            case "string":
            case "numeric":
            case "integer":
            case "boolean":
            case "constant":
            case "null":
              return this.constant(val);
            case "list":
            case "array":
              return this.array(val);
            case "array select":
              return this.arraySelect(val);
            case "call":
              return this.call(val);
            case "cast":
              return this.cast(val);
            case "case":
              return this.case(val);
            case "member":
              return this.member(val);
            case "arrayIndex":
              return this.arrayIndex(val);
            case "ternary":
              return this.ternary(val);
            case "select":
            case "union":
            case "union all":
            case "with":
            case "with recursive":
              return this.select(val);
            case "keyword":
              return this.valueKeyword(val);
            case "parameter":
              return this.parameter(val);
            case "extract":
              return this.extract(val);
            case "overlay":
              return this.callOverlay(val);
            case "substring":
              return this.callSubstring(val);
            case "values":
              return this.values(val);
            case "default":
              return this.default(val);
            default:
              throw utils_1.NotSupported.never(val);
          }
        }
        arraySelect(val) {
          const select = this.select(val.select);
          if (!select) {
            return null;
          }
          return assignChanged(val, { select });
        }
        extract(st) {
          const from = this.expr(st.from);
          if (!from) {
            return null;
          }
          return assignChanged(st, { from });
        }
        valueKeyword(val) {
          return val;
        }
        ternary(val) {
          const value2 = this.expr(val.value);
          const lo = this.expr(val.lo);
          const hi = this.expr(val.hi);
          if (!value2 || !lo || !hi) {
            return null;
          }
          return assignChanged(val, {
            value: value2,
            lo,
            hi
          });
        }
        parameter(st) {
          return st;
        }
        arrayIndex(val) {
          const array = this.expr(val.array);
          const index = this.expr(val.index);
          if (!array || !index) {
            return null;
          }
          return assignChanged(val, {
            array,
            index
          });
        }
        member(val) {
          const operand = this.expr(val.operand);
          if (!operand) {
            return null;
          }
          return assignChanged(val, {
            operand
          });
        }
        case(val) {
          const value2 = val.value && this.expr(val.value);
          const whens = arrayNilMap(val.whens, (w) => {
            const when = this.expr(w.when);
            const value3 = this.expr(w.value);
            if (!when || !value3) {
              return null;
            }
            return assignChanged(w, {
              value: value3,
              when
            });
          });
          if (!(whens === null || whens === undefined ? undefined : whens.length)) {
            return null;
          }
          const els = val.else && this.expr(val.else);
          return assignChanged(val, {
            value: value2,
            whens,
            else: els
          });
        }
        cast(val) {
          const operand = this.expr(val.operand);
          if (!operand) {
            return null;
          }
          return assignChanged(val, {
            operand
          });
        }
        call(val) {
          var _a;
          const args = arrayNilMap(val.args, (a) => this.expr(a));
          if (!args) {
            return null;
          }
          const orderBy = this.orderBy(val.orderBy);
          const filter = this.expr(val.filter);
          const withinGroupList = val.withinGroup ? [val.withinGroup] : undefined;
          const withinGroup = (_a = this.orderBy(withinGroupList)) === null || _a === undefined ? undefined : _a[0];
          return assignChanged(val, {
            args,
            orderBy,
            filter,
            withinGroup
          });
        }
        callSubstring(val) {
          return assignChanged(val, {
            value: this.expr(val.value),
            from: this.expr(val.from),
            for: this.expr(val.for)
          });
        }
        callOverlay(val) {
          return assignChanged(val, {
            value: this.expr(val.value),
            placing: this.expr(val.placing),
            from: this.expr(val.from),
            for: this.expr(val.for)
          });
        }
        array(val) {
          const expressions = arrayNilMap(val.expressions, (a) => this.expr(a));
          if (!expressions) {
            return null;
          }
          return assignChanged(val, {
            expressions
          });
        }
        constant(value2) {
          return value2;
        }
        default(value2) {
          return value2;
        }
        ref(val) {
          return val;
        }
        unary(val) {
          const operand = this.expr(val.operand);
          if (!operand) {
            return null;
          }
          return assignChanged(val, {
            operand
          });
        }
        binary(val) {
          const left = this.expr(val.left);
          const right = this.expr(val.right);
          if (!left || !right) {
            return null;
          }
          return assignChanged(val, {
            left,
            right
          });
        }
      }
      exports2.AstDefaultMapper = AstDefaultMapper;
      const proto = AstDefaultMapper.prototype;
      for (const k of Object.getOwnPropertyNames(proto)) {
        const orig = proto[k];
        if (k === "constructor" || k === "super" || typeof orig !== "function") {
          continue;
        }
        Object.defineProperty(proto, k, {
          configurable: false,
          get() {
            return function(...args) {
              var _a;
              if (this.skipNext) {
                this.skipNext = false;
                return orig.apply(this, args);
              }
              const impl = (_a = this.wrapped) === null || _a === undefined ? undefined : _a[k];
              if (!impl) {
                return orig.apply(this, args);
              }
              return impl.apply(this.wrapped, args);
            };
          }
        });
      }

      class SkipModifier extends AstDefaultMapper {
        constructor(parent) {
          super();
          this.parent = parent;
        }
      }
      for (const k of Object.getOwnPropertyNames(proto)) {
        const orig = proto[k];
        if (k === "constructor" || k === "super" || typeof orig !== "function") {
          continue;
        }
        Object.defineProperty(SkipModifier.prototype, k, {
          configurable: false,
          get() {
            return function(...args) {
              this.parent.skipNext = true;
              return orig.apply(this.parent, args);
            };
          }
        });
      }
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.sqlKeywords = undefined;
      exports2.sqlKeywords = [
        "ALL",
        "ANALYSE",
        "ANALYZE",
        "AND",
        "ANY",
        "ARRAY",
        "AS",
        "ASC",
        "ASYMMETRIC",
        "AUTHORIZATION",
        "BINARY",
        "BOTH",
        "CASE",
        "CAST",
        "CHECK",
        "COLLATE",
        "COLLATION",
        "CONCURRENTLY",
        "CONSTRAINT",
        "CREATE",
        "CROSS",
        "CURRENT_CATALOG",
        "CURRENT_DATE",
        "CURRENT_ROLE",
        "CURRENT_SCHEMA",
        "CURRENT_TIME",
        "CURRENT_TIMESTAMP",
        "CURRENT_USER",
        "DEFAULT",
        "DEFERRABLE",
        "DESC",
        "DISTINCT",
        "DO",
        "ELSE",
        "END",
        "EXCEPT",
        "FALSE",
        "FETCH",
        "FOR",
        "FOREIGN",
        "FREEZE",
        "FROM",
        "FULL",
        "GRANT",
        "GROUP",
        "HAVING",
        "ILIKE",
        "IN",
        "INITIALLY",
        "INNER",
        "INTERSECT",
        "INTO",
        "IS",
        "ISNULL",
        "JOIN",
        "LATERAL",
        "LEADING",
        "LEFT",
        "LIKE",
        "LIMIT",
        "LOCALTIME",
        "LOCALTIMESTAMP",
        "NATURAL",
        "NOT",
        "NOTNULL",
        "NULL",
        "OFFSET",
        "ON",
        "ONLY",
        "OR",
        "ORDER",
        "OUTER",
        "OVERLAPS",
        "PLACING",
        "PRIMARY",
        "REFERENCES",
        "RETURNING",
        "RIGHT",
        "SELECT",
        "SESSION_USER",
        "SIMILAR",
        "SOME",
        "SYMMETRIC",
        "TABLE",
        "TABLESAMPLE",
        "THEN",
        "TO",
        "TRAILING",
        "TRUE",
        "UNION",
        "UNIQUE",
        "USER",
        "USING",
        "VARIADIC",
        "VERBOSE",
        "WHEN",
        "WHERE",
        "WINDOW",
        "WITH",
        "PRECISION"
      ];
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.intervalToString = exports2.normalizeInterval = exports2.buildInterval = undefined;
      const types = [
        ["years", 12],
        ["months", 30],
        ["days", 24],
        ["hours", 60],
        ["minutes", 60],
        ["seconds", 1000],
        ["milliseconds", 0]
      ];
      function* unwrap2(k) {
        if (typeof k[1] === "number") {
          yield k;
        } else {
          for (const v of k) {
            yield* unwrap2(v);
          }
        }
      }
      function buildInterval(orig, vals) {
        var _a;
        const ret = {};
        if (vals === "invalid") {
          throw new Error(`invalid input syntax for type interval: "${orig}"`);
        }
        for (const [k, v] of unwrap2(vals)) {
          ret[k] = ((_a = ret[k]) !== null && _a !== undefined ? _a : 0) + v;
        }
        return ret;
      }
      exports2.buildInterval = buildInterval;
      function normalizeInterval(value2) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const ret = { ...value2 };
        for (let i = 0;i < types.length; i++) {
          const [k, mul] = types[i];
          const v = (_a = ret[k]) !== null && _a !== undefined ? _a : 0;
          const int2 = v >= 0 ? Math.floor(v) : Math.ceil(v);
          if (!v || int2 === v) {
            continue;
          }
          const nk = (_b = types[i + 1]) === null || _b === undefined ? undefined : _b[0];
          if (nk) {
            ret[nk] = ((_c = ret[nk]) !== null && _c !== undefined ? _c : 0) + mul * (v - int2);
          }
          ret[k] = int2;
        }
        if (ret.months || ret.years) {
          const m = ((_d = ret.months) !== null && _d !== undefined ? _d : 0) + ((_e = ret.years) !== null && _e !== undefined ? _e : 0) * 12;
          ret.months = m % 12;
          ret.years = (m - ret.months) / 12;
        }
        let t = ((_f = ret.hours) !== null && _f !== undefined ? _f : 0) * 3600 + ((_g = ret.minutes) !== null && _g !== undefined ? _g : 0) * 60 + ((_h = ret.seconds) !== null && _h !== undefined ? _h : 0) + ((_j = ret.milliseconds) !== null && _j !== undefined ? _j : 0) / 1000;
        let sign = 1;
        if (t < 0) {
          sign = -1;
          t = -t;
        }
        if (t >= 3600) {
          ret.hours = sign * Math.floor(t / 3600);
          t -= sign * ret.hours * 3600;
        } else {
          delete ret.hours;
        }
        if (t >= 60) {
          ret.minutes = sign * Math.floor(t / 60);
          t -= sign * ret.minutes * 60;
        } else {
          delete ret.minutes;
        }
        if (t > 0) {
          ret.seconds = sign * Math.floor(t);
          t -= sign * ret.seconds;
        } else {
          delete ret.seconds;
        }
        if (t > 0) {
          ret.milliseconds = sign * Math.round(t * 1000);
        } else {
          delete ret.milliseconds;
        }
        for (const [k] of types) {
          if (!ret[k]) {
            delete ret[k];
          }
        }
        return ret;
      }
      exports2.normalizeInterval = normalizeInterval;
      function intervalToString(value2) {
        var _a, _b, _c;
        value2 = normalizeInterval(value2);
        const ret = [];
        if (value2.years) {
          ret.push(value2.years === 1 ? "1 year" : value2.years + " years");
        }
        if (value2.months) {
          ret.push(value2.months === 1 ? "1 month" : value2.months + " months");
        }
        if (value2.days) {
          ret.push(value2.days === 1 ? "1 day" : value2.days + " days");
        }
        if (value2.hours || value2.minutes || value2.seconds || value2.milliseconds) {
          let time = `${num((_a = value2.hours) !== null && _a !== undefined ? _a : 0)}:${num((_b = value2.minutes) !== null && _b !== undefined ? _b : 0)}:${num((_c = value2.seconds) !== null && _c !== undefined ? _c : 0)}`;
          if (value2.milliseconds) {
            time = time + (value2.milliseconds / 1000).toString().substr(1);
          }
          if (neg2(value2.hours) || neg2(value2.minutes) || neg2(value2.seconds) || neg2(value2.milliseconds)) {
            time = "-" + time;
          }
          ret.push(time);
        }
        return ret.join(" ");
      }
      exports2.intervalToString = intervalToString;
      function num(v) {
        v = Math.abs(v);
        return v < 10 ? "0" + v : v.toString();
      }
      function neg2(v) {
        return v && v < 0;
      }
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.astVisitor = undefined;
      const ast_mapper_1 = __webpack_require__(2);

      class Visitor {
        super() {
          return new SkipVisitor(this);
        }
      }
      const mapperProto = ast_mapper_1.AstDefaultMapper.prototype;
      for (const k of Object.getOwnPropertyNames(mapperProto)) {
        const orig = mapperProto[k];
        if (k === "constructor" || k === "super" || typeof orig !== "function") {
          continue;
        }
        Object.defineProperty(Visitor.prototype, k, {
          configurable: false,
          get() {
            return function(...args) {
              const impl = this.visitor[k];
              if (!impl) {
                return orig.apply(this, args);
              }
              impl.apply(this.visitor, args);
              return args[0];
            };
          }
        });
      }

      class SkipVisitor {
        constructor(parent) {
          this.parent = parent;
        }
      }
      for (const k of Object.getOwnPropertyNames(mapperProto)) {
        const orig = mapperProto[k];
        if (k === "constructor" || k === "super" || typeof orig !== "function") {
          continue;
        }
        Object.defineProperty(SkipVisitor.prototype, k, {
          configurable: false,
          get() {
            return function(...args) {
              return orig.apply(this.parent, args);
            };
          }
        });
      }
      function astVisitor(visitorBuilder) {
        return (0, ast_mapper_1.astMapper)((m) => {
          const ret = new Visitor;
          ret.mapper = m;
          ret.visitor = visitorBuilder(ret);
          return ret;
        });
      }
      exports2.astVisitor = astVisitor;
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.trimNullish = exports2.NotSupported = undefined;

      class NotSupported extends Error {
        constructor(what) {
          super("Not supported" + (what ? ": " + what : ""));
        }
        static never(value2, msg) {
          return new NotSupported(`${msg !== null && msg !== undefined ? msg : ""} ${JSON.stringify(value2)}`);
        }
      }
      exports2.NotSupported = NotSupported;
      function trimNullish(value2, depth2 = 5) {
        if (depth2 < 0)
          return value2;
        if (value2 instanceof Array) {
          value2.forEach((x) => trimNullish(x, depth2 - 1));
        }
        if (typeof value2 !== "object" || value2 instanceof Date)
          return value2;
        if (!value2) {
          return value2;
        }
        for (const k of Object.keys(value2)) {
          const val = value2[k];
          if (val === undefined || val === null)
            delete value2[k];
          else
            trimNullish(val, depth2 - 1);
        }
        return value2;
      }
      exports2.trimNullish = trimNullish;
    },
    function(module2, exports2, __webpack_require__) {
      var __createBinding = this && this.__createBinding || (Object.create ? function(o, m, k, k2) {
        if (k2 === undefined)
          k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = { enumerable: true, get: function() {
            return m[k];
          } };
        }
        Object.defineProperty(o, k2, desc);
      } : function(o, m, k, k2) {
        if (k2 === undefined)
          k2 = k;
        o[k2] = m[k];
      });
      var __exportStar = this && this.__exportStar || function(m, exports3) {
        for (var p in m)
          if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p))
            __createBinding(exports3, m, p);
      };
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.normalizeInterval = exports2.intervalToString = exports2.toSql = exports2.astMapper = exports2.assignChanged = exports2.arrayNilMap = exports2.astVisitor = exports2.parseWithComments = exports2.parseIntervalLiteral = exports2.parseGeometricLiteral = exports2.parseArrayLiteral = exports2.parseFirst = exports2.parse = undefined;
      var parser_1 = __webpack_require__(8);
      Object.defineProperty(exports2, "parse", { enumerable: true, get: function() {
        return parser_1.parse;
      } });
      Object.defineProperty(exports2, "parseFirst", { enumerable: true, get: function() {
        return parser_1.parseFirst;
      } });
      Object.defineProperty(exports2, "parseArrayLiteral", { enumerable: true, get: function() {
        return parser_1.parseArrayLiteral;
      } });
      Object.defineProperty(exports2, "parseGeometricLiteral", { enumerable: true, get: function() {
        return parser_1.parseGeometricLiteral;
      } });
      Object.defineProperty(exports2, "parseIntervalLiteral", { enumerable: true, get: function() {
        return parser_1.parseIntervalLiteral;
      } });
      Object.defineProperty(exports2, "parseWithComments", { enumerable: true, get: function() {
        return parser_1.parseWithComments;
      } });
      var ast_visitor_1 = __webpack_require__(5);
      Object.defineProperty(exports2, "astVisitor", { enumerable: true, get: function() {
        return ast_visitor_1.astVisitor;
      } });
      var ast_mapper_1 = __webpack_require__(2);
      Object.defineProperty(exports2, "arrayNilMap", { enumerable: true, get: function() {
        return ast_mapper_1.arrayNilMap;
      } });
      Object.defineProperty(exports2, "assignChanged", { enumerable: true, get: function() {
        return ast_mapper_1.assignChanged;
      } });
      Object.defineProperty(exports2, "astMapper", { enumerable: true, get: function() {
        return ast_mapper_1.astMapper;
      } });
      var to_sql_1 = __webpack_require__(19);
      Object.defineProperty(exports2, "toSql", { enumerable: true, get: function() {
        return to_sql_1.toSql;
      } });
      __exportStar(__webpack_require__(21), exports2);
      var interval_builder_1 = __webpack_require__(4);
      Object.defineProperty(exports2, "intervalToString", { enumerable: true, get: function() {
        return interval_builder_1.intervalToString;
      } });
      Object.defineProperty(exports2, "normalizeInterval", { enumerable: true, get: function() {
        return interval_builder_1.normalizeInterval;
      } });
    },
    function(module2, exports2, __webpack_require__) {
      var __importDefault = this && this.__importDefault || function(mod) {
        return mod && mod.__esModule ? mod : { default: mod };
      };
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.parseGeometricLiteral = exports2.parseIntervalLiteral = exports2.parseArrayLiteral = exports2.parse = exports2.parseWithComments = exports2.parseFirst = undefined;
      const nearley_1 = __webpack_require__(9);
      const main_ne_1 = __importDefault(__webpack_require__(10));
      const array_ne_1 = __importDefault(__webpack_require__(11));
      const geometric_ne_1 = __importDefault(__webpack_require__(13));
      const interval_ne_1 = __importDefault(__webpack_require__(15));
      const interval_iso_ne_1 = __importDefault(__webpack_require__(17));
      const interval_builder_1 = __webpack_require__(4);
      const lexer_1 = __webpack_require__(1);
      let sqlCompiled;
      let arrayCompiled;
      let geometricCompiled;
      let intervalTextCompiled;
      let intervalIsoCompiled;
      function parseFirst(sql) {
        const first = parse(sql);
        return first[0];
      }
      exports2.parseFirst = parseFirst;
      function parseWithComments(sql, options) {
        return (0, lexer_1.trackingComments)(() => parse(sql, options));
      }
      exports2.parseWithComments = parseWithComments;
      function parse(sql, optEntry) {
        if (!sqlCompiled) {
          sqlCompiled = nearley_1.Grammar.fromCompiled(main_ne_1.default);
        }
        const entry = typeof optEntry === "string" ? optEntry : optEntry === null || optEntry === undefined ? undefined : optEntry.entry;
        const opts = typeof optEntry === "string" ? null : optEntry;
        const doParse = () => _parse(sql, sqlCompiled, entry);
        let parsed = (opts === null || opts === undefined ? undefined : opts.locationTracking) ? (0, lexer_1.tracking)(doParse) : doParse();
        if (typeof optEntry !== "string" && !Array.isArray(parsed)) {
          parsed = [parsed];
        }
        return parsed;
      }
      exports2.parse = parse;
      function parseArrayLiteral(sql) {
        if (!arrayCompiled) {
          arrayCompiled = nearley_1.Grammar.fromCompiled(array_ne_1.default);
        }
        return _parse(sql, arrayCompiled);
      }
      exports2.parseArrayLiteral = parseArrayLiteral;
      function parseIntervalLiteral(literal) {
        if (literal.startsWith("P")) {
          if (!intervalIsoCompiled) {
            intervalIsoCompiled = nearley_1.Grammar.fromCompiled(interval_iso_ne_1.default);
          }
          return (0, interval_builder_1.buildInterval)(literal, _parse(literal, intervalIsoCompiled));
        } else {
          if (!intervalTextCompiled) {
            intervalTextCompiled = nearley_1.Grammar.fromCompiled(interval_ne_1.default);
          }
          const low = literal.toLowerCase();
          return (0, interval_builder_1.buildInterval)(literal, _parse(low, intervalTextCompiled));
        }
      }
      exports2.parseIntervalLiteral = parseIntervalLiteral;
      function parseGeometricLiteral(sql, type) {
        if (!geometricCompiled) {
          geometricCompiled = nearley_1.Grammar.fromCompiled(geometric_ne_1.default);
        }
        return _parse(sql, geometricCompiled, type);
      }
      exports2.parseGeometricLiteral = parseGeometricLiteral;
      function _parse(sql, grammar, entry) {
        try {
          grammar.start = entry !== null && entry !== undefined ? entry : "main";
          const parser = new nearley_1.Parser(grammar);
          parser.feed(sql);
          const asts = parser.finish();
          if (!asts.length) {
            throw new Error("Unexpected end of input");
          } else if (asts.length !== 1) {
            throw new Error(`\uD83D\uDC80 Ambiguous SQL syntax: Please file an issue stating the request that has failed at https://github.com/oguimbal/pgsql-ast-parser:

        ${sql}

        `);
          }
          return asts[0];
        } catch (e) {
          if (typeof (e === null || e === undefined ? undefined : e.message) !== "string") {
            throw e;
          }
          let msg = e.message;
          let begin = null;
          const parts = [];
          const reg = /A (.+) token based on:/g;
          let m;
          while (m = reg.exec(msg)) {
            begin = begin !== null && begin !== undefined ? begin : msg.substr(0, m.index);
            parts.push(`    - A "${m[1]}" token`);
          }
          if (begin) {
            msg = begin + parts.join(`
`) + `

`;
          }
          e.message = msg;
          throw e;
        }
      }
    },
    function(module2, exports2) {
      module2.exports = require_nearley();
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      function id(d) {
        return d[0];
      }
      const lexer_1 = __webpack_require__(1);
      const lexer_2 = __webpack_require__(1);
      function debug(fn) {
        fn = fn || ((x) => x);
        return (x, ...args) => {
          debugger;
          return fn(x, ...args);
        };
      }
      function asName(val) {
        return asNameWithColumns(val, undefined);
      }
      function asNameWithColumns(val, columns) {
        const name = toStr(val);
        if (!columns || columns.length === 0) {
          return (0, lexer_2.track)(val, { name });
        }
        return (0, lexer_2.track)(val, {
          name,
          columns: columns.map((c) => ({ name: toStr(c) }))
        });
      }
      function asLit(val) {
        const value3 = toStr(val);
        return (0, lexer_2.track)(val, { value: value3 });
      }
      function unwrap2(e) {
        if (Array.isArray(e) && e.length === 1) {
          e = unwrap2(e[0]);
        }
        if (Array.isArray(e) && !e.length) {
          return null;
        }
        return (0, lexer_2.unbox)(e);
      }
      const get = (i) => (x) => (0, lexer_2.track)(x, x[i]);
      const last = (x) => Array.isArray(x) ? (0, lexer_2.track)(x[x.length - 1], x[x.length - 1]) : x;
      const trim = (x) => x && x.trim();
      const value2 = (x) => x && x.value;
      function flatten(e) {
        if (Array.isArray(e)) {
          const ret = [];
          for (const i of e) {
            ret.push(...flatten(i));
          }
          return ret;
        }
        if (!e) {
          return [];
        }
        return [e];
      }
      function asStr(value3) {
        var _a;
        value3 = (0, lexer_2.unbox)(value3);
        return (_a = value3 === null || value3 === undefined ? undefined : value3.value) !== null && _a !== undefined ? _a : value3;
      }
      function flattenStr(e) {
        const fl = flatten((0, lexer_2.unbox)(e));
        return fl.filter((x) => !!x).map((x) => asStr(x)).filter((x) => typeof x === "string").map((x) => x.trim()).filter((x) => !!x);
      }
      function toStr(e, join) {
        return flattenStr(e).join(join || "");
      }
      function fromEntries(vals) {
        const ret = {};
        for (const [k, v] of vals) {
          ret[k] = v;
        }
        return ret;
      }
      const kwSensitivity = { sensitivity: "accent" };
      const eqInsensitive = (a, b) => a.localeCompare(b, undefined, kwSensitivity) === 0;
      const notReservedKw = (kw2) => (x, _, rej) => {
        const val = asStr(x[0]);
        if (eqInsensitive(val, kw2)) {
          return (0, lexer_2.box)(x, kw2);
        }
        return rej;
      };
      const kw = notReservedKw;
      const anyKw = (...kw2) => {
        const kwSet = new Set(kw2);
        return (x, _, rej) => {
          const val = typeof x[0] === "string" ? x[0] : x[0].value;
          return kwSet.has(val) ? val : rej;
        };
      };
      function setSeqOpts(ret, opts) {
        const defs = new Set;
        const unboxed = opts.map(lexer_2.unbox);
        for (const [k, v] of unboxed) {
          if (defs.has(k)) {
            throw new Error("conflicting or redundant options");
          }
          defs.add(k);
          ret[k] = (0, lexer_2.unbox)(v);
        }
      }
      const grammar = {
        Lexer: lexer_1.lexerAny,
        ParserRules: [
          { name: "lparen", symbols: [lexer_1.lexerAny.has("lparen") ? { type: "lparen" } : lparen] },
          { name: "rparen", symbols: [lexer_1.lexerAny.has("rparen") ? { type: "rparen" } : rparen] },
          { name: "number$subexpression$1", symbols: ["float"] },
          { name: "number$subexpression$1", symbols: ["int"] },
          { name: "number", symbols: ["number$subexpression$1"], postprocess: unwrap2 },
          { name: "dot", symbols: [lexer_1.lexerAny.has("dot") ? { type: "dot" } : dot], postprocess: id },
          { name: "float", symbols: [lexer_1.lexerAny.has("float") ? { type: "float" } : float], postprocess: (x) => (0, lexer_2.box)(x, parseFloat(unwrap2(x))) },
          { name: "int", symbols: [lexer_1.lexerAny.has("int") ? { type: "int" } : int], postprocess: (x) => (0, lexer_2.box)(x, parseInt(unwrap2(x), 10)) },
          { name: "comma", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma], postprocess: id },
          { name: "star", symbols: [lexer_1.lexerAny.has("star") ? { type: "star" } : star], postprocess: (x) => (0, lexer_2.box)(x, x[0].value) },
          { name: "string$subexpression$1", symbols: [lexer_1.lexerAny.has("string") ? { type: "string" } : string] },
          { name: "string$subexpression$1", symbols: [lexer_1.lexerAny.has("eString") ? { type: "eString" } : eString] },
          { name: "string", symbols: ["string$subexpression$1"], postprocess: (x) => (0, lexer_2.box)(x, unwrap2(x[0]).value) },
          { name: "ident", symbols: ["word"], postprocess: get(0) },
          { name: "word", symbols: [lexer_1.lexerAny.has("kw_primary") ? { type: "kw_primary" } : kw_primary], postprocess: (x) => (0, lexer_2.box)(x, "primary") },
          { name: "word", symbols: [lexer_1.lexerAny.has("kw_unique") ? { type: "kw_unique" } : kw_unique], postprocess: (x) => (0, lexer_2.box)(x, "unique") },
          { name: "word", symbols: [lexer_1.lexerAny.has("quoted_word") ? { type: "quoted_word" } : quoted_word], postprocess: (x) => (0, lexer_2.box)(x, x[0].value, true) },
          { name: "word", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: (x) => (0, lexer_2.box)(x, x[0].value) },
          { name: "collist_paren", symbols: ["lparen", "collist", "rparen"], postprocess: get(1) },
          { name: "collist$ebnf$1", symbols: [] },
          { name: "collist$ebnf$1$subexpression$1", symbols: ["comma", "ident"], postprocess: last },
          { name: "collist$ebnf$1", symbols: ["collist$ebnf$1", "collist$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "collist", symbols: ["ident", "collist$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "kw_between", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("between") },
          { name: "kw_conflict", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("conflict") },
          { name: "kw_nothing", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("nothing") },
          { name: "kw_begin", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("begin") },
          { name: "kw_if", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("if") },
          { name: "kw_exists", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("exists") },
          { name: "kw_key", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("key") },
          { name: "kw_index", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("index") },
          { name: "kw_extension", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("extension") },
          { name: "kw_schema", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("schema") },
          { name: "kw_nulls", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("nulls") },
          { name: "kw_first", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("first") },
          { name: "kw_last", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("last") },
          { name: "kw_start", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("start") },
          { name: "kw_restart", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("restart") },
          { name: "kw_filter", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("filter") },
          { name: "kw_commit", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("commit") },
          { name: "kw_tablespace", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("tablespace") },
          { name: "kw_transaction", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("transaction") },
          { name: "kw_work", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("work") },
          { name: "kw_read", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("read") },
          { name: "kw_write", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("write") },
          { name: "kw_isolation", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("isolation") },
          { name: "kw_level", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("level") },
          { name: "kw_serializable", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("serializable") },
          { name: "kw_rollback", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("rollback") },
          { name: "kw_insert", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("insert") },
          { name: "kw_value", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("value") },
          { name: "kw_values", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("values") },
          { name: "kw_update", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("update") },
          { name: "kw_column", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("column") },
          { name: "kw_set", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("set") },
          { name: "kw_version", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("version") },
          { name: "kw_alter", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("alter") },
          { name: "kw_rename", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("rename") },
          { name: "kw_sequence", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("sequence") },
          { name: "kw_temp", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("temp") },
          { name: "kw_temporary", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("temporary") },
          { name: "kw_add", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("add") },
          { name: "kw_owner", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("owner") },
          { name: "kw_owned", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("owned") },
          { name: "kw_including", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("including") },
          { name: "kw_excluding", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("excluding") },
          { name: "kw_none", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("none") },
          { name: "kw_drop", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("drop") },
          { name: "kw_operator", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("operator") },
          { name: "kw_minvalue", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("minvalue") },
          { name: "kw_maxvalue", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("maxvalue") },
          { name: "kw_data", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("data") },
          { name: "kw_type", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("type") },
          { name: "kw_trigger", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("trigger") },
          { name: "kw_delete", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("delete") },
          { name: "kw_cache", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("cache") },
          { name: "kw_cascade", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("cascade") },
          { name: "kw_no", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("no") },
          { name: "kw_timestamp", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("timestamp") },
          { name: "kw_cycle", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("cycle") },
          { name: "kw_function", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("function") },
          { name: "kw_returns", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("returns") },
          { name: "kw_language", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("language") },
          { name: "kw_out", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("out") },
          { name: "kw_inout", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("inout") },
          { name: "kw_variadic", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("variadic") },
          { name: "kw_action", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("action") },
          { name: "kw_restrict", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("restrict") },
          { name: "kw_truncate", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("truncate") },
          { name: "kw_increment", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("increment") },
          { name: "kw_by", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("by") },
          { name: "kw_row", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("row") },
          { name: "kw_rows", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("rows") },
          { name: "kw_next", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("next") },
          { name: "kw_match", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("match") },
          { name: "kw_replace", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("replace") },
          { name: "kw_recursive", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("recursive") },
          { name: "kw_view", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("view") },
          { name: "kw_stored", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("stored") },
          { name: "kw_cascaded", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("cascaded") },
          { name: "kw_unlogged", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("unlogged") },
          { name: "kw_global", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("global") },
          { name: "kw_option", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("option") },
          { name: "kw_materialized", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("materialized") },
          { name: "kw_partial", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("partial") },
          { name: "kw_partition", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("partition") },
          { name: "kw_simple", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("simple") },
          { name: "kw_generated", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("generated") },
          { name: "kw_always", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("always") },
          { name: "kw_identity", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("identity") },
          { name: "kw_name", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("name") },
          { name: "kw_enum", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("enum") },
          { name: "kw_show", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("show") },
          { name: "kw_ordinality", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("ordinality") },
          { name: "kw_overriding", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("overriding") },
          { name: "kw_over", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("over") },
          { name: "kw_system", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("system") },
          { name: "kw_comment", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("comment") },
          { name: "kw_time", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("time") },
          { name: "kw_names", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("names") },
          { name: "kw_at", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("at") },
          { name: "kw_zone", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("zone") },
          { name: "kw_interval", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("interval") },
          { name: "kw_hour", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("hour") },
          { name: "kw_minute", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("minute") },
          { name: "kw_local", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("local") },
          { name: "kw_session", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("session") },
          { name: "kw_prepare", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("prepare") },
          { name: "kw_deallocate", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("deallocate") },
          { name: "kw_raise", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("raise") },
          { name: "kw_continue", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("continue") },
          { name: "kw_share", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("share") },
          { name: "kw_refresh", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("refresh") },
          { name: "kw_nowait", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("nowait") },
          { name: "kw_skip", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("skip") },
          { name: "kw_locked", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("locked") },
          { name: "kw_within", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: notReservedKw("within") },
          { name: "kw_ifnotexists", symbols: ["kw_if", lexer_1.lexerAny.has("kw_not") ? { type: "kw_not" } : kw_not, "kw_exists"] },
          { name: "kw_ifexists", symbols: ["kw_if", "kw_exists"] },
          { name: "kw_withordinality", symbols: [lexer_1.lexerAny.has("kw_with") ? { type: "kw_with" } : kw_with, "kw_ordinality"] },
          { name: "kw_not_null", symbols: [lexer_1.lexerAny.has("kw_not") ? { type: "kw_not" } : kw_not, lexer_1.lexerAny.has("kw_null") ? { type: "kw_null" } : kw_null] },
          { name: "kw_primary_key", symbols: [lexer_1.lexerAny.has("kw_primary") ? { type: "kw_primary" } : kw_primary, "kw_key"] },
          { name: "data_type$ebnf$1$subexpression$1$macrocall$2", symbols: ["int"] },
          { name: "data_type$ebnf$1$subexpression$1$macrocall$1$ebnf$1", symbols: [] },
          { name: "data_type$ebnf$1$subexpression$1$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "data_type$ebnf$1$subexpression$1$macrocall$2"], postprocess: last },
          { name: "data_type$ebnf$1$subexpression$1$macrocall$1$ebnf$1", symbols: ["data_type$ebnf$1$subexpression$1$macrocall$1$ebnf$1", "data_type$ebnf$1$subexpression$1$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "data_type$ebnf$1$subexpression$1$macrocall$1", symbols: ["data_type$ebnf$1$subexpression$1$macrocall$2", "data_type$ebnf$1$subexpression$1$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "data_type$ebnf$1$subexpression$1", symbols: ["lparen", "data_type$ebnf$1$subexpression$1$macrocall$1", "rparen"], postprocess: get(1) },
          { name: "data_type$ebnf$1", symbols: ["data_type$ebnf$1$subexpression$1"], postprocess: id },
          { name: "data_type$ebnf$1", symbols: [], postprocess: () => null },
          { name: "data_type$ebnf$2$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_array") ? { type: "kw_array" } : kw_array] },
          { name: "data_type$ebnf$2$subexpression$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("lbracket") ? { type: "lbracket" } : lbracket, lexer_1.lexerAny.has("rbracket") ? { type: "rbracket" } : rbracket] },
          { name: "data_type$ebnf$2$subexpression$1$ebnf$1", symbols: ["data_type$ebnf$2$subexpression$1$ebnf$1$subexpression$1"] },
          { name: "data_type$ebnf$2$subexpression$1$ebnf$1$subexpression$2", symbols: [lexer_1.lexerAny.has("lbracket") ? { type: "lbracket" } : lbracket, lexer_1.lexerAny.has("rbracket") ? { type: "rbracket" } : rbracket] },
          { name: "data_type$ebnf$2$subexpression$1$ebnf$1", symbols: ["data_type$ebnf$2$subexpression$1$ebnf$1", "data_type$ebnf$2$subexpression$1$ebnf$1$subexpression$2"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "data_type$ebnf$2$subexpression$1", symbols: ["data_type$ebnf$2$subexpression$1$ebnf$1"] },
          { name: "data_type$ebnf$2", symbols: ["data_type$ebnf$2$subexpression$1"], postprocess: id },
          { name: "data_type$ebnf$2", symbols: [], postprocess: () => null },
          { name: "data_type", symbols: ["data_type_simple", "data_type$ebnf$1", "data_type$ebnf$2"], postprocess: (x) => {
            let asArray2 = x[2];
            const name = unwrap2(x[0]);
            let ret;
            ret = {
              ...name,
              ...Array.isArray(x[1]) && x[1].length ? { config: x[1].map(unwrap2) } : {}
            };
            if (asArray2) {
              if (asArray2[0].type === "kw_array") {
                asArray2 = [["array"]];
              }
              for (const _ of asArray2[0]) {
                ret = {
                  kind: "array",
                  arrayOf: ret
                };
              }
            }
            return (0, lexer_2.track)(x, ret);
          } },
          { name: "data_type_list$ebnf$1", symbols: [] },
          { name: "data_type_list$ebnf$1$subexpression$1", symbols: ["comma", "data_type"], postprocess: last },
          { name: "data_type_list$ebnf$1", symbols: ["data_type_list$ebnf$1", "data_type_list$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "data_type_list", symbols: ["data_type", "data_type_list$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "data_type_simple", symbols: ["data_type_text"], postprocess: (x) => (0, lexer_2.track)(x, { name: toStr(x, " ") }) },
          { name: "data_type_simple", symbols: ["data_type_numeric"], postprocess: (x) => (0, lexer_2.track)(x, { name: toStr(x, " ") }) },
          { name: "data_type_simple", symbols: ["data_type_date"] },
          { name: "data_type_simple", symbols: ["qualified_name_mark_quotes"] },
          { name: "data_type_numeric$subexpression$1", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: kw("double") },
          { name: "data_type_numeric", symbols: ["data_type_numeric$subexpression$1", lexer_1.lexerAny.has("kw_precision") ? { type: "kw_precision" } : kw_precision] },
          { name: "data_type_text$subexpression$1", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: anyKw("character", "bit") },
          { name: "data_type_text$subexpression$2", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: kw("varying") },
          { name: "data_type_text", symbols: ["data_type_text$subexpression$1", "data_type_text$subexpression$2"] },
          { name: "data_type_date$subexpression$1", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: anyKw("timestamp", "time") },
          { name: "data_type_date$subexpression$2", symbols: [lexer_1.lexerAny.has("kw_with") ? { type: "kw_with" } : kw_with] },
          { name: "data_type_date$subexpression$2", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: kw("without") },
          { name: "data_type_date$subexpression$3", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: kw("time") },
          { name: "data_type_date$subexpression$4", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: kw("zone") },
          { name: "data_type_date", symbols: ["data_type_date$subexpression$1", "data_type_date$subexpression$2", "data_type_date$subexpression$3", "data_type_date$subexpression$4"], postprocess: (x) => (0, lexer_2.track)(x, { name: toStr(x, " ") }) },
          { name: "data_type_date$subexpression$5", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: anyKw("timestamp", "time") },
          { name: "data_type_date$subexpression$6", symbols: ["lparen", "int", "rparen"], postprocess: get(1) },
          { name: "data_type_date$subexpression$7", symbols: [lexer_1.lexerAny.has("kw_with") ? { type: "kw_with" } : kw_with] },
          { name: "data_type_date$subexpression$7", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: kw("without") },
          { name: "data_type_date$subexpression$8", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: kw("time") },
          { name: "data_type_date$subexpression$9", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: kw("zone") },
          { name: "data_type_date", symbols: ["data_type_date$subexpression$5", "data_type_date$subexpression$6", "data_type_date$subexpression$7", "data_type_date$subexpression$8", "data_type_date$subexpression$9"], postprocess: (x) => (0, lexer_2.track)(x, { name: `timestamp ${toStr(x[2])} time zone`, config: [(0, lexer_2.unbox)(x[1])] }) },
          { name: "ident_aliased$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as, "ident"], postprocess: last },
          { name: "ident_aliased", symbols: ["ident_aliased$subexpression$1"] },
          { name: "ident_aliased", symbols: ["ident"], postprocess: unwrap2 },
          { name: "table_ref", symbols: ["qualified_name"], postprocess: unwrap2 },
          { name: "qcolumn$ebnf$1$subexpression$1", symbols: ["dot", "ident"], postprocess: last },
          { name: "qcolumn$ebnf$1", symbols: ["qcolumn$ebnf$1$subexpression$1"], postprocess: id },
          { name: "qcolumn$ebnf$1", symbols: [], postprocess: () => null },
          { name: "qcolumn", symbols: ["ident", "dot", "ident", "qcolumn$ebnf$1"], postprocess: (x) => {
            if (!x[3]) {
              return (0, lexer_2.track)(x, {
                table: (0, lexer_2.unbox)(x[0]),
                column: (0, lexer_2.unbox)(x[2])
              });
            }
            return (0, lexer_2.track)(x, {
              schema: (0, lexer_2.unbox)(x[0]),
              table: (0, lexer_2.unbox)(x[2]),
              column: (0, lexer_2.unbox)(x[3])
            });
          } },
          { name: "table_ref_aliased$ebnf$1", symbols: ["ident_aliased"], postprocess: id },
          { name: "table_ref_aliased$ebnf$1", symbols: [], postprocess: () => null },
          { name: "table_ref_aliased", symbols: ["table_ref", "table_ref_aliased$ebnf$1"], postprocess: (x) => {
            const alias = unwrap2(x[1]);
            return (0, lexer_2.track)(x, {
              ...unwrap2(x[0]),
              ...alias ? { alias } : {}
            });
          } },
          { name: "qualified_name", symbols: ["qname_ident"], postprocess: (x) => (0, lexer_2.track)(x, { name: toStr(x) }) },
          { name: "qualified_name", symbols: ["ident", "dot", "ident_extended"], postprocess: (x) => {
            const schema = toStr(x[0]);
            const name = toStr(x[2]);
            return (0, lexer_2.track)(x, { schema, name });
          } },
          { name: "qualified_name", symbols: [lexer_1.lexerAny.has("kw_current_schema") ? { type: "kw_current_schema" } : kw_current_schema], postprocess: (x) => (0, lexer_2.track)(x, { name: "current_schema" }) },
          { name: "qualified_name_mark_quotes", symbols: ["qname_ident"], postprocess: (x) => (0, lexer_2.track)(x, { name: toStr(x), ...(0, lexer_2.doubleQuoted)(x) }) },
          { name: "qualified_name_mark_quotes", symbols: ["ident", "dot", "ident_extended"], postprocess: (x) => {
            const schema = toStr(x[0]);
            const name = toStr(x[2]);
            return (0, lexer_2.track)(x, { schema, name, ...(0, lexer_2.doubleQuoted)(x[2]) });
          } },
          { name: "qualified_name_mark_quotes", symbols: [lexer_1.lexerAny.has("kw_current_schema") ? { type: "kw_current_schema" } : kw_current_schema], postprocess: (x) => (0, lexer_2.track)(x, { name: "current_schema" }) },
          { name: "qname_ident", symbols: ["ident"] },
          { name: "qname_ident", symbols: [lexer_1.lexerAny.has("kw_precision") ? { type: "kw_precision" } : kw_precision] },
          { name: "qname", symbols: ["qualified_name"], postprocess: unwrap2 },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_all") ? { type: "kw_all" } : kw_all] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_analyse") ? { type: "kw_analyse" } : kw_analyse] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_analyze") ? { type: "kw_analyze" } : kw_analyze] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_and") ? { type: "kw_and" } : kw_and] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_any") ? { type: "kw_any" } : kw_any] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_array") ? { type: "kw_array" } : kw_array] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_asc") ? { type: "kw_asc" } : kw_asc] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_asymmetric") ? { type: "kw_asymmetric" } : kw_asymmetric] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_authorization") ? { type: "kw_authorization" } : kw_authorization] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_binary") ? { type: "kw_binary" } : kw_binary] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_both") ? { type: "kw_both" } : kw_both] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_case") ? { type: "kw_case" } : kw_case] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_cast") ? { type: "kw_cast" } : kw_cast] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_check") ? { type: "kw_check" } : kw_check] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_collate") ? { type: "kw_collate" } : kw_collate] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_collation") ? { type: "kw_collation" } : kw_collation] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_concurrently") ? { type: "kw_concurrently" } : kw_concurrently] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_constraint") ? { type: "kw_constraint" } : kw_constraint] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_create") ? { type: "kw_create" } : kw_create] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_cross") ? { type: "kw_cross" } : kw_cross] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_current_catalog") ? { type: "kw_current_catalog" } : kw_current_catalog] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_current_date") ? { type: "kw_current_date" } : kw_current_date] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_current_role") ? { type: "kw_current_role" } : kw_current_role] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_current_schema") ? { type: "kw_current_schema" } : kw_current_schema] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_current_time") ? { type: "kw_current_time" } : kw_current_time] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_current_timestamp") ? { type: "kw_current_timestamp" } : kw_current_timestamp] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_current_user") ? { type: "kw_current_user" } : kw_current_user] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_default") ? { type: "kw_default" } : kw_default] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_deferrable") ? { type: "kw_deferrable" } : kw_deferrable] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_desc") ? { type: "kw_desc" } : kw_desc] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_distinct") ? { type: "kw_distinct" } : kw_distinct] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_do") ? { type: "kw_do" } : kw_do] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_else") ? { type: "kw_else" } : kw_else] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_end") ? { type: "kw_end" } : kw_end] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_except") ? { type: "kw_except" } : kw_except] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_false") ? { type: "kw_false" } : kw_false] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_fetch") ? { type: "kw_fetch" } : kw_fetch] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_for") ? { type: "kw_for" } : kw_for] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_foreign") ? { type: "kw_foreign" } : kw_foreign] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_freeze") ? { type: "kw_freeze" } : kw_freeze] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_from") ? { type: "kw_from" } : kw_from] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_full") ? { type: "kw_full" } : kw_full] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_grant") ? { type: "kw_grant" } : kw_grant] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_group") ? { type: "kw_group" } : kw_group] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_having") ? { type: "kw_having" } : kw_having] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_ilike") ? { type: "kw_ilike" } : kw_ilike] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_in") ? { type: "kw_in" } : kw_in] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_initially") ? { type: "kw_initially" } : kw_initially] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_inner") ? { type: "kw_inner" } : kw_inner] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_intersect") ? { type: "kw_intersect" } : kw_intersect] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_into") ? { type: "kw_into" } : kw_into] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_is") ? { type: "kw_is" } : kw_is] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_isnull") ? { type: "kw_isnull" } : kw_isnull] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_join") ? { type: "kw_join" } : kw_join] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_lateral") ? { type: "kw_lateral" } : kw_lateral] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_leading") ? { type: "kw_leading" } : kw_leading] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_left") ? { type: "kw_left" } : kw_left] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_like") ? { type: "kw_like" } : kw_like] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_limit") ? { type: "kw_limit" } : kw_limit] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_localtime") ? { type: "kw_localtime" } : kw_localtime] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_localtimestamp") ? { type: "kw_localtimestamp" } : kw_localtimestamp] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_natural") ? { type: "kw_natural" } : kw_natural] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_not") ? { type: "kw_not" } : kw_not] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_notnull") ? { type: "kw_notnull" } : kw_notnull] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_null") ? { type: "kw_null" } : kw_null] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_offset") ? { type: "kw_offset" } : kw_offset] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_on") ? { type: "kw_on" } : kw_on] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_only") ? { type: "kw_only" } : kw_only] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_or") ? { type: "kw_or" } : kw_or] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_order") ? { type: "kw_order" } : kw_order] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_outer") ? { type: "kw_outer" } : kw_outer] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_overlaps") ? { type: "kw_overlaps" } : kw_overlaps] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_placing") ? { type: "kw_placing" } : kw_placing] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_primary") ? { type: "kw_primary" } : kw_primary] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_references") ? { type: "kw_references" } : kw_references] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_returning") ? { type: "kw_returning" } : kw_returning] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_right") ? { type: "kw_right" } : kw_right] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_select") ? { type: "kw_select" } : kw_select] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_session_user") ? { type: "kw_session_user" } : kw_session_user] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_similar") ? { type: "kw_similar" } : kw_similar] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_some") ? { type: "kw_some" } : kw_some] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_symmetric") ? { type: "kw_symmetric" } : kw_symmetric] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_table") ? { type: "kw_table" } : kw_table] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_tablesample") ? { type: "kw_tablesample" } : kw_tablesample] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_then") ? { type: "kw_then" } : kw_then] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_to") ? { type: "kw_to" } : kw_to] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_trailing") ? { type: "kw_trailing" } : kw_trailing] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_true") ? { type: "kw_true" } : kw_true] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_union") ? { type: "kw_union" } : kw_union] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_unique") ? { type: "kw_unique" } : kw_unique] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_user") ? { type: "kw_user" } : kw_user] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_using") ? { type: "kw_using" } : kw_using] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_variadic") ? { type: "kw_variadic" } : kw_variadic] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_verbose") ? { type: "kw_verbose" } : kw_verbose] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_when") ? { type: "kw_when" } : kw_when] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_where") ? { type: "kw_where" } : kw_where] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_window") ? { type: "kw_window" } : kw_window] },
          { name: "any_keyword", symbols: [lexer_1.lexerAny.has("kw_with") ? { type: "kw_with" } : kw_with] },
          { name: "ident_extended", symbols: ["ident"] },
          { name: "ident_extended", symbols: ["any_keyword"] },
          { name: "select_statement$ebnf$1", symbols: ["select_from"], postprocess: id },
          { name: "select_statement$ebnf$1", symbols: [], postprocess: () => null },
          { name: "select_statement$ebnf$2", symbols: ["select_where"], postprocess: id },
          { name: "select_statement$ebnf$2", symbols: [], postprocess: () => null },
          { name: "select_statement$ebnf$3$subexpression$1$ebnf$1", symbols: ["select_having"], postprocess: id },
          { name: "select_statement$ebnf$3$subexpression$1$ebnf$1", symbols: [], postprocess: () => null },
          { name: "select_statement$ebnf$3$subexpression$1", symbols: ["select_groupby", "select_statement$ebnf$3$subexpression$1$ebnf$1"] },
          { name: "select_statement$ebnf$3", symbols: ["select_statement$ebnf$3$subexpression$1"], postprocess: id },
          { name: "select_statement$ebnf$3", symbols: [], postprocess: () => null },
          { name: "select_statement$ebnf$4", symbols: ["select_order_by"], postprocess: id },
          { name: "select_statement$ebnf$4", symbols: [], postprocess: () => null },
          { name: "select_statement$ebnf$5", symbols: ["select_limit_offset"], postprocess: id },
          { name: "select_statement$ebnf$5", symbols: [], postprocess: () => null },
          { name: "select_statement$ebnf$6$subexpression$1$ebnf$1", symbols: ["select_skip"], postprocess: id },
          { name: "select_statement$ebnf$6$subexpression$1$ebnf$1", symbols: [], postprocess: () => null },
          { name: "select_statement$ebnf$6$subexpression$1", symbols: ["select_for", "select_statement$ebnf$6$subexpression$1$ebnf$1"] },
          { name: "select_statement$ebnf$6", symbols: ["select_statement$ebnf$6$subexpression$1"], postprocess: id },
          { name: "select_statement$ebnf$6", symbols: [], postprocess: () => null },
          { name: "select_statement", symbols: ["select_what", "select_statement$ebnf$1", "select_statement$ebnf$2", "select_statement$ebnf$3", "select_statement$ebnf$4", "select_statement$ebnf$5", "select_statement$ebnf$6"], postprocess: (x) => {
            let [what, from, where, _groupBy, orderBy, limit, _selectFor] = x;
            from = unwrap2(from);
            let groupBy = _groupBy && _groupBy[0];
            let having = _groupBy && _groupBy[1];
            groupBy = groupBy && (groupBy.length === 1 && groupBy[0].type === "list" ? groupBy[0].expressions : groupBy);
            having = having && unwrap2(having);
            let selectFor = _selectFor && _selectFor[0];
            let skip = _selectFor && _selectFor[1];
            skip = unwrap2(skip);
            return (0, lexer_2.track)(x, {
              ...what,
              ...from ? { from: Array.isArray(from) ? from : [from] } : {},
              ...groupBy ? { groupBy } : {},
              ...having ? { having } : {},
              ...limit ? { limit: unwrap2(limit) } : {},
              ...orderBy ? { orderBy } : {},
              ...where ? { where } : {},
              ...selectFor ? { for: selectFor[1] } : {},
              ...skip ? { skip } : {},
              type: "select"
            });
          } },
          { name: "select_from", symbols: [lexer_1.lexerAny.has("kw_from") ? { type: "kw_from" } : kw_from, "select_from_items"], postprocess: last },
          { name: "select_from_items$ebnf$1", symbols: [] },
          { name: "select_from_items$ebnf$1$subexpression$1", symbols: ["comma", "select_from_item"], postprocess: last },
          { name: "select_from_items$ebnf$1", symbols: ["select_from_items$ebnf$1", "select_from_items$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "select_from_items", symbols: ["select_from_item", "select_from_items$ebnf$1"], postprocess: ([head, tail]) => {
            return [...head, ...flatten(tail) || []];
          } },
          { name: "select_from_item", symbols: ["select_from_subject"] },
          { name: "select_from_item", symbols: ["select_from_item_joins"], postprocess: get(0) },
          { name: "select_from_item_joins$subexpression$1", symbols: ["select_from_item"], postprocess: get(0) },
          { name: "select_from_item_joins", symbols: ["select_from_item_joins$subexpression$1", "select_table_join"], postprocess: flatten },
          { name: "select_from_item_joins", symbols: ["lparen", "select_from_item_joins", "rparen"], postprocess: get(1) },
          { name: "select_from_subject", symbols: ["stb_table"], postprocess: unwrap2 },
          { name: "select_from_subject", symbols: ["stb_statement"], postprocess: unwrap2 },
          { name: "select_from_subject", symbols: ["stb_call"], postprocess: unwrap2 },
          { name: "stb_opts$ebnf$1", symbols: ["collist_paren"], postprocess: id },
          { name: "stb_opts$ebnf$1", symbols: [], postprocess: () => null },
          { name: "stb_opts", symbols: ["ident_aliased", "stb_opts$ebnf$1"], postprocess: (x) => (0, lexer_2.track)(x, {
            alias: toStr(x[0]),
            ...x[1] && { columnNames: (0, lexer_2.unbox)(x[1]).map(asName) }
          }) },
          { name: "stb_table$ebnf$1", symbols: ["stb_opts"], postprocess: id },
          { name: "stb_table$ebnf$1", symbols: [], postprocess: () => null },
          { name: "stb_table", symbols: ["table_ref", "stb_table$ebnf$1"], postprocess: (x) => {
            return (0, lexer_2.track)(x, {
              type: "table",
              name: (0, lexer_2.track)(x, {
                ...x[0],
                ...x[1]
              })
            });
          } },
          { name: "stb_statement$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_lateral") ? { type: "kw_lateral" } : kw_lateral], postprocess: id },
          { name: "stb_statement$ebnf$1", symbols: [], postprocess: () => null },
          { name: "stb_statement", symbols: ["stb_statement$ebnf$1", "selection_paren", "stb_opts"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "statement",
            statement: unwrap2(x[1]),
            ...x[0] && { lateral: true },
            ...x[2]
          }) },
          { name: "select_values", symbols: ["kw_values", "insert_values"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "values",
            values: x[1]
          }) },
          { name: "stb_call$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_lateral") ? { type: "kw_lateral" } : kw_lateral], postprocess: id },
          { name: "stb_call$ebnf$1", symbols: [], postprocess: () => null },
          { name: "stb_call$ebnf$2", symbols: ["kw_withordinality"], postprocess: id },
          { name: "stb_call$ebnf$2", symbols: [], postprocess: () => null },
          { name: "stb_call$ebnf$3", symbols: ["stb_call_alias"], postprocess: id },
          { name: "stb_call$ebnf$3", symbols: [], postprocess: () => null },
          { name: "stb_call", symbols: ["stb_call$ebnf$1", "expr_function_call", "stb_call$ebnf$2", "stb_call$ebnf$3"], postprocess: (x) => {
            const lateral = x[0];
            const withOrdinality = x[2];
            const alias = x[3];
            if (!withOrdinality && !alias) {
              return x[1];
            }
            return (0, lexer_2.track)(x, {
              ...x[1],
              ...lateral && { lateral: true },
              ...withOrdinality && { withOrdinality: true },
              alias: alias ? asNameWithColumns(alias[0], alias[1]) : undefined
            });
          } },
          { name: "stb_call_alias$subexpression$1$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as], postprocess: id },
          { name: "stb_call_alias$subexpression$1$ebnf$1", symbols: [], postprocess: () => null },
          { name: "stb_call_alias$subexpression$1", symbols: ["stb_call_alias$subexpression$1$ebnf$1", "ident"], postprocess: last },
          { name: "stb_call_alias$ebnf$1", symbols: ["stb_call_alias_list"], postprocess: id },
          { name: "stb_call_alias$ebnf$1", symbols: [], postprocess: () => null },
          { name: "stb_call_alias", symbols: ["stb_call_alias$subexpression$1", "stb_call_alias$ebnf$1"] },
          { name: "stb_call_alias_list", symbols: ["lparen", "stb_call_alias_list_raw", "rparen"], postprocess: get(1) },
          { name: "stb_call_alias_list_raw$ebnf$1", symbols: [] },
          { name: "stb_call_alias_list_raw$ebnf$1$subexpression$1", symbols: ["comma", "ident"], postprocess: last },
          { name: "stb_call_alias_list_raw$ebnf$1", symbols: ["stb_call_alias_list_raw$ebnf$1", "stb_call_alias_list_raw$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "stb_call_alias_list_raw", symbols: ["ident", "stb_call_alias_list_raw$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "select_table_join$ebnf$1", symbols: ["select_table_join_clause"], postprocess: id },
          { name: "select_table_join$ebnf$1", symbols: [], postprocess: () => null },
          { name: "select_table_join", symbols: ["select_join_op", lexer_1.lexerAny.has("kw_join") ? { type: "kw_join" } : kw_join, "select_from_subject", "select_table_join$ebnf$1"], postprocess: (x) => (0, lexer_2.track)(x, {
            ...unwrap2(x[2]),
            join: {
              type: toStr(x[0], " "),
              ...x[3] && unwrap2(x[3])
            }
          }) },
          { name: "select_table_join_clause", symbols: [lexer_1.lexerAny.has("kw_on") ? { type: "kw_on" } : kw_on, "expr"], postprocess: (x) => (0, lexer_2.track)(x, { on: last(x) }) },
          { name: "select_table_join_clause$macrocall$2", symbols: ["ident"] },
          { name: "select_table_join_clause$macrocall$1$ebnf$1", symbols: [] },
          { name: "select_table_join_clause$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "select_table_join_clause$macrocall$2"], postprocess: last },
          { name: "select_table_join_clause$macrocall$1$ebnf$1", symbols: ["select_table_join_clause$macrocall$1$ebnf$1", "select_table_join_clause$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "select_table_join_clause$macrocall$1", symbols: ["select_table_join_clause$macrocall$2", "select_table_join_clause$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "select_table_join_clause", symbols: [lexer_1.lexerAny.has("kw_using") ? { type: "kw_using" } : kw_using, "lparen", "select_table_join_clause$macrocall$1", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, { using: x[2].map(asName) }) },
          { name: "select_join_op$subexpression$1$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_inner") ? { type: "kw_inner" } : kw_inner], postprocess: id },
          { name: "select_join_op$subexpression$1$ebnf$1", symbols: [], postprocess: () => null },
          { name: "select_join_op$subexpression$1", symbols: ["select_join_op$subexpression$1$ebnf$1"], postprocess: (x) => (0, lexer_2.box)(x, "INNER JOIN") },
          { name: "select_join_op", symbols: ["select_join_op$subexpression$1"] },
          { name: "select_join_op$subexpression$2", symbols: [lexer_1.lexerAny.has("kw_cross") ? { type: "kw_cross" } : kw_cross], postprocess: (x) => (0, lexer_2.box)(x, "CROSS JOIN") },
          { name: "select_join_op", symbols: ["select_join_op$subexpression$2"] },
          { name: "select_join_op$subexpression$3$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_outer") ? { type: "kw_outer" } : kw_outer], postprocess: id },
          { name: "select_join_op$subexpression$3$ebnf$1", symbols: [], postprocess: () => null },
          { name: "select_join_op$subexpression$3", symbols: [lexer_1.lexerAny.has("kw_left") ? { type: "kw_left" } : kw_left, "select_join_op$subexpression$3$ebnf$1"], postprocess: (x) => (0, lexer_2.box)(x, "LEFT JOIN") },
          { name: "select_join_op", symbols: ["select_join_op$subexpression$3"] },
          { name: "select_join_op$subexpression$4$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_outer") ? { type: "kw_outer" } : kw_outer], postprocess: id },
          { name: "select_join_op$subexpression$4$ebnf$1", symbols: [], postprocess: () => null },
          { name: "select_join_op$subexpression$4", symbols: [lexer_1.lexerAny.has("kw_right") ? { type: "kw_right" } : kw_right, "select_join_op$subexpression$4$ebnf$1"], postprocess: (x) => (0, lexer_2.box)(x, "RIGHT JOIN") },
          { name: "select_join_op", symbols: ["select_join_op$subexpression$4"] },
          { name: "select_join_op$subexpression$5$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_outer") ? { type: "kw_outer" } : kw_outer], postprocess: id },
          { name: "select_join_op$subexpression$5$ebnf$1", symbols: [], postprocess: () => null },
          { name: "select_join_op$subexpression$5", symbols: [lexer_1.lexerAny.has("kw_full") ? { type: "kw_full" } : kw_full, "select_join_op$subexpression$5$ebnf$1"], postprocess: (x) => (0, lexer_2.box)(x, "FULL JOIN") },
          { name: "select_join_op", symbols: ["select_join_op$subexpression$5"] },
          { name: "select_what$ebnf$1", symbols: ["select_distinct"], postprocess: id },
          { name: "select_what$ebnf$1", symbols: [], postprocess: () => null },
          { name: "select_what$ebnf$2", symbols: ["select_expr_list_aliased"], postprocess: id },
          { name: "select_what$ebnf$2", symbols: [], postprocess: () => null },
          { name: "select_what", symbols: [lexer_1.lexerAny.has("kw_select") ? { type: "kw_select" } : kw_select, "select_what$ebnf$1", "select_what$ebnf$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            columns: x[2],
            ...x[1] && { distinct: (0, lexer_2.unbox)(x[1]) }
          }) },
          { name: "select_expr_list_aliased$ebnf$1", symbols: [] },
          { name: "select_expr_list_aliased$ebnf$1$subexpression$1", symbols: ["comma", "select_expr_list_item"], postprocess: last },
          { name: "select_expr_list_aliased$ebnf$1", symbols: ["select_expr_list_aliased$ebnf$1", "select_expr_list_aliased$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "select_expr_list_aliased", symbols: ["select_expr_list_item", "select_expr_list_aliased$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "select_expr_list_item$ebnf$1", symbols: ["ident_aliased"], postprocess: id },
          { name: "select_expr_list_item$ebnf$1", symbols: [], postprocess: () => null },
          { name: "select_expr_list_item", symbols: ["expr", "select_expr_list_item$ebnf$1"], postprocess: (x) => (0, lexer_2.track)(x, {
            expr: x[0],
            ...x[1] ? { alias: asName(x[1]) } : {}
          }) },
          { name: "select_distinct", symbols: [lexer_1.lexerAny.has("kw_all") ? { type: "kw_all" } : kw_all], postprocess: (x) => (0, lexer_2.box)(x, "all") },
          { name: "select_distinct$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_on") ? { type: "kw_on" } : kw_on, "lparen", "expr_list_raw", "rparen"], postprocess: get(2) },
          { name: "select_distinct$ebnf$1", symbols: ["select_distinct$ebnf$1$subexpression$1"], postprocess: id },
          { name: "select_distinct$ebnf$1", symbols: [], postprocess: () => null },
          { name: "select_distinct", symbols: [lexer_1.lexerAny.has("kw_distinct") ? { type: "kw_distinct" } : kw_distinct, "select_distinct$ebnf$1"], postprocess: (x) => (0, lexer_2.box)(x, x[1] || "distinct") },
          { name: "select_where", symbols: [lexer_1.lexerAny.has("kw_where") ? { type: "kw_where" } : kw_where, "expr"], postprocess: last },
          { name: "select_groupby", symbols: [lexer_1.lexerAny.has("kw_group") ? { type: "kw_group" } : kw_group, "kw_by", "expr_list_raw"], postprocess: last },
          { name: "select_having", symbols: [lexer_1.lexerAny.has("kw_having") ? { type: "kw_having" } : kw_having, "expr"], postprocess: last },
          { name: "select_limit_offset$ebnf$1$subexpression$1", symbols: ["select_offset"] },
          { name: "select_limit_offset$ebnf$1$subexpression$1", symbols: ["select_limit"] },
          { name: "select_limit_offset$ebnf$1", symbols: ["select_limit_offset$ebnf$1$subexpression$1"] },
          { name: "select_limit_offset$ebnf$1$subexpression$2", symbols: ["select_offset"] },
          { name: "select_limit_offset$ebnf$1$subexpression$2", symbols: ["select_limit"] },
          { name: "select_limit_offset$ebnf$1", symbols: ["select_limit_offset$ebnf$1", "select_limit_offset$ebnf$1$subexpression$2"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "select_limit_offset", symbols: ["select_limit_offset$ebnf$1"], postprocess: (x, rej) => {
            const value3 = unwrap2(x);
            if (!Array.isArray(value3)) {
              return (0, lexer_2.track)(x, value3);
            }
            if (value3.length != 2) {
              return rej;
            }
            const a = unwrap2(value3[0]);
            const b = unwrap2(value3[1]);
            if (a.offset && b.offset || a.limit && b.limit) {
              return rej;
            }
            return (0, lexer_2.track)(x, {
              ...a,
              ...b
            });
          } },
          { name: "select_offset$ebnf$1$subexpression$1", symbols: ["kw_row"] },
          { name: "select_offset$ebnf$1$subexpression$1", symbols: ["kw_rows"] },
          { name: "select_offset$ebnf$1", symbols: ["select_offset$ebnf$1$subexpression$1"], postprocess: id },
          { name: "select_offset$ebnf$1", symbols: [], postprocess: () => null },
          { name: "select_offset", symbols: [lexer_1.lexerAny.has("kw_offset") ? { type: "kw_offset" } : kw_offset, "expr_nostar", "select_offset$ebnf$1"], postprocess: (x) => (0, lexer_2.track)(x, { offset: unwrap2(x[1]) }) },
          { name: "select_limit$subexpression$1", symbols: ["select_limit_1"] },
          { name: "select_limit$subexpression$1", symbols: ["select_limit_2"] },
          { name: "select_limit", symbols: ["select_limit$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, { limit: unwrap2(x) }) },
          { name: "select_limit_1", symbols: [lexer_1.lexerAny.has("kw_limit") ? { type: "kw_limit" } : kw_limit, "expr_nostar"], postprocess: last },
          { name: "select_limit_2$ebnf$1$subexpression$1", symbols: ["kw_first"] },
          { name: "select_limit_2$ebnf$1$subexpression$1", symbols: ["kw_next"] },
          { name: "select_limit_2$ebnf$1", symbols: ["select_limit_2$ebnf$1$subexpression$1"], postprocess: id },
          { name: "select_limit_2$ebnf$1", symbols: [], postprocess: () => null },
          { name: "select_limit_2$subexpression$1", symbols: ["kw_row"] },
          { name: "select_limit_2$subexpression$1", symbols: ["kw_rows"] },
          { name: "select_limit_2", symbols: [lexer_1.lexerAny.has("kw_fetch") ? { type: "kw_fetch" } : kw_fetch, "select_limit_2$ebnf$1", "expr_nostar", "select_limit_2$subexpression$1", lexer_1.lexerAny.has("kw_only") ? { type: "kw_only" } : kw_only], postprocess: get(2) },
          { name: "select_for$subexpression$1", symbols: ["kw_update"], postprocess: (x) => (0, lexer_2.track)(x, { type: "update" }) },
          { name: "select_for$subexpression$1", symbols: ["kw_no", "kw_key", "kw_update"], postprocess: (x) => (0, lexer_2.track)(x, { type: "no key update" }) },
          { name: "select_for$subexpression$1", symbols: ["kw_share"], postprocess: (x) => (0, lexer_2.track)(x, { type: "share" }) },
          { name: "select_for$subexpression$1", symbols: ["kw_key", "kw_share"], postprocess: (x) => (0, lexer_2.track)(x, { type: "key share" }) },
          { name: "select_for", symbols: [lexer_1.lexerAny.has("kw_for") ? { type: "kw_for" } : kw_for, "select_for$subexpression$1"] },
          { name: "select_skip$subexpression$1", symbols: ["kw_nowait"], postprocess: (x) => (0, lexer_2.track)(x, { type: "nowait" }) },
          { name: "select_skip$subexpression$1", symbols: ["kw_skip", "kw_locked"], postprocess: (x) => (0, lexer_2.track)(x, { type: "skip locked" }) },
          { name: "select_skip", symbols: ["select_skip$subexpression$1"] },
          { name: "select_order_by$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_order") ? { type: "kw_order" } : kw_order, "kw_by"] },
          { name: "select_order_by$ebnf$1", symbols: [] },
          { name: "select_order_by$ebnf$1$subexpression$1", symbols: ["comma", "select_order_by_expr"], postprocess: last },
          { name: "select_order_by$ebnf$1", symbols: ["select_order_by$ebnf$1", "select_order_by$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "select_order_by", symbols: ["select_order_by$subexpression$1", "select_order_by_expr", "select_order_by$ebnf$1"], postprocess: ([_, head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "select_order_by_expr$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_asc") ? { type: "kw_asc" } : kw_asc] },
          { name: "select_order_by_expr$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_desc") ? { type: "kw_desc" } : kw_desc] },
          { name: "select_order_by_expr$ebnf$1", symbols: ["select_order_by_expr$ebnf$1$subexpression$1"], postprocess: id },
          { name: "select_order_by_expr$ebnf$1", symbols: [], postprocess: () => null },
          { name: "select_order_by_expr$ebnf$2$subexpression$1$subexpression$1", symbols: ["kw_first"] },
          { name: "select_order_by_expr$ebnf$2$subexpression$1$subexpression$1", symbols: ["kw_last"] },
          { name: "select_order_by_expr$ebnf$2$subexpression$1", symbols: ["kw_nulls", "select_order_by_expr$ebnf$2$subexpression$1$subexpression$1"], postprocess: last },
          { name: "select_order_by_expr$ebnf$2", symbols: ["select_order_by_expr$ebnf$2$subexpression$1"], postprocess: id },
          { name: "select_order_by_expr$ebnf$2", symbols: [], postprocess: () => null },
          { name: "select_order_by_expr", symbols: ["expr", "select_order_by_expr$ebnf$1", "select_order_by_expr$ebnf$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            by: x[0],
            ...x[1] && { order: toStr(x[1]).toUpperCase() },
            ...x[2] && { nulls: toStr(x[2]).toUpperCase() }
          }) },
          { name: "expr", symbols: ["expr_nostar"], postprocess: unwrap2 },
          { name: "expr", symbols: ["expr_star"], postprocess: unwrap2 },
          { name: "expr_nostar", symbols: ["expr_paren"], postprocess: unwrap2 },
          { name: "expr_nostar", symbols: ["expr_or"], postprocess: unwrap2 },
          { name: "expr_paren$subexpression$1", symbols: ["expr_or_select"] },
          { name: "expr_paren$subexpression$1", symbols: ["expr_list_many"] },
          { name: "expr_paren", symbols: ["lparen", "expr_paren$subexpression$1", "rparen"], postprocess: get(1) },
          { name: "expr_or$macrocall$2$macrocall$2", symbols: [lexer_1.lexerAny.has("kw_or") ? { type: "kw_or" } : kw_or] },
          { name: "expr_or$macrocall$2$macrocall$1", symbols: ["expr_or$macrocall$2$macrocall$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x, " ") || "<error>").toUpperCase()
          }) },
          { name: "expr_or$macrocall$2", symbols: ["expr_or$macrocall$2$macrocall$1"] },
          { name: "expr_or$macrocall$3", symbols: ["expr_or"] },
          { name: "expr_or$macrocall$4", symbols: ["expr_and"] },
          { name: "expr_or$macrocall$1$subexpression$1", symbols: ["expr_or$macrocall$3"] },
          { name: "expr_or$macrocall$1$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_or$macrocall$1$subexpression$2", symbols: ["expr_or$macrocall$4"] },
          { name: "expr_or$macrocall$1$subexpression$2", symbols: ["expr_paren"] },
          { name: "expr_or$macrocall$1", symbols: ["expr_or$macrocall$1$subexpression$1", "expr_or$macrocall$2", "expr_or$macrocall$1$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "binary",
            left: unwrap2(x[0]),
            right: unwrap2(x[2]),
            ...unwrap2(x[1])
          }) },
          { name: "expr_or$macrocall$1", symbols: ["expr_or$macrocall$4"], postprocess: unwrap2 },
          { name: "expr_or", symbols: ["expr_or$macrocall$1"] },
          { name: "expr_and$macrocall$2$macrocall$2", symbols: [lexer_1.lexerAny.has("kw_and") ? { type: "kw_and" } : kw_and] },
          { name: "expr_and$macrocall$2$macrocall$1", symbols: ["expr_and$macrocall$2$macrocall$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x, " ") || "<error>").toUpperCase()
          }) },
          { name: "expr_and$macrocall$2", symbols: ["expr_and$macrocall$2$macrocall$1"] },
          { name: "expr_and$macrocall$3", symbols: ["expr_and"] },
          { name: "expr_and$macrocall$4", symbols: ["expr_not"] },
          { name: "expr_and$macrocall$1$subexpression$1", symbols: ["expr_and$macrocall$3"] },
          { name: "expr_and$macrocall$1$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_and$macrocall$1$subexpression$2", symbols: ["expr_and$macrocall$4"] },
          { name: "expr_and$macrocall$1$subexpression$2", symbols: ["expr_paren"] },
          { name: "expr_and$macrocall$1", symbols: ["expr_and$macrocall$1$subexpression$1", "expr_and$macrocall$2", "expr_and$macrocall$1$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "binary",
            left: unwrap2(x[0]),
            right: unwrap2(x[2]),
            ...unwrap2(x[1])
          }) },
          { name: "expr_and$macrocall$1", symbols: ["expr_and$macrocall$4"], postprocess: unwrap2 },
          { name: "expr_and", symbols: ["expr_and$macrocall$1"] },
          { name: "expr_not$macrocall$2$macrocall$2", symbols: [lexer_1.lexerAny.has("kw_not") ? { type: "kw_not" } : kw_not] },
          { name: "expr_not$macrocall$2$macrocall$1", symbols: ["expr_not$macrocall$2$macrocall$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x, " ") || "<error>").toUpperCase()
          }) },
          { name: "expr_not$macrocall$2", symbols: ["expr_not$macrocall$2$macrocall$1"] },
          { name: "expr_not$macrocall$3", symbols: ["expr_not"] },
          { name: "expr_not$macrocall$4", symbols: ["expr_eq"] },
          { name: "expr_not$macrocall$1$subexpression$1", symbols: ["expr_not$macrocall$3"] },
          { name: "expr_not$macrocall$1$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_not$macrocall$1", symbols: ["expr_not$macrocall$2", "expr_not$macrocall$1$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "unary",
            ...unwrap2(x[0]),
            operand: unwrap2(x[1])
          }) },
          { name: "expr_not$macrocall$1", symbols: ["expr_not$macrocall$4"], postprocess: unwrap2 },
          { name: "expr_not", symbols: ["expr_not$macrocall$1"] },
          { name: "expr_eq$macrocall$2$macrocall$2$subexpression$1", symbols: [lexer_1.lexerAny.has("op_eq") ? { type: "op_eq" } : op_eq] },
          { name: "expr_eq$macrocall$2$macrocall$2$subexpression$1", symbols: [lexer_1.lexerAny.has("op_neq") ? { type: "op_neq" } : op_neq] },
          { name: "expr_eq$macrocall$2$macrocall$2", symbols: ["expr_eq$macrocall$2$macrocall$2$subexpression$1"] },
          { name: "expr_eq$macrocall$2$macrocall$1$macrocall$2", symbols: ["expr_eq$macrocall$2$macrocall$2"] },
          { name: "expr_eq$macrocall$2$macrocall$1$macrocall$1", symbols: ["expr_eq$macrocall$2$macrocall$1$macrocall$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x, " ") || "<error>").toUpperCase()
          }) },
          { name: "expr_eq$macrocall$2$macrocall$1", symbols: ["expr_eq$macrocall$2$macrocall$1$macrocall$1"], postprocess: unwrap2 },
          { name: "expr_eq$macrocall$2$macrocall$1", symbols: ["kw_operator", "lparen", "ident", "dot", "expr_eq$macrocall$2$macrocall$2", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x[4], " ") || "<error>").toUpperCase(),
            opSchema: toStr(x[2])
          }) },
          { name: "expr_eq$macrocall$2", symbols: ["expr_eq$macrocall$2$macrocall$1"] },
          { name: "expr_eq$macrocall$3", symbols: ["expr_eq"] },
          { name: "expr_eq$macrocall$4", symbols: ["expr_is"] },
          { name: "expr_eq$macrocall$1$subexpression$1", symbols: ["expr_eq$macrocall$3"] },
          { name: "expr_eq$macrocall$1$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_eq$macrocall$1$subexpression$2", symbols: ["expr_eq$macrocall$4"] },
          { name: "expr_eq$macrocall$1$subexpression$2", symbols: ["expr_paren"] },
          { name: "expr_eq$macrocall$1", symbols: ["expr_eq$macrocall$1$subexpression$1", "expr_eq$macrocall$2", "expr_eq$macrocall$1$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "binary",
            left: unwrap2(x[0]),
            right: unwrap2(x[2]),
            ...unwrap2(x[1])
          }) },
          { name: "expr_eq$macrocall$1", symbols: ["expr_eq$macrocall$4"], postprocess: unwrap2 },
          { name: "expr_eq", symbols: ["expr_eq$macrocall$1"] },
          { name: "expr_star", symbols: ["star"], postprocess: (x) => (0, lexer_2.track)(x, { type: "ref", name: "*" }) },
          { name: "expr_is$subexpression$1", symbols: ["expr_is"] },
          { name: "expr_is$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_is$subexpression$2", symbols: [lexer_1.lexerAny.has("kw_isnull") ? { type: "kw_isnull" } : kw_isnull] },
          { name: "expr_is$subexpression$2", symbols: [lexer_1.lexerAny.has("kw_is") ? { type: "kw_is" } : kw_is, lexer_1.lexerAny.has("kw_null") ? { type: "kw_null" } : kw_null] },
          { name: "expr_is", symbols: ["expr_is$subexpression$1", "expr_is$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, { type: "unary", op: "IS NULL", operand: unwrap2(x[0]) }) },
          { name: "expr_is$subexpression$3", symbols: ["expr_is"] },
          { name: "expr_is$subexpression$3", symbols: ["expr_paren"] },
          { name: "expr_is$subexpression$4", symbols: [lexer_1.lexerAny.has("kw_notnull") ? { type: "kw_notnull" } : kw_notnull] },
          { name: "expr_is$subexpression$4", symbols: [lexer_1.lexerAny.has("kw_is") ? { type: "kw_is" } : kw_is, "kw_not_null"] },
          { name: "expr_is", symbols: ["expr_is$subexpression$3", "expr_is$subexpression$4"], postprocess: (x) => (0, lexer_2.track)(x, { type: "unary", op: "IS NOT NULL", operand: unwrap2(x[0]) }) },
          { name: "expr_is$subexpression$5", symbols: ["expr_is"] },
          { name: "expr_is$subexpression$5", symbols: ["expr_paren"] },
          { name: "expr_is$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_not") ? { type: "kw_not" } : kw_not], postprocess: id },
          { name: "expr_is$ebnf$1", symbols: [], postprocess: () => null },
          { name: "expr_is$subexpression$6", symbols: [lexer_1.lexerAny.has("kw_true") ? { type: "kw_true" } : kw_true] },
          { name: "expr_is$subexpression$6", symbols: [lexer_1.lexerAny.has("kw_false") ? { type: "kw_false" } : kw_false] },
          { name: "expr_is", symbols: ["expr_is$subexpression$5", lexer_1.lexerAny.has("kw_is") ? { type: "kw_is" } : kw_is, "expr_is$ebnf$1", "expr_is$subexpression$6"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "unary",
            op: "IS " + flattenStr([x[2], x[3]]).join(" ").toUpperCase(),
            operand: unwrap2(x[0])
          }) },
          { name: "expr_is", symbols: ["expr_compare"], postprocess: unwrap2 },
          { name: "expr_compare$macrocall$2$macrocall$2", symbols: [lexer_1.lexerAny.has("op_compare") ? { type: "op_compare" } : op_compare] },
          { name: "expr_compare$macrocall$2$macrocall$1$macrocall$2", symbols: ["expr_compare$macrocall$2$macrocall$2"] },
          { name: "expr_compare$macrocall$2$macrocall$1$macrocall$1", symbols: ["expr_compare$macrocall$2$macrocall$1$macrocall$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x, " ") || "<error>").toUpperCase()
          }) },
          { name: "expr_compare$macrocall$2$macrocall$1", symbols: ["expr_compare$macrocall$2$macrocall$1$macrocall$1"], postprocess: unwrap2 },
          { name: "expr_compare$macrocall$2$macrocall$1", symbols: ["kw_operator", "lparen", "ident", "dot", "expr_compare$macrocall$2$macrocall$2", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x[4], " ") || "<error>").toUpperCase(),
            opSchema: toStr(x[2])
          }) },
          { name: "expr_compare$macrocall$2", symbols: ["expr_compare$macrocall$2$macrocall$1"] },
          { name: "expr_compare$macrocall$3", symbols: ["expr_compare"] },
          { name: "expr_compare$macrocall$4", symbols: ["expr_range"] },
          { name: "expr_compare$macrocall$1$subexpression$1", symbols: ["expr_compare$macrocall$3"] },
          { name: "expr_compare$macrocall$1$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_compare$macrocall$1$subexpression$2", symbols: ["expr_compare$macrocall$4"] },
          { name: "expr_compare$macrocall$1$subexpression$2", symbols: ["expr_paren"] },
          { name: "expr_compare$macrocall$1", symbols: ["expr_compare$macrocall$1$subexpression$1", "expr_compare$macrocall$2", "expr_compare$macrocall$1$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "binary",
            left: unwrap2(x[0]),
            right: unwrap2(x[2]),
            ...unwrap2(x[1])
          }) },
          { name: "expr_compare$macrocall$1", symbols: ["expr_compare$macrocall$4"], postprocess: unwrap2 },
          { name: "expr_compare", symbols: ["expr_compare$macrocall$1"] },
          { name: "expr_range$macrocall$2", symbols: ["ops_between"] },
          { name: "expr_range$macrocall$3", symbols: [lexer_1.lexerAny.has("kw_and") ? { type: "kw_and" } : kw_and] },
          { name: "expr_range$macrocall$4", symbols: ["expr_range"] },
          { name: "expr_range$macrocall$5", symbols: ["expr_others"] },
          { name: "expr_range$macrocall$1$subexpression$1", symbols: ["expr_range$macrocall$4"] },
          { name: "expr_range$macrocall$1$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_range$macrocall$1$subexpression$2", symbols: ["expr_range$macrocall$4"] },
          { name: "expr_range$macrocall$1$subexpression$2", symbols: ["expr_paren"] },
          { name: "expr_range$macrocall$1$subexpression$3", symbols: ["expr_range$macrocall$5"] },
          { name: "expr_range$macrocall$1$subexpression$3", symbols: ["expr_paren"] },
          { name: "expr_range$macrocall$1", symbols: ["expr_range$macrocall$1$subexpression$1", "expr_range$macrocall$2", "expr_range$macrocall$1$subexpression$2", "expr_range$macrocall$3", "expr_range$macrocall$1$subexpression$3"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "ternary",
            value: unwrap2(x[0]),
            lo: unwrap2(x[2]),
            hi: unwrap2(x[4]),
            op: (flattenStr(x[1]).join(" ") || "<error>").toUpperCase()
          }) },
          { name: "expr_range$macrocall$1", symbols: ["expr_range$macrocall$5"], postprocess: unwrap2 },
          { name: "expr_range", symbols: ["expr_range$macrocall$1"] },
          { name: "expr_others$macrocall$2$macrocall$2", symbols: [lexer_1.lexerAny.has("ops_others") ? { type: "ops_others" } : ops_others] },
          { name: "expr_others$macrocall$2$macrocall$1$macrocall$2", symbols: ["expr_others$macrocall$2$macrocall$2"] },
          { name: "expr_others$macrocall$2$macrocall$1$macrocall$1", symbols: ["expr_others$macrocall$2$macrocall$1$macrocall$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x, " ") || "<error>").toUpperCase()
          }) },
          { name: "expr_others$macrocall$2$macrocall$1", symbols: ["expr_others$macrocall$2$macrocall$1$macrocall$1"], postprocess: unwrap2 },
          { name: "expr_others$macrocall$2$macrocall$1", symbols: ["kw_operator", "lparen", "ident", "dot", "expr_others$macrocall$2$macrocall$2", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x[4], " ") || "<error>").toUpperCase(),
            opSchema: toStr(x[2])
          }) },
          { name: "expr_others$macrocall$2", symbols: ["expr_others$macrocall$2$macrocall$1"] },
          { name: "expr_others$macrocall$3", symbols: ["expr_others"] },
          { name: "expr_others$macrocall$4", symbols: ["expr_like"] },
          { name: "expr_others$macrocall$1$subexpression$1", symbols: ["expr_others$macrocall$3"] },
          { name: "expr_others$macrocall$1$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_others$macrocall$1$subexpression$2", symbols: ["expr_others$macrocall$4"] },
          { name: "expr_others$macrocall$1$subexpression$2", symbols: ["expr_paren"] },
          { name: "expr_others$macrocall$1", symbols: ["expr_others$macrocall$1$subexpression$1", "expr_others$macrocall$2", "expr_others$macrocall$1$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "binary",
            left: unwrap2(x[0]),
            right: unwrap2(x[2]),
            ...unwrap2(x[1])
          }) },
          { name: "expr_others$macrocall$1", symbols: ["expr_others$macrocall$4"], postprocess: unwrap2 },
          { name: "expr_others", symbols: ["expr_others$macrocall$1"] },
          { name: "expr_like$macrocall$2$macrocall$2", symbols: ["ops_like"] },
          { name: "expr_like$macrocall$2$macrocall$1", symbols: ["expr_like$macrocall$2$macrocall$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x, " ") || "<error>").toUpperCase()
          }) },
          { name: "expr_like$macrocall$2", symbols: ["expr_like$macrocall$2$macrocall$1"] },
          { name: "expr_like$macrocall$3", symbols: ["expr_like"] },
          { name: "expr_like$macrocall$4", symbols: ["expr_in"] },
          { name: "expr_like$macrocall$1$subexpression$1", symbols: ["expr_like$macrocall$3"] },
          { name: "expr_like$macrocall$1$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_like$macrocall$1$subexpression$2", symbols: ["expr_like$macrocall$4"] },
          { name: "expr_like$macrocall$1$subexpression$2", symbols: ["expr_paren"] },
          { name: "expr_like$macrocall$1", symbols: ["expr_like$macrocall$1$subexpression$1", "expr_like$macrocall$2", "expr_like$macrocall$1$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "binary",
            left: unwrap2(x[0]),
            right: unwrap2(x[2]),
            ...unwrap2(x[1])
          }) },
          { name: "expr_like$macrocall$1", symbols: ["expr_like$macrocall$4"], postprocess: unwrap2 },
          { name: "expr_like", symbols: ["expr_like$macrocall$1"] },
          { name: "expr_in$macrocall$2$macrocall$2", symbols: ["ops_in"] },
          { name: "expr_in$macrocall$2$macrocall$1", symbols: ["expr_in$macrocall$2$macrocall$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x, " ") || "<error>").toUpperCase()
          }) },
          { name: "expr_in$macrocall$2", symbols: ["expr_in$macrocall$2$macrocall$1"] },
          { name: "expr_in$macrocall$3", symbols: ["expr_in"] },
          { name: "expr_in$macrocall$4", symbols: ["expr_add"] },
          { name: "expr_in$macrocall$1$subexpression$1", symbols: ["expr_in$macrocall$3"] },
          { name: "expr_in$macrocall$1$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_in$macrocall$1$subexpression$2", symbols: ["expr_in$macrocall$4"] },
          { name: "expr_in$macrocall$1$subexpression$2", symbols: ["expr_paren"] },
          { name: "expr_in$macrocall$1", symbols: ["expr_in$macrocall$1$subexpression$1", "expr_in$macrocall$2", "expr_in$macrocall$1$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "binary",
            left: unwrap2(x[0]),
            right: unwrap2(x[2]),
            ...unwrap2(x[1])
          }) },
          { name: "expr_in$macrocall$1", symbols: ["expr_in$macrocall$4"], postprocess: unwrap2 },
          { name: "expr_in", symbols: ["expr_in$macrocall$1"] },
          { name: "expr_add$macrocall$2$macrocall$2$subexpression$1", symbols: [lexer_1.lexerAny.has("op_plus") ? { type: "op_plus" } : op_plus] },
          { name: "expr_add$macrocall$2$macrocall$2$subexpression$1", symbols: [lexer_1.lexerAny.has("op_minus") ? { type: "op_minus" } : op_minus] },
          { name: "expr_add$macrocall$2$macrocall$2$subexpression$1", symbols: [lexer_1.lexerAny.has("op_additive") ? { type: "op_additive" } : op_additive] },
          { name: "expr_add$macrocall$2$macrocall$2", symbols: ["expr_add$macrocall$2$macrocall$2$subexpression$1"] },
          { name: "expr_add$macrocall$2$macrocall$1$macrocall$2", symbols: ["expr_add$macrocall$2$macrocall$2"] },
          { name: "expr_add$macrocall$2$macrocall$1$macrocall$1", symbols: ["expr_add$macrocall$2$macrocall$1$macrocall$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x, " ") || "<error>").toUpperCase()
          }) },
          { name: "expr_add$macrocall$2$macrocall$1", symbols: ["expr_add$macrocall$2$macrocall$1$macrocall$1"], postprocess: unwrap2 },
          { name: "expr_add$macrocall$2$macrocall$1", symbols: ["kw_operator", "lparen", "ident", "dot", "expr_add$macrocall$2$macrocall$2", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x[4], " ") || "<error>").toUpperCase(),
            opSchema: toStr(x[2])
          }) },
          { name: "expr_add$macrocall$2", symbols: ["expr_add$macrocall$2$macrocall$1"] },
          { name: "expr_add$macrocall$3", symbols: ["expr_add"] },
          { name: "expr_add$macrocall$4", symbols: ["expr_mult"] },
          { name: "expr_add$macrocall$1$subexpression$1", symbols: ["expr_add$macrocall$3"] },
          { name: "expr_add$macrocall$1$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_add$macrocall$1$subexpression$2", symbols: ["expr_add$macrocall$4"] },
          { name: "expr_add$macrocall$1$subexpression$2", symbols: ["expr_paren"] },
          { name: "expr_add$macrocall$1", symbols: ["expr_add$macrocall$1$subexpression$1", "expr_add$macrocall$2", "expr_add$macrocall$1$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "binary",
            left: unwrap2(x[0]),
            right: unwrap2(x[2]),
            ...unwrap2(x[1])
          }) },
          { name: "expr_add$macrocall$1", symbols: ["expr_add$macrocall$4"], postprocess: unwrap2 },
          { name: "expr_add", symbols: ["expr_add$macrocall$1"] },
          { name: "expr_mult$macrocall$2$macrocall$2$subexpression$1", symbols: [lexer_1.lexerAny.has("star") ? { type: "star" } : star] },
          { name: "expr_mult$macrocall$2$macrocall$2$subexpression$1", symbols: [lexer_1.lexerAny.has("op_div") ? { type: "op_div" } : op_div] },
          { name: "expr_mult$macrocall$2$macrocall$2$subexpression$1", symbols: [lexer_1.lexerAny.has("op_mod") ? { type: "op_mod" } : op_mod] },
          { name: "expr_mult$macrocall$2$macrocall$2", symbols: ["expr_mult$macrocall$2$macrocall$2$subexpression$1"] },
          { name: "expr_mult$macrocall$2$macrocall$1$macrocall$2", symbols: ["expr_mult$macrocall$2$macrocall$2"] },
          { name: "expr_mult$macrocall$2$macrocall$1$macrocall$1", symbols: ["expr_mult$macrocall$2$macrocall$1$macrocall$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x, " ") || "<error>").toUpperCase()
          }) },
          { name: "expr_mult$macrocall$2$macrocall$1", symbols: ["expr_mult$macrocall$2$macrocall$1$macrocall$1"], postprocess: unwrap2 },
          { name: "expr_mult$macrocall$2$macrocall$1", symbols: ["kw_operator", "lparen", "ident", "dot", "expr_mult$macrocall$2$macrocall$2", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x[4], " ") || "<error>").toUpperCase(),
            opSchema: toStr(x[2])
          }) },
          { name: "expr_mult$macrocall$2", symbols: ["expr_mult$macrocall$2$macrocall$1"] },
          { name: "expr_mult$macrocall$3", symbols: ["expr_mult"] },
          { name: "expr_mult$macrocall$4", symbols: ["expr_exp"] },
          { name: "expr_mult$macrocall$1$subexpression$1", symbols: ["expr_mult$macrocall$3"] },
          { name: "expr_mult$macrocall$1$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_mult$macrocall$1$subexpression$2", symbols: ["expr_mult$macrocall$4"] },
          { name: "expr_mult$macrocall$1$subexpression$2", symbols: ["expr_paren"] },
          { name: "expr_mult$macrocall$1", symbols: ["expr_mult$macrocall$1$subexpression$1", "expr_mult$macrocall$2", "expr_mult$macrocall$1$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "binary",
            left: unwrap2(x[0]),
            right: unwrap2(x[2]),
            ...unwrap2(x[1])
          }) },
          { name: "expr_mult$macrocall$1", symbols: ["expr_mult$macrocall$4"], postprocess: unwrap2 },
          { name: "expr_mult", symbols: ["expr_mult$macrocall$1"] },
          { name: "expr_exp$macrocall$2$macrocall$2", symbols: [lexer_1.lexerAny.has("op_exp") ? { type: "op_exp" } : op_exp] },
          { name: "expr_exp$macrocall$2$macrocall$1$macrocall$2", symbols: ["expr_exp$macrocall$2$macrocall$2"] },
          { name: "expr_exp$macrocall$2$macrocall$1$macrocall$1", symbols: ["expr_exp$macrocall$2$macrocall$1$macrocall$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x, " ") || "<error>").toUpperCase()
          }) },
          { name: "expr_exp$macrocall$2$macrocall$1", symbols: ["expr_exp$macrocall$2$macrocall$1$macrocall$1"], postprocess: unwrap2 },
          { name: "expr_exp$macrocall$2$macrocall$1", symbols: ["kw_operator", "lparen", "ident", "dot", "expr_exp$macrocall$2$macrocall$2", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x[4], " ") || "<error>").toUpperCase(),
            opSchema: toStr(x[2])
          }) },
          { name: "expr_exp$macrocall$2", symbols: ["expr_exp$macrocall$2$macrocall$1"] },
          { name: "expr_exp$macrocall$3", symbols: ["expr_exp"] },
          { name: "expr_exp$macrocall$4", symbols: ["expr_unary_add"] },
          { name: "expr_exp$macrocall$1$subexpression$1", symbols: ["expr_exp$macrocall$3"] },
          { name: "expr_exp$macrocall$1$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_exp$macrocall$1$subexpression$2", symbols: ["expr_exp$macrocall$4"] },
          { name: "expr_exp$macrocall$1$subexpression$2", symbols: ["expr_paren"] },
          { name: "expr_exp$macrocall$1", symbols: ["expr_exp$macrocall$1$subexpression$1", "expr_exp$macrocall$2", "expr_exp$macrocall$1$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "binary",
            left: unwrap2(x[0]),
            right: unwrap2(x[2]),
            ...unwrap2(x[1])
          }) },
          { name: "expr_exp$macrocall$1", symbols: ["expr_exp$macrocall$4"], postprocess: unwrap2 },
          { name: "expr_exp", symbols: ["expr_exp$macrocall$1"] },
          { name: "expr_unary_add$macrocall$2$macrocall$2$subexpression$1", symbols: [lexer_1.lexerAny.has("op_plus") ? { type: "op_plus" } : op_plus] },
          { name: "expr_unary_add$macrocall$2$macrocall$2$subexpression$1", symbols: [lexer_1.lexerAny.has("op_minus") ? { type: "op_minus" } : op_minus] },
          { name: "expr_unary_add$macrocall$2$macrocall$2", symbols: ["expr_unary_add$macrocall$2$macrocall$2$subexpression$1"] },
          { name: "expr_unary_add$macrocall$2$macrocall$1$macrocall$2", symbols: ["expr_unary_add$macrocall$2$macrocall$2"] },
          { name: "expr_unary_add$macrocall$2$macrocall$1$macrocall$1", symbols: ["expr_unary_add$macrocall$2$macrocall$1$macrocall$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x, " ") || "<error>").toUpperCase()
          }) },
          { name: "expr_unary_add$macrocall$2$macrocall$1", symbols: ["expr_unary_add$macrocall$2$macrocall$1$macrocall$1"], postprocess: unwrap2 },
          { name: "expr_unary_add$macrocall$2$macrocall$1", symbols: ["kw_operator", "lparen", "ident", "dot", "expr_unary_add$macrocall$2$macrocall$2", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x[4], " ") || "<error>").toUpperCase(),
            opSchema: toStr(x[2])
          }) },
          { name: "expr_unary_add$macrocall$2", symbols: ["expr_unary_add$macrocall$2$macrocall$1"] },
          { name: "expr_unary_add$macrocall$3", symbols: ["expr_unary_add"] },
          { name: "expr_unary_add$macrocall$4", symbols: ["expr_various_constructs"] },
          { name: "expr_unary_add$macrocall$1$subexpression$1", symbols: ["expr_unary_add$macrocall$3"] },
          { name: "expr_unary_add$macrocall$1$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_unary_add$macrocall$1", symbols: ["expr_unary_add$macrocall$2", "expr_unary_add$macrocall$1$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "unary",
            ...unwrap2(x[0]),
            operand: unwrap2(x[1])
          }) },
          { name: "expr_unary_add$macrocall$1", symbols: ["expr_unary_add$macrocall$4"], postprocess: unwrap2 },
          { name: "expr_unary_add", symbols: ["expr_unary_add$macrocall$1"] },
          { name: "expr_various_constructs$macrocall$2$macrocall$2", symbols: ["various_binaries"] },
          { name: "expr_various_constructs$macrocall$2$macrocall$1", symbols: ["expr_various_constructs$macrocall$2$macrocall$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            op: (toStr(x, " ") || "<error>").toUpperCase()
          }) },
          { name: "expr_various_constructs$macrocall$2", symbols: ["expr_various_constructs$macrocall$2$macrocall$1"] },
          { name: "expr_various_constructs$macrocall$3", symbols: ["expr_various_constructs"] },
          { name: "expr_various_constructs$macrocall$4", symbols: ["expr_array_index"] },
          { name: "expr_various_constructs$macrocall$1$subexpression$1", symbols: ["expr_various_constructs$macrocall$3"] },
          { name: "expr_various_constructs$macrocall$1$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_various_constructs$macrocall$1$subexpression$2", symbols: ["expr_various_constructs$macrocall$4"] },
          { name: "expr_various_constructs$macrocall$1$subexpression$2", symbols: ["expr_paren"] },
          { name: "expr_various_constructs$macrocall$1", symbols: ["expr_various_constructs$macrocall$1$subexpression$1", "expr_various_constructs$macrocall$2", "expr_various_constructs$macrocall$1$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "binary",
            left: unwrap2(x[0]),
            right: unwrap2(x[2]),
            ...unwrap2(x[1])
          }) },
          { name: "expr_various_constructs$macrocall$1", symbols: ["expr_various_constructs$macrocall$4"], postprocess: unwrap2 },
          { name: "expr_various_constructs", symbols: ["expr_various_constructs$macrocall$1"] },
          { name: "expr_array_index$subexpression$1", symbols: ["expr_array_index"] },
          { name: "expr_array_index$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_array_index", symbols: ["expr_array_index$subexpression$1", lexer_1.lexerAny.has("lbracket") ? { type: "lbracket" } : lbracket, "expr_nostar", lexer_1.lexerAny.has("rbracket") ? { type: "rbracket" } : rbracket], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "arrayIndex",
            array: unwrap2(x[0]),
            index: unwrap2(x[2])
          }) },
          { name: "expr_array_index", symbols: ["expr_member"], postprocess: unwrap2 },
          { name: "expr_member$subexpression$1", symbols: ["expr_member"] },
          { name: "expr_member$subexpression$1", symbols: ["expr_paren"] },
          { name: "expr_member$subexpression$2", symbols: ["string"] },
          { name: "expr_member$subexpression$2", symbols: ["int"] },
          { name: "expr_member", symbols: ["expr_member$subexpression$1", "ops_member", "expr_member$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "member",
            operand: unwrap2(x[0]),
            op: x[1],
            member: unwrap2(x[2])
          }) },
          { name: "expr_member$subexpression$3", symbols: ["expr_member"] },
          { name: "expr_member$subexpression$3", symbols: ["expr_paren"] },
          { name: "expr_member", symbols: ["expr_member$subexpression$3", lexer_1.lexerAny.has("op_cast") ? { type: "op_cast" } : op_cast, "data_type"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "cast",
            operand: unwrap2(x[0]),
            to: x[2]
          }) },
          { name: "expr_member", symbols: [lexer_1.lexerAny.has("kw_cast") ? { type: "kw_cast" } : kw_cast, "lparen", "expr_nostar", lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as, "data_type", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "cast",
            operand: unwrap2(x[2]),
            to: x[4]
          }) },
          { name: "expr_member", symbols: ["data_type", "string"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "cast",
            operand: (0, lexer_2.track)(x[1], {
              type: "string",
              value: (0, lexer_2.unbox)(x[1])
            }),
            to: (0, lexer_2.unbox)(x[0])
          }) },
          { name: "expr_member", symbols: ["expr_dot"], postprocess: unwrap2 },
          { name: "expr_dot$subexpression$1", symbols: ["word"] },
          { name: "expr_dot$subexpression$1", symbols: ["star"] },
          { name: "expr_dot", symbols: ["qname", lexer_1.lexerAny.has("dot") ? { type: "dot" } : dot, "expr_dot$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "ref",
            table: unwrap2(x[0]),
            name: toStr(x[2])
          }) },
          { name: "expr_dot", symbols: ["expr_final"], postprocess: unwrap2 },
          { name: "expr_final", symbols: ["expr_basic"] },
          { name: "expr_final", symbols: ["expr_primary"] },
          { name: "expr_basic", symbols: ["expr_special_calls"] },
          { name: "expr_basic", symbols: ["expr_call"] },
          { name: "expr_basic", symbols: ["expr_array"] },
          { name: "expr_basic", symbols: ["expr_case"] },
          { name: "expr_basic", symbols: ["expr_extract"] },
          { name: "expr_basic", symbols: ["word"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "ref",
            name: unwrap2(x[0])
          }) },
          { name: "expr_array$ebnf$1", symbols: ["expr_subarray_items"], postprocess: id },
          { name: "expr_array$ebnf$1", symbols: [], postprocess: () => null },
          { name: "expr_array", symbols: [lexer_1.lexerAny.has("kw_array") ? { type: "kw_array" } : kw_array, lexer_1.lexerAny.has("lbracket") ? { type: "lbracket" } : lbracket, "expr_array$ebnf$1", lexer_1.lexerAny.has("rbracket") ? { type: "rbracket" } : rbracket], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "array",
            expressions: x[2] || []
          }) },
          { name: "expr_array", symbols: [lexer_1.lexerAny.has("kw_array") ? { type: "kw_array" } : kw_array, "lparen", "selection", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "array select",
            select: unwrap2(x[2])
          }) },
          { name: "expr_subarray$ebnf$1", symbols: ["expr_subarray_items"], postprocess: id },
          { name: "expr_subarray$ebnf$1", symbols: [], postprocess: () => null },
          { name: "expr_subarray", symbols: [lexer_1.lexerAny.has("lbracket") ? { type: "lbracket" } : lbracket, "expr_subarray$ebnf$1", lexer_1.lexerAny.has("rbracket") ? { type: "rbracket" } : rbracket], postprocess: get(1) },
          { name: "expr_subarray_items$macrocall$2", symbols: ["expr_list_item"] },
          { name: "expr_subarray_items$macrocall$1$ebnf$1", symbols: [] },
          { name: "expr_subarray_items$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "expr_subarray_items$macrocall$2"], postprocess: last },
          { name: "expr_subarray_items$macrocall$1$ebnf$1", symbols: ["expr_subarray_items$macrocall$1$ebnf$1", "expr_subarray_items$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "expr_subarray_items$macrocall$1", symbols: ["expr_subarray_items$macrocall$2", "expr_subarray_items$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "expr_subarray_items", symbols: ["expr_subarray_items$macrocall$1"], postprocess: (x) => x[0].map(unwrap2) },
          { name: "expr_subarray_items$macrocall$4", symbols: ["expr_subarray"] },
          { name: "expr_subarray_items$macrocall$3$ebnf$1", symbols: [] },
          { name: "expr_subarray_items$macrocall$3$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "expr_subarray_items$macrocall$4"], postprocess: last },
          { name: "expr_subarray_items$macrocall$3$ebnf$1", symbols: ["expr_subarray_items$macrocall$3$ebnf$1", "expr_subarray_items$macrocall$3$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "expr_subarray_items$macrocall$3", symbols: ["expr_subarray_items$macrocall$4", "expr_subarray_items$macrocall$3$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "expr_subarray_items", symbols: ["expr_subarray_items$macrocall$3"], postprocess: (x) => {
            return x[0].map((v) => {
              return (0, lexer_2.track)(v, {
                type: "array",
                expressions: v[0].map(unwrap2)
              });
            });
          } },
          { name: "expr_function_call$ebnf$1", symbols: ["expr_list_raw"], postprocess: id },
          { name: "expr_function_call$ebnf$1", symbols: [], postprocess: () => null },
          { name: "expr_function_call", symbols: ["expr_fn_name", "lparen", "expr_function_call$ebnf$1", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "call",
            function: unwrap2(x[0]),
            args: x[2] || []
          }) },
          { name: "expr_call$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_all") ? { type: "kw_all" } : kw_all] },
          { name: "expr_call$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_distinct") ? { type: "kw_distinct" } : kw_distinct] },
          { name: "expr_call$ebnf$1", symbols: ["expr_call$ebnf$1$subexpression$1"], postprocess: id },
          { name: "expr_call$ebnf$1", symbols: [], postprocess: () => null },
          { name: "expr_call$ebnf$2", symbols: ["expr_list_raw"], postprocess: id },
          { name: "expr_call$ebnf$2", symbols: [], postprocess: () => null },
          { name: "expr_call$ebnf$3", symbols: ["select_order_by"], postprocess: id },
          { name: "expr_call$ebnf$3", symbols: [], postprocess: () => null },
          { name: "expr_call$ebnf$4$subexpression$1", symbols: ["kw_filter", "lparen", lexer_1.lexerAny.has("kw_where") ? { type: "kw_where" } : kw_where, "expr", "rparen"], postprocess: get(3) },
          { name: "expr_call$ebnf$4", symbols: ["expr_call$ebnf$4$subexpression$1"], postprocess: id },
          { name: "expr_call$ebnf$4", symbols: [], postprocess: () => null },
          { name: "expr_call$ebnf$5", symbols: ["expr_call_within_group"], postprocess: id },
          { name: "expr_call$ebnf$5", symbols: [], postprocess: () => null },
          { name: "expr_call$ebnf$6", symbols: ["expr_call_over"], postprocess: id },
          { name: "expr_call$ebnf$6", symbols: [], postprocess: () => null },
          { name: "expr_call", symbols: ["expr_fn_name", "lparen", "expr_call$ebnf$1", "expr_call$ebnf$2", "expr_call$ebnf$3", "rparen", "expr_call$ebnf$4", "expr_call$ebnf$5", "expr_call$ebnf$6"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "call",
            function: unwrap2(x[0]),
            ...x[2] && { distinct: toStr(x[2]) },
            args: x[3] || [],
            ...x[4] && { orderBy: x[4] },
            ...x[6] && { filter: unwrap2(x[6]) },
            ...x[7] && { withinGroup: x[7] },
            ...x[8] && { over: unwrap2(x[8]) }
          }) },
          { name: "expr_call_over$ebnf$1$subexpression$1", symbols: ["kw_partition", "kw_by", "expr_list_raw"], postprocess: last },
          { name: "expr_call_over$ebnf$1", symbols: ["expr_call_over$ebnf$1$subexpression$1"], postprocess: id },
          { name: "expr_call_over$ebnf$1", symbols: [], postprocess: () => null },
          { name: "expr_call_over$ebnf$2", symbols: ["select_order_by"], postprocess: id },
          { name: "expr_call_over$ebnf$2", symbols: [], postprocess: () => null },
          { name: "expr_call_over", symbols: ["kw_over", "lparen", "expr_call_over$ebnf$1", "expr_call_over$ebnf$2", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            ...x[2] && { partitionBy: x[2] },
            ...x[3] && { orderBy: x[3] }
          }) },
          { name: "expr_call_within_group$subexpression$1", symbols: ["kw_within", lexer_1.lexerAny.has("kw_group") ? { type: "kw_group" } : kw_group] },
          { name: "expr_call_within_group$subexpression$2", symbols: [lexer_1.lexerAny.has("kw_order") ? { type: "kw_order" } : kw_order, "kw_by"] },
          { name: "expr_call_within_group", symbols: ["expr_call_within_group$subexpression$1", "lparen", "expr_call_within_group$subexpression$2", "select_order_by_expr", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, x[3]) },
          { name: "expr_extract$subexpression$1", symbols: ["word"], postprocess: kw("extract") },
          { name: "expr_extract", symbols: ["expr_extract$subexpression$1", "lparen", "word", lexer_1.lexerAny.has("kw_from") ? { type: "kw_from" } : kw_from, "expr", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "extract",
            field: asName(x[2]),
            from: x[4]
          }) },
          { name: "expr_primary", symbols: ["float"], postprocess: (x) => (0, lexer_2.track)(x, { type: "numeric", value: (0, lexer_2.unbox)(x[0]) }) },
          { name: "expr_primary", symbols: ["int"], postprocess: (x) => (0, lexer_2.track)(x, { type: "integer", value: (0, lexer_2.unbox)(x[0]) }) },
          { name: "expr_primary", symbols: ["string"], postprocess: (x) => (0, lexer_2.track)(x, { type: "string", value: (0, lexer_2.unbox)(x[0]) }) },
          { name: "expr_primary", symbols: [lexer_1.lexerAny.has("kw_true") ? { type: "kw_true" } : kw_true], postprocess: (x) => (0, lexer_2.track)(x, { type: "boolean", value: true }) },
          { name: "expr_primary", symbols: [lexer_1.lexerAny.has("kw_false") ? { type: "kw_false" } : kw_false], postprocess: (x) => (0, lexer_2.track)(x, { type: "boolean", value: false }) },
          { name: "expr_primary", symbols: [lexer_1.lexerAny.has("kw_null") ? { type: "kw_null" } : kw_null], postprocess: (x) => (0, lexer_2.track)(x, { type: "null" }) },
          { name: "expr_primary", symbols: ["value_keyword"], postprocess: (x) => (0, lexer_2.track)(x, { type: "keyword", keyword: toStr(x) }) },
          { name: "expr_primary", symbols: [lexer_1.lexerAny.has("qparam") ? { type: "qparam" } : qparam], postprocess: (x) => (0, lexer_2.track)(x, { type: "parameter", name: toStr(x[0]) }) },
          { name: "expr_primary", symbols: [lexer_1.lexerAny.has("kw_default") ? { type: "kw_default" } : kw_default], postprocess: (x) => (0, lexer_2.track)(x, { type: "default" }) },
          { name: "ops_like", symbols: ["ops_like_keywors"] },
          { name: "ops_like", symbols: ["ops_like_operators"] },
          { name: "ops_like_keywors$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_not") ? { type: "kw_not" } : kw_not], postprocess: id },
          { name: "ops_like_keywors$ebnf$1", symbols: [], postprocess: () => null },
          { name: "ops_like_keywors$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_like") ? { type: "kw_like" } : kw_like] },
          { name: "ops_like_keywors$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_ilike") ? { type: "kw_ilike" } : kw_ilike] },
          { name: "ops_like_keywors", symbols: ["ops_like_keywors$ebnf$1", "ops_like_keywors$subexpression$1"] },
          { name: "ops_like_operators$subexpression$1", symbols: [lexer_1.lexerAny.has("op_like") ? { type: "op_like" } : op_like], postprocess: () => "LIKE" },
          { name: "ops_like_operators", symbols: ["ops_like_operators$subexpression$1"] },
          { name: "ops_like_operators$subexpression$2", symbols: [lexer_1.lexerAny.has("op_ilike") ? { type: "op_ilike" } : op_ilike], postprocess: () => "ILIKE" },
          { name: "ops_like_operators", symbols: ["ops_like_operators$subexpression$2"] },
          { name: "ops_like_operators$subexpression$3", symbols: [lexer_1.lexerAny.has("op_not_like") ? { type: "op_not_like" } : op_not_like], postprocess: () => "NOT LIKE" },
          { name: "ops_like_operators", symbols: ["ops_like_operators$subexpression$3"] },
          { name: "ops_like_operators$subexpression$4", symbols: [lexer_1.lexerAny.has("op_not_ilike") ? { type: "op_not_ilike" } : op_not_ilike], postprocess: () => "NOT ILIKE" },
          { name: "ops_like_operators", symbols: ["ops_like_operators$subexpression$4"] },
          { name: "ops_in$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_not") ? { type: "kw_not" } : kw_not], postprocess: id },
          { name: "ops_in$ebnf$1", symbols: [], postprocess: () => null },
          { name: "ops_in", symbols: ["ops_in$ebnf$1", lexer_1.lexerAny.has("kw_in") ? { type: "kw_in" } : kw_in] },
          { name: "ops_between$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_not") ? { type: "kw_not" } : kw_not], postprocess: id },
          { name: "ops_between$ebnf$1", symbols: [], postprocess: () => null },
          { name: "ops_between", symbols: ["ops_between$ebnf$1", "kw_between"] },
          { name: "ops_member$subexpression$1", symbols: [lexer_1.lexerAny.has("op_member") ? { type: "op_member" } : op_member] },
          { name: "ops_member$subexpression$1", symbols: [lexer_1.lexerAny.has("op_membertext") ? { type: "op_membertext" } : op_membertext] },
          { name: "ops_member", symbols: ["ops_member$subexpression$1"], postprocess: (x) => {
            var _a;
            return (_a = unwrap2(x)) === null || _a === undefined ? undefined : _a.value;
          } },
          { name: "expr_list_item", symbols: ["expr_or_select"], postprocess: unwrap2 },
          { name: "expr_list_item", symbols: ["expr_star"], postprocess: unwrap2 },
          { name: "expr_list_raw$macrocall$2", symbols: ["expr_list_item"] },
          { name: "expr_list_raw$macrocall$1$ebnf$1", symbols: [] },
          { name: "expr_list_raw$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "expr_list_raw$macrocall$2"], postprocess: last },
          { name: "expr_list_raw$macrocall$1$ebnf$1", symbols: ["expr_list_raw$macrocall$1$ebnf$1", "expr_list_raw$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "expr_list_raw$macrocall$1", symbols: ["expr_list_raw$macrocall$2", "expr_list_raw$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "expr_list_raw", symbols: ["expr_list_raw$macrocall$1"], postprocess: ([x]) => x.map(unwrap2) },
          { name: "expr_list_raw_many$macrocall$2", symbols: ["expr_list_item"] },
          { name: "expr_list_raw_many$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "expr_list_raw_many$macrocall$2"], postprocess: last },
          { name: "expr_list_raw_many$macrocall$1$ebnf$1", symbols: ["expr_list_raw_many$macrocall$1$ebnf$1$subexpression$1"] },
          { name: "expr_list_raw_many$macrocall$1$ebnf$1$subexpression$2", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "expr_list_raw_many$macrocall$2"], postprocess: last },
          { name: "expr_list_raw_many$macrocall$1$ebnf$1", symbols: ["expr_list_raw_many$macrocall$1$ebnf$1", "expr_list_raw_many$macrocall$1$ebnf$1$subexpression$2"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "expr_list_raw_many$macrocall$1", symbols: ["expr_list_raw_many$macrocall$2", "expr_list_raw_many$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "expr_list_raw_many", symbols: ["expr_list_raw_many$macrocall$1"], postprocess: ([x]) => x.map(unwrap2) },
          { name: "expr_or_select", symbols: ["expr_nostar"], postprocess: unwrap2 },
          { name: "expr_or_select", symbols: ["selection"], postprocess: unwrap2 },
          { name: "expr_list_many", symbols: ["expr_list_raw_many"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "list",
            expressions: x[0]
          }) },
          { name: "expr_case$ebnf$1", symbols: ["expr_nostar"], postprocess: id },
          { name: "expr_case$ebnf$1", symbols: [], postprocess: () => null },
          { name: "expr_case$ebnf$2", symbols: [] },
          { name: "expr_case$ebnf$2", symbols: ["expr_case$ebnf$2", "expr_case_whens"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "expr_case$ebnf$3", symbols: ["expr_case_else"], postprocess: id },
          { name: "expr_case$ebnf$3", symbols: [], postprocess: () => null },
          { name: "expr_case", symbols: [lexer_1.lexerAny.has("kw_case") ? { type: "kw_case" } : kw_case, "expr_case$ebnf$1", "expr_case$ebnf$2", "expr_case$ebnf$3", lexer_1.lexerAny.has("kw_end") ? { type: "kw_end" } : kw_end], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "case",
            value: x[1],
            whens: x[2],
            else: x[3]
          }) },
          { name: "expr_case_whens", symbols: [lexer_1.lexerAny.has("kw_when") ? { type: "kw_when" } : kw_when, "expr_nostar", lexer_1.lexerAny.has("kw_then") ? { type: "kw_then" } : kw_then, "expr_nostar"], postprocess: (x) => (0, lexer_2.track)(x, {
            when: x[1],
            value: x[3]
          }) },
          { name: "expr_case_else", symbols: [lexer_1.lexerAny.has("kw_else") ? { type: "kw_else" } : kw_else, "expr_nostar"], postprocess: last },
          { name: "expr_fn_name$subexpression$1$ebnf$1$subexpression$1", symbols: ["word", lexer_1.lexerAny.has("dot") ? { type: "dot" } : dot] },
          { name: "expr_fn_name$subexpression$1$ebnf$1", symbols: ["expr_fn_name$subexpression$1$ebnf$1$subexpression$1"], postprocess: id },
          { name: "expr_fn_name$subexpression$1$ebnf$1", symbols: [], postprocess: () => null },
          { name: "expr_fn_name$subexpression$1", symbols: ["expr_fn_name$subexpression$1$ebnf$1", "word_or_keyword"], postprocess: (x) => (0, lexer_2.track)(x, {
            name: (0, lexer_2.unbox)(unwrap2(x[1])),
            ...x[0] && { schema: toStr(x[0][0]) }
          }) },
          { name: "expr_fn_name", symbols: ["expr_fn_name$subexpression$1"] },
          { name: "expr_fn_name$subexpression$2$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_any") ? { type: "kw_any" } : kw_any] },
          { name: "expr_fn_name$subexpression$2$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_some") ? { type: "kw_some" } : kw_some] },
          { name: "expr_fn_name$subexpression$2$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_all") ? { type: "kw_all" } : kw_all] },
          { name: "expr_fn_name$subexpression$2$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_left") ? { type: "kw_left" } : kw_left] },
          { name: "expr_fn_name$subexpression$2$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_right") ? { type: "kw_right" } : kw_right] },
          { name: "expr_fn_name$subexpression$2", symbols: ["expr_fn_name$subexpression$2$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, {
            name: toStr(unwrap2(x))
          }) },
          { name: "expr_fn_name", symbols: ["expr_fn_name$subexpression$2"] },
          { name: "word_or_keyword", symbols: ["word"] },
          { name: "word_or_keyword", symbols: ["value_keyword"], postprocess: (x) => (0, lexer_2.box)(x, toStr(x)) },
          { name: "value_keyword", symbols: [lexer_1.lexerAny.has("kw_current_catalog") ? { type: "kw_current_catalog" } : kw_current_catalog] },
          { name: "value_keyword", symbols: [lexer_1.lexerAny.has("kw_current_date") ? { type: "kw_current_date" } : kw_current_date] },
          { name: "value_keyword", symbols: [lexer_1.lexerAny.has("kw_current_role") ? { type: "kw_current_role" } : kw_current_role] },
          { name: "value_keyword", symbols: [lexer_1.lexerAny.has("kw_current_schema") ? { type: "kw_current_schema" } : kw_current_schema] },
          { name: "value_keyword", symbols: [lexer_1.lexerAny.has("kw_current_timestamp") ? { type: "kw_current_timestamp" } : kw_current_timestamp] },
          { name: "value_keyword", symbols: [lexer_1.lexerAny.has("kw_current_time") ? { type: "kw_current_time" } : kw_current_time] },
          { name: "value_keyword", symbols: [lexer_1.lexerAny.has("kw_localtimestamp") ? { type: "kw_localtimestamp" } : kw_localtimestamp] },
          { name: "value_keyword", symbols: [lexer_1.lexerAny.has("kw_localtime") ? { type: "kw_localtime" } : kw_localtime] },
          { name: "value_keyword", symbols: [lexer_1.lexerAny.has("kw_session_user") ? { type: "kw_session_user" } : kw_session_user] },
          { name: "value_keyword", symbols: [lexer_1.lexerAny.has("kw_user") ? { type: "kw_user" } : kw_user] },
          { name: "value_keyword", symbols: [lexer_1.lexerAny.has("kw_current_user") ? { type: "kw_current_user" } : kw_current_user] },
          { name: "expr_special_calls", symbols: ["spe_overlay"] },
          { name: "expr_special_calls", symbols: ["spe_substring"] },
          { name: "spe_overlay$subexpression$1", symbols: ["word"], postprocess: kw("overlay") },
          { name: "spe_overlay$subexpression$2", symbols: [lexer_1.lexerAny.has("lparen") ? { type: "lparen" } : lparen, "expr_nostar"] },
          { name: "spe_overlay$subexpression$3", symbols: [lexer_1.lexerAny.has("kw_placing") ? { type: "kw_placing" } : kw_placing, "expr_nostar"] },
          { name: "spe_overlay$subexpression$4", symbols: [lexer_1.lexerAny.has("kw_from") ? { type: "kw_from" } : kw_from, "expr_nostar"] },
          { name: "spe_overlay$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_for") ? { type: "kw_for" } : kw_for, "expr_nostar"] },
          { name: "spe_overlay$ebnf$1", symbols: ["spe_overlay$ebnf$1$subexpression$1"], postprocess: id },
          { name: "spe_overlay$ebnf$1", symbols: [], postprocess: () => null },
          { name: "spe_overlay", symbols: ["spe_overlay$subexpression$1", "spe_overlay$subexpression$2", "spe_overlay$subexpression$3", "spe_overlay$subexpression$4", "spe_overlay$ebnf$1", lexer_1.lexerAny.has("rparen") ? { type: "rparen" } : rparen], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "overlay",
            value: x[1][1],
            placing: x[2][1],
            from: x[3][1],
            ...x[4] && { for: x[4][1] }
          }) },
          { name: "spe_substring$subexpression$1", symbols: ["word"], postprocess: kw("substring") },
          { name: "spe_substring$subexpression$2", symbols: [lexer_1.lexerAny.has("lparen") ? { type: "lparen" } : lparen, "expr_nostar"] },
          { name: "spe_substring$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_from") ? { type: "kw_from" } : kw_from, "expr_nostar"] },
          { name: "spe_substring$ebnf$1", symbols: ["spe_substring$ebnf$1$subexpression$1"], postprocess: id },
          { name: "spe_substring$ebnf$1", symbols: [], postprocess: () => null },
          { name: "spe_substring$ebnf$2$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_for") ? { type: "kw_for" } : kw_for, "expr_nostar"] },
          { name: "spe_substring$ebnf$2", symbols: ["spe_substring$ebnf$2$subexpression$1"], postprocess: id },
          { name: "spe_substring$ebnf$2", symbols: [], postprocess: () => null },
          { name: "spe_substring", symbols: ["spe_substring$subexpression$1", "spe_substring$subexpression$2", "spe_substring$ebnf$1", "spe_substring$ebnf$2", lexer_1.lexerAny.has("rparen") ? { type: "rparen" } : rparen], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "substring",
            value: x[1][1],
            ...x[2] && { from: x[2][1] },
            ...x[3] && { for: x[3][1] }
          }) },
          { name: "various_binaries", symbols: ["kw_at", "kw_time", "kw_zone"], postprocess: () => "AT TIME ZONE" },
          { name: "createtable_statement$ebnf$1", symbols: ["createtable_modifiers"], postprocess: id },
          { name: "createtable_statement$ebnf$1", symbols: [], postprocess: () => null },
          { name: "createtable_statement$ebnf$2", symbols: ["kw_ifnotexists"], postprocess: id },
          { name: "createtable_statement$ebnf$2", symbols: [], postprocess: () => null },
          { name: "createtable_statement$ebnf$3", symbols: ["createtable_opts"], postprocess: id },
          { name: "createtable_statement$ebnf$3", symbols: [], postprocess: () => null },
          { name: "createtable_statement", symbols: [lexer_1.lexerAny.has("kw_create") ? { type: "kw_create" } : kw_create, "createtable_statement$ebnf$1", lexer_1.lexerAny.has("kw_table") ? { type: "kw_table" } : kw_table, "createtable_statement$ebnf$2", "qname", "lparen", "createtable_declarationlist", "rparen", "createtable_statement$ebnf$3"], postprocess: (x) => {
            const cols = x[6].filter((v) => ("kind" in v));
            const constraints = x[6].filter((v) => !("kind" in v));
            return (0, lexer_2.track)(x, {
              type: "create table",
              ...x[3] ? { ifNotExists: true } : {},
              name: x[4],
              columns: cols,
              ...unwrap2(x[1]),
              ...constraints.length ? { constraints } : {},
              ...last(x)
            });
          } },
          { name: "createtable_modifiers", symbols: ["kw_unlogged"], postprocess: (x) => x[0] ? { unlogged: true } : {} },
          { name: "createtable_modifiers", symbols: ["m_locglob"] },
          { name: "createtable_modifiers", symbols: ["m_tmp"] },
          { name: "createtable_modifiers", symbols: ["m_locglob", "m_tmp"], postprocess: ([a, b]) => ({ ...a, ...b }) },
          { name: "m_locglob$subexpression$1", symbols: ["kw_local"] },
          { name: "m_locglob$subexpression$1", symbols: ["kw_global"] },
          { name: "m_locglob", symbols: ["m_locglob$subexpression$1"], postprocess: (x) => ({ locality: toStr(x) }) },
          { name: "m_tmp$subexpression$1", symbols: ["kw_temp"] },
          { name: "m_tmp$subexpression$1", symbols: ["kw_temporary"] },
          { name: "m_tmp", symbols: ["m_tmp$subexpression$1"], postprocess: (x) => ({ temporary: true }) },
          { name: "createtable_declarationlist$ebnf$1", symbols: [] },
          { name: "createtable_declarationlist$ebnf$1$subexpression$1", symbols: ["comma", "createtable_declaration"], postprocess: last },
          { name: "createtable_declarationlist$ebnf$1", symbols: ["createtable_declarationlist$ebnf$1", "createtable_declarationlist$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "createtable_declarationlist", symbols: ["createtable_declaration", "createtable_declarationlist$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "createtable_declaration$subexpression$1", symbols: ["createtable_constraint"] },
          { name: "createtable_declaration$subexpression$1", symbols: ["createtable_column"] },
          { name: "createtable_declaration$subexpression$1", symbols: ["createtable_like"] },
          { name: "createtable_declaration", symbols: ["createtable_declaration$subexpression$1"], postprocess: unwrap2 },
          { name: "createtable_constraint$macrocall$2", symbols: ["createtable_constraint_def"] },
          { name: "createtable_constraint$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_constraint") ? { type: "kw_constraint" } : kw_constraint, "word"] },
          { name: "createtable_constraint$macrocall$1$ebnf$1", symbols: ["createtable_constraint$macrocall$1$ebnf$1$subexpression$1"], postprocess: id },
          { name: "createtable_constraint$macrocall$1$ebnf$1", symbols: [], postprocess: () => null },
          { name: "createtable_constraint$macrocall$1", symbols: ["createtable_constraint$macrocall$1$ebnf$1", "createtable_constraint$macrocall$2"], postprocess: (x) => {
            const name = x[0] && asName(x[0][1]);
            if (!name) {
              return (0, lexer_2.track)(x, unwrap2(x[1]));
            }
            return (0, lexer_2.track)(x, {
              constraintName: name,
              ...unwrap2(x[1])
            });
          } },
          { name: "createtable_constraint", symbols: ["createtable_constraint$macrocall$1"], postprocess: unwrap2 },
          { name: "createtable_constraint_def", symbols: ["createtable_constraint_def_unique"] },
          { name: "createtable_constraint_def", symbols: ["createtable_constraint_def_check"] },
          { name: "createtable_constraint_def", symbols: ["createtable_constraint_foreignkey"] },
          { name: "createtable_constraint_def_unique$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_unique") ? { type: "kw_unique" } : kw_unique] },
          { name: "createtable_constraint_def_unique$subexpression$1", symbols: ["kw_primary_key"] },
          { name: "createtable_constraint_def_unique", symbols: ["createtable_constraint_def_unique$subexpression$1", "lparen", "createtable_collist", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: toStr(x[0], " "),
            columns: x[2].map(asName)
          }) },
          { name: "createtable_constraint_def_check", symbols: [lexer_1.lexerAny.has("kw_check") ? { type: "kw_check" } : kw_check, "expr_paren"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "check",
            expr: unwrap2(x[1])
          }) },
          { name: "createtable_constraint_foreignkey", symbols: [lexer_1.lexerAny.has("kw_foreign") ? { type: "kw_foreign" } : kw_foreign, "kw_key", "collist_paren", "createtable_references"], postprocess: (x) => {
            return (0, lexer_2.track)(x, {
              type: "foreign key",
              localColumns: x[2].map(asName),
              ...x[3]
            });
          } },
          { name: "createtable_references$ebnf$1", symbols: [] },
          { name: "createtable_references$ebnf$1", symbols: ["createtable_references$ebnf$1", "createtable_constraint_foreignkey_onsometing"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "createtable_references", symbols: [lexer_1.lexerAny.has("kw_references") ? { type: "kw_references" } : kw_references, "table_ref", "collist_paren", "createtable_references$ebnf$1"], postprocess: (x) => {
            return (0, lexer_2.track)(x, {
              foreignTable: unwrap2(x[1]),
              foreignColumns: x[2].map(asName),
              ...x[3].reduce((a, b) => ({ ...a, ...b }), {})
            });
          } },
          { name: "createtable_constraint_foreignkey_onsometing", symbols: [lexer_1.lexerAny.has("kw_on") ? { type: "kw_on" } : kw_on, "kw_delete", "createtable_constraint_on_action"], postprocess: (x) => (0, lexer_2.track)(x, { onDelete: last(x) }) },
          { name: "createtable_constraint_foreignkey_onsometing", symbols: [lexer_1.lexerAny.has("kw_on") ? { type: "kw_on" } : kw_on, "kw_update", "createtable_constraint_on_action"], postprocess: (x) => (0, lexer_2.track)(x, { onUpdate: last(x) }) },
          { name: "createtable_constraint_foreignkey_onsometing$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_full") ? { type: "kw_full" } : kw_full] },
          { name: "createtable_constraint_foreignkey_onsometing$subexpression$1", symbols: ["kw_partial"] },
          { name: "createtable_constraint_foreignkey_onsometing$subexpression$1", symbols: ["kw_simple"] },
          { name: "createtable_constraint_foreignkey_onsometing", symbols: ["kw_match", "createtable_constraint_foreignkey_onsometing$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, { match: toStr(last(x)) }) },
          { name: "createtable_constraint_on_action$subexpression$1", symbols: ["kw_cascade"] },
          { name: "createtable_constraint_on_action$subexpression$1$subexpression$1", symbols: ["kw_no", "kw_action"] },
          { name: "createtable_constraint_on_action$subexpression$1", symbols: ["createtable_constraint_on_action$subexpression$1$subexpression$1"] },
          { name: "createtable_constraint_on_action$subexpression$1", symbols: ["kw_restrict"] },
          { name: "createtable_constraint_on_action$subexpression$1$subexpression$2", symbols: [lexer_1.lexerAny.has("kw_null") ? { type: "kw_null" } : kw_null] },
          { name: "createtable_constraint_on_action$subexpression$1$subexpression$2", symbols: [lexer_1.lexerAny.has("kw_default") ? { type: "kw_default" } : kw_default] },
          { name: "createtable_constraint_on_action$subexpression$1", symbols: ["kw_set", "createtable_constraint_on_action$subexpression$1$subexpression$2"] },
          { name: "createtable_constraint_on_action", symbols: ["createtable_constraint_on_action$subexpression$1"], postprocess: (x) => toStr(x, " ") },
          { name: "createtable_collist$ebnf$1", symbols: [] },
          { name: "createtable_collist$ebnf$1$subexpression$1", symbols: ["comma", "ident"], postprocess: last },
          { name: "createtable_collist$ebnf$1", symbols: ["createtable_collist$ebnf$1", "createtable_collist$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "createtable_collist", symbols: ["ident", "createtable_collist$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "createtable_column$ebnf$1", symbols: ["createtable_collate"], postprocess: id },
          { name: "createtable_column$ebnf$1", symbols: [], postprocess: () => null },
          { name: "createtable_column$ebnf$2", symbols: [] },
          { name: "createtable_column$ebnf$2", symbols: ["createtable_column$ebnf$2", "createtable_column_constraint"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "createtable_column", symbols: ["word", "data_type", "createtable_column$ebnf$1", "createtable_column$ebnf$2"], postprocess: (x) => {
            return (0, lexer_2.track)(x, {
              kind: "column",
              name: asName(x[0]),
              dataType: x[1],
              ...x[2] ? { collate: x[2][1] } : {},
              ...x[3] && x[3].length ? { constraints: x[3] } : {}
            });
          } },
          { name: "createtable_like$ebnf$1", symbols: [] },
          { name: "createtable_like$ebnf$1", symbols: ["createtable_like$ebnf$1", "createtable_like_opt"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "createtable_like", symbols: [lexer_1.lexerAny.has("kw_like") ? { type: "kw_like" } : kw_like, "qname", "createtable_like$ebnf$1"], postprocess: (x) => (0, lexer_2.track)(x, {
            kind: "like table",
            like: x[1],
            options: x[2]
          }) },
          { name: "createtable_like_opt$subexpression$1", symbols: ["kw_including"] },
          { name: "createtable_like_opt$subexpression$1", symbols: ["kw_excluding"] },
          { name: "createtable_like_opt", symbols: ["createtable_like_opt$subexpression$1", "createtable_like_opt_val"], postprocess: (x) => (0, lexer_2.track)(x, {
            verb: toStr(x[0]),
            option: toStr(x[1])
          }) },
          { name: "createtable_like_opt_val", symbols: ["word"], postprocess: anyKw("defaults", "constraints", "indexes", "storage", "comments") },
          { name: "createtable_like_opt_val", symbols: [lexer_1.lexerAny.has("kw_all") ? { type: "kw_all" } : kw_all] },
          { name: "createtable_column_constraint$macrocall$2", symbols: ["createtable_column_constraint_def"] },
          { name: "createtable_column_constraint$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_constraint") ? { type: "kw_constraint" } : kw_constraint, "word"] },
          { name: "createtable_column_constraint$macrocall$1$ebnf$1", symbols: ["createtable_column_constraint$macrocall$1$ebnf$1$subexpression$1"], postprocess: id },
          { name: "createtable_column_constraint$macrocall$1$ebnf$1", symbols: [], postprocess: () => null },
          { name: "createtable_column_constraint$macrocall$1", symbols: ["createtable_column_constraint$macrocall$1$ebnf$1", "createtable_column_constraint$macrocall$2"], postprocess: (x) => {
            const name = x[0] && asName(x[0][1]);
            if (!name) {
              return (0, lexer_2.track)(x, unwrap2(x[1]));
            }
            return (0, lexer_2.track)(x, {
              constraintName: name,
              ...unwrap2(x[1])
            });
          } },
          { name: "createtable_column_constraint", symbols: ["createtable_column_constraint$macrocall$1"], postprocess: unwrap2 },
          { name: "createtable_column_constraint_def", symbols: [lexer_1.lexerAny.has("kw_unique") ? { type: "kw_unique" } : kw_unique], postprocess: (x) => (0, lexer_2.track)(x, { type: "unique" }) },
          { name: "createtable_column_constraint_def", symbols: ["kw_primary_key"], postprocess: (x) => (0, lexer_2.track)(x, { type: "primary key" }) },
          { name: "createtable_column_constraint_def", symbols: ["kw_not_null"], postprocess: (x) => (0, lexer_2.track)(x, { type: "not null" }) },
          { name: "createtable_column_constraint_def", symbols: [lexer_1.lexerAny.has("kw_null") ? { type: "kw_null" } : kw_null], postprocess: (x) => (0, lexer_2.track)(x, { type: "null" }) },
          { name: "createtable_column_constraint_def", symbols: [lexer_1.lexerAny.has("kw_default") ? { type: "kw_default" } : kw_default, "expr"], postprocess: (x) => (0, lexer_2.track)(x, { type: "default", default: unwrap2(x[1]) }) },
          { name: "createtable_column_constraint_def", symbols: [lexer_1.lexerAny.has("kw_check") ? { type: "kw_check" } : kw_check, "expr_paren"], postprocess: (x) => (0, lexer_2.track)(x, { type: "check", expr: unwrap2(x[1]) }) },
          { name: "createtable_column_constraint_def", symbols: ["createtable_references"], postprocess: (x) => (0, lexer_2.track)(x, { type: "reference", ...unwrap2(x) }) },
          { name: "createtable_column_constraint_def", symbols: ["altercol_generated"] },
          { name: "createtable_collate", symbols: [lexer_1.lexerAny.has("kw_collate") ? { type: "kw_collate" } : kw_collate, "qualified_name"] },
          { name: "createtable_opts$subexpression$1", symbols: ["word"], postprocess: kw("inherits") },
          { name: "createtable_opts$macrocall$2", symbols: ["qname"] },
          { name: "createtable_opts$macrocall$1$ebnf$1", symbols: [] },
          { name: "createtable_opts$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "createtable_opts$macrocall$2"], postprocess: last },
          { name: "createtable_opts$macrocall$1$ebnf$1", symbols: ["createtable_opts$macrocall$1$ebnf$1", "createtable_opts$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "createtable_opts$macrocall$1", symbols: ["createtable_opts$macrocall$2", "createtable_opts$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "createtable_opts", symbols: ["createtable_opts$subexpression$1", "lparen", "createtable_opts$macrocall$1", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, { inherits: x[2] }) },
          { name: "createindex_statement$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_unique") ? { type: "kw_unique" } : kw_unique], postprocess: id },
          { name: "createindex_statement$ebnf$1", symbols: [], postprocess: () => null },
          { name: "createindex_statement$ebnf$2", symbols: [lexer_1.lexerAny.has("kw_concurrently") ? { type: "kw_concurrently" } : kw_concurrently], postprocess: id },
          { name: "createindex_statement$ebnf$2", symbols: [], postprocess: () => null },
          { name: "createindex_statement$ebnf$3", symbols: ["kw_ifnotexists"], postprocess: id },
          { name: "createindex_statement$ebnf$3", symbols: [], postprocess: () => null },
          { name: "createindex_statement$ebnf$4", symbols: ["word"], postprocess: id },
          { name: "createindex_statement$ebnf$4", symbols: [], postprocess: () => null },
          { name: "createindex_statement$ebnf$5$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_using") ? { type: "kw_using" } : kw_using, "ident"], postprocess: last },
          { name: "createindex_statement$ebnf$5", symbols: ["createindex_statement$ebnf$5$subexpression$1"], postprocess: id },
          { name: "createindex_statement$ebnf$5", symbols: [], postprocess: () => null },
          { name: "createindex_statement$ebnf$6", symbols: ["createindex_with"], postprocess: id },
          { name: "createindex_statement$ebnf$6", symbols: [], postprocess: () => null },
          { name: "createindex_statement$ebnf$7", symbols: ["createindex_tblspace"], postprocess: id },
          { name: "createindex_statement$ebnf$7", symbols: [], postprocess: () => null },
          { name: "createindex_statement$ebnf$8", symbols: ["createindex_predicate"], postprocess: id },
          { name: "createindex_statement$ebnf$8", symbols: [], postprocess: () => null },
          { name: "createindex_statement", symbols: [lexer_1.lexerAny.has("kw_create") ? { type: "kw_create" } : kw_create, "createindex_statement$ebnf$1", "kw_index", "createindex_statement$ebnf$2", "createindex_statement$ebnf$3", "createindex_statement$ebnf$4", lexer_1.lexerAny.has("kw_on") ? { type: "kw_on" } : kw_on, "table_ref", "createindex_statement$ebnf$5", "lparen", "createindex_expressions", "rparen", "createindex_statement$ebnf$6", "createindex_statement$ebnf$7", "createindex_statement$ebnf$8"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "create index",
            ...x[1] && { unique: true },
            ...x[3] && { concurrently: true },
            ...x[4] && { ifNotExists: true },
            ...x[5] && { indexName: asName(x[5]) },
            table: x[7],
            ...x[8] && { using: asName(x[8]) },
            expressions: x[10],
            ...x[12] && { with: x[12] },
            ...x[13] && { tablespace: unwrap2(x[13]) },
            ...x[14] && { where: unwrap2(x[14]) }
          }) },
          { name: "createindex_expressions$ebnf$1", symbols: [] },
          { name: "createindex_expressions$ebnf$1$subexpression$1", symbols: ["comma", "createindex_expression"], postprocess: last },
          { name: "createindex_expressions$ebnf$1", symbols: ["createindex_expressions$ebnf$1", "createindex_expressions$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "createindex_expressions", symbols: ["createindex_expression", "createindex_expressions$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "createindex_expression$subexpression$1", symbols: ["expr_basic"] },
          { name: "createindex_expression$subexpression$1", symbols: ["expr_paren"] },
          { name: "createindex_expression$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_collate") ? { type: "kw_collate" } : kw_collate, "qualified_name"], postprocess: last },
          { name: "createindex_expression$ebnf$1", symbols: ["createindex_expression$ebnf$1$subexpression$1"], postprocess: id },
          { name: "createindex_expression$ebnf$1", symbols: [], postprocess: () => null },
          { name: "createindex_expression$ebnf$2", symbols: ["qualified_name"], postprocess: id },
          { name: "createindex_expression$ebnf$2", symbols: [], postprocess: () => null },
          { name: "createindex_expression$ebnf$3$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_asc") ? { type: "kw_asc" } : kw_asc] },
          { name: "createindex_expression$ebnf$3$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_desc") ? { type: "kw_desc" } : kw_desc] },
          { name: "createindex_expression$ebnf$3", symbols: ["createindex_expression$ebnf$3$subexpression$1"], postprocess: id },
          { name: "createindex_expression$ebnf$3", symbols: [], postprocess: () => null },
          { name: "createindex_expression$ebnf$4$subexpression$1$subexpression$1", symbols: ["kw_first"] },
          { name: "createindex_expression$ebnf$4$subexpression$1$subexpression$1", symbols: ["kw_last"] },
          { name: "createindex_expression$ebnf$4$subexpression$1", symbols: ["kw_nulls", "createindex_expression$ebnf$4$subexpression$1$subexpression$1"], postprocess: last },
          { name: "createindex_expression$ebnf$4", symbols: ["createindex_expression$ebnf$4$subexpression$1"], postprocess: id },
          { name: "createindex_expression$ebnf$4", symbols: [], postprocess: () => null },
          { name: "createindex_expression", symbols: ["createindex_expression$subexpression$1", "createindex_expression$ebnf$1", "createindex_expression$ebnf$2", "createindex_expression$ebnf$3", "createindex_expression$ebnf$4"], postprocess: (x) => (0, lexer_2.track)(x, {
            expression: unwrap2(x[0]),
            ...x[1] && { collate: unwrap2(x[1]) },
            ...x[2] && { opclass: unwrap2(x[2]) },
            ...x[3] && { order: unwrap2(x[3]).value },
            ...x[4] && { nulls: unwrap2(x[4]) }
          }) },
          { name: "createindex_predicate", symbols: [lexer_1.lexerAny.has("kw_where") ? { type: "kw_where" } : kw_where, "expr"], postprocess: last },
          { name: "createindex_with$macrocall$2", symbols: ["createindex_with_item"] },
          { name: "createindex_with$macrocall$1$ebnf$1", symbols: [] },
          { name: "createindex_with$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "createindex_with$macrocall$2"], postprocess: last },
          { name: "createindex_with$macrocall$1$ebnf$1", symbols: ["createindex_with$macrocall$1$ebnf$1", "createindex_with$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "createindex_with$macrocall$1", symbols: ["createindex_with$macrocall$2", "createindex_with$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "createindex_with", symbols: [lexer_1.lexerAny.has("kw_with") ? { type: "kw_with" } : kw_with, "lparen", "createindex_with$macrocall$1", "rparen"], postprocess: get(2) },
          { name: "createindex_with_item$subexpression$1", symbols: ["string"] },
          { name: "createindex_with_item$subexpression$1", symbols: ["int"] },
          { name: "createindex_with_item", symbols: ["ident", lexer_1.lexerAny.has("op_eq") ? { type: "op_eq" } : op_eq, "createindex_with_item$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, { parameter: toStr(x[0]), value: unwrap2(x[2]).toString() }) },
          { name: "createindex_tblspace", symbols: ["kw_tablespace", "ident"], postprocess: last },
          { name: "createextension_statement$ebnf$1", symbols: ["kw_ifnotexists"], postprocess: id },
          { name: "createextension_statement$ebnf$1", symbols: [], postprocess: () => null },
          { name: "createextension_statement$ebnf$2", symbols: [lexer_1.lexerAny.has("kw_with") ? { type: "kw_with" } : kw_with], postprocess: id },
          { name: "createextension_statement$ebnf$2", symbols: [], postprocess: () => null },
          { name: "createextension_statement$ebnf$3$subexpression$1", symbols: ["kw_schema", "word"], postprocess: last },
          { name: "createextension_statement$ebnf$3", symbols: ["createextension_statement$ebnf$3$subexpression$1"], postprocess: id },
          { name: "createextension_statement$ebnf$3", symbols: [], postprocess: () => null },
          { name: "createextension_statement$ebnf$4$subexpression$1", symbols: ["kw_version", "string"], postprocess: last },
          { name: "createextension_statement$ebnf$4", symbols: ["createextension_statement$ebnf$4$subexpression$1"], postprocess: id },
          { name: "createextension_statement$ebnf$4", symbols: [], postprocess: () => null },
          { name: "createextension_statement$ebnf$5$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_from") ? { type: "kw_from" } : kw_from, "string"], postprocess: last },
          { name: "createextension_statement$ebnf$5", symbols: ["createextension_statement$ebnf$5$subexpression$1"], postprocess: id },
          { name: "createextension_statement$ebnf$5", symbols: [], postprocess: () => null },
          { name: "createextension_statement", symbols: [lexer_1.lexerAny.has("kw_create") ? { type: "kw_create" } : kw_create, "kw_extension", "createextension_statement$ebnf$1", "word", "createextension_statement$ebnf$2", "createextension_statement$ebnf$3", "createextension_statement$ebnf$4", "createextension_statement$ebnf$5"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "create extension",
            ...x[2] ? { ifNotExists: true } : {},
            extension: asName(x[3]),
            ...x[5] ? { schema: asName(x[5]) } : {},
            ...x[6] ? { version: asLit(x[6]) } : {},
            ...x[7] ? { from: asLit(x[7]) } : {}
          }) },
          { name: "simplestatements_all", symbols: ["simplestatements_start_transaction"] },
          { name: "simplestatements_all", symbols: ["simplestatements_commit"] },
          { name: "simplestatements_all", symbols: ["simplestatements_rollback"] },
          { name: "simplestatements_all", symbols: ["simplestatements_tablespace"] },
          { name: "simplestatements_all", symbols: ["simplestatements_set"] },
          { name: "simplestatements_all", symbols: ["simplestatements_show"] },
          { name: "simplestatements_all", symbols: ["simplestatements_begin"] },
          { name: "simplestatements_start_transaction$subexpression$1", symbols: ["kw_start", "kw_transaction"] },
          { name: "simplestatements_start_transaction", symbols: ["simplestatements_start_transaction$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, { type: "start transaction" }) },
          { name: "simplestatements_commit", symbols: ["kw_commit"], postprocess: (x) => (0, lexer_2.track)(x, { type: "commit" }) },
          { name: "simplestatements_rollback", symbols: ["kw_rollback"], postprocess: (x) => (0, lexer_2.track)(x, { type: "rollback" }) },
          { name: "simplestatements_tablespace", symbols: ["kw_tablespace", "word"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "tablespace",
            tablespace: asName(x[1])
          }) },
          { name: "simplestatements_set$subexpression$1", symbols: ["simplestatements_set_simple"] },
          { name: "simplestatements_set$subexpression$1", symbols: ["simplestatements_set_timezone"] },
          { name: "simplestatements_set$subexpression$1", symbols: ["simplestatements_set_names"] },
          { name: "simplestatements_set", symbols: ["kw_set", "simplestatements_set$subexpression$1"], postprocess: last },
          { name: "simplestatements_set_timezone", symbols: ["kw_time", "kw_zone", "simplestatements_set_timezone_val"], postprocess: (x) => (0, lexer_2.track)(x, { type: "set timezone", to: x[2] }) },
          { name: "simplestatements_set_timezone_val$subexpression$1", symbols: ["string"] },
          { name: "simplestatements_set_timezone_val$subexpression$1", symbols: ["int"] },
          { name: "simplestatements_set_timezone_val", symbols: ["simplestatements_set_timezone_val$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, { type: "value", value: unwrap2(x[0]) }) },
          { name: "simplestatements_set_timezone_val", symbols: ["kw_local"], postprocess: (x) => (0, lexer_2.track)(x, { type: "local" }) },
          { name: "simplestatements_set_timezone_val", symbols: [lexer_1.lexerAny.has("kw_default") ? { type: "kw_default" } : kw_default], postprocess: (x) => (0, lexer_2.track)(x, { type: "default" }) },
          { name: "simplestatements_set_timezone_val", symbols: ["kw_interval", "string", "kw_hour", lexer_1.lexerAny.has("kw_to") ? { type: "kw_to" } : kw_to, "kw_minute"], postprocess: (x) => (0, lexer_2.track)(x, { type: "interval", value: (0, lexer_2.unbox)(x[1]) }) },
          { name: "simplestatements_set_names", symbols: ["kw_names", "simplestatements_set_names_val"], postprocess: (x) => (0, lexer_2.track)(x, { type: "set names", to: x[1] }) },
          { name: "simplestatements_set_names_val$subexpression$1", symbols: ["string"] },
          { name: "simplestatements_set_names_val", symbols: ["simplestatements_set_names_val$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, { type: "value", value: unwrap2(x[0]) }) },
          { name: "simplestatements_set_simple$ebnf$1$subexpression$1", symbols: ["kw_local"] },
          { name: "simplestatements_set_simple$ebnf$1$subexpression$1", symbols: ["kw_session"] },
          { name: "simplestatements_set_simple$ebnf$1", symbols: ["simplestatements_set_simple$ebnf$1$subexpression$1"], postprocess: id },
          { name: "simplestatements_set_simple$ebnf$1", symbols: [], postprocess: () => null },
          { name: "simplestatements_set_simple$subexpression$1", symbols: [lexer_1.lexerAny.has("op_eq") ? { type: "op_eq" } : op_eq] },
          { name: "simplestatements_set_simple$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_to") ? { type: "kw_to" } : kw_to] },
          { name: "simplestatements_set_simple", symbols: ["simplestatements_set_simple$ebnf$1", "ident", "simplestatements_set_simple$subexpression$1", "simplestatements_set_val"], postprocess: (x) => {
            var _a;
            return (0, lexer_2.track)(x, {
              type: "set",
              variable: asName(x[1]),
              scope: (_a = unwrap2(x[0])) === null || _a === undefined ? undefined : _a.toLowerCase(),
              set: (0, lexer_2.unbox)(x[3])
            });
          } },
          { name: "simplestatements_set_val", symbols: ["simplestatements_set_val_raw"], postprocess: unwrap2 },
          { name: "simplestatements_set_val", symbols: [lexer_1.lexerAny.has("kw_default") ? { type: "kw_default" } : kw_default], postprocess: (x) => (0, lexer_2.track)(x, { type: "default" }) },
          { name: "simplestatements_set_val$ebnf$1$subexpression$1", symbols: ["comma", "simplestatements_set_val_raw"] },
          { name: "simplestatements_set_val$ebnf$1", symbols: ["simplestatements_set_val$ebnf$1$subexpression$1"] },
          { name: "simplestatements_set_val$ebnf$1$subexpression$2", symbols: ["comma", "simplestatements_set_val_raw"] },
          { name: "simplestatements_set_val$ebnf$1", symbols: ["simplestatements_set_val$ebnf$1", "simplestatements_set_val$ebnf$1$subexpression$2"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "simplestatements_set_val", symbols: ["simplestatements_set_val_raw", "simplestatements_set_val$ebnf$1"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "list",
            values: [x[0], ...x[1] || []]
          }) },
          { name: "simplestatements_set_val_raw$subexpression$1", symbols: ["string"] },
          { name: "simplestatements_set_val_raw$subexpression$1", symbols: ["int"] },
          { name: "simplestatements_set_val_raw", symbols: ["simplestatements_set_val_raw$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, { type: "value", value: unwrap2(x) }) },
          { name: "simplestatements_set_val_raw$subexpression$2", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word] },
          { name: "simplestatements_set_val_raw$subexpression$2", symbols: [lexer_1.lexerAny.has("kw_on") ? { type: "kw_on" } : kw_on] },
          { name: "simplestatements_set_val_raw$subexpression$2", symbols: [lexer_1.lexerAny.has("kw_true") ? { type: "kw_true" } : kw_true] },
          { name: "simplestatements_set_val_raw$subexpression$2", symbols: [lexer_1.lexerAny.has("kw_false") ? { type: "kw_false" } : kw_false] },
          { name: "simplestatements_set_val_raw", symbols: ["simplestatements_set_val_raw$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, { type: "identifier", name: unwrap2(x).value }) },
          { name: "simplestatements_set_val_raw", symbols: [lexer_1.lexerAny.has("quoted_word") ? { type: "quoted_word" } : quoted_word], postprocess: (x) => (0, lexer_2.track)(x, { type: "identifier", doubleQuoted: true, name: unwrap2(x).value }) },
          { name: "simplestatements_show", symbols: ["kw_show", "ident"], postprocess: (x) => (0, lexer_2.track)(x, { type: "show", variable: asName(x[1]) }) },
          { name: "create_schema$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_create") ? { type: "kw_create" } : kw_create, "kw_schema"] },
          { name: "create_schema$ebnf$1", symbols: ["kw_ifnotexists"], postprocess: id },
          { name: "create_schema$ebnf$1", symbols: [], postprocess: () => null },
          { name: "create_schema", symbols: ["create_schema$subexpression$1", "create_schema$ebnf$1", "ident"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "create schema",
            name: asName(x[2]),
            ...x[1] ? { ifNotExists: true } : {}
          }) },
          { name: "raise_statement$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: anyKw("debug", "log", "info", "notice", "warning", "exception") },
          { name: "raise_statement$ebnf$1", symbols: ["raise_statement$ebnf$1$subexpression$1"], postprocess: id },
          { name: "raise_statement$ebnf$1", symbols: [], postprocess: () => null },
          { name: "raise_statement$ebnf$2$subexpression$1", symbols: ["comma", "expr_list_raw"], postprocess: last },
          { name: "raise_statement$ebnf$2", symbols: ["raise_statement$ebnf$2$subexpression$1"], postprocess: id },
          { name: "raise_statement$ebnf$2", symbols: [], postprocess: () => null },
          { name: "raise_statement$ebnf$3", symbols: ["raise_using"], postprocess: id },
          { name: "raise_statement$ebnf$3", symbols: [], postprocess: () => null },
          { name: "raise_statement", symbols: ["kw_raise", "raise_statement$ebnf$1", "string", "raise_statement$ebnf$2", "raise_statement$ebnf$3"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "raise",
            format: toStr(x[2]),
            ...x[1] && { level: toStr(x[1]) },
            ...x[3] && x[3].length && { formatExprs: x[3] },
            ...x[4] && x[4].length && { using: x[4] }
          }) },
          { name: "raise_using$macrocall$2", symbols: ["raise_using_one"] },
          { name: "raise_using$macrocall$1$ebnf$1", symbols: [] },
          { name: "raise_using$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "raise_using$macrocall$2"], postprocess: last },
          { name: "raise_using$macrocall$1$ebnf$1", symbols: ["raise_using$macrocall$1$ebnf$1", "raise_using$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "raise_using$macrocall$1", symbols: ["raise_using$macrocall$2", "raise_using$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "raise_using", symbols: [lexer_1.lexerAny.has("kw_using") ? { type: "kw_using" } : kw_using, "raise_using$macrocall$1"], postprocess: last },
          { name: "raise_using_one", symbols: ["raise_using_what", lexer_1.lexerAny.has("op_eq") ? { type: "op_eq" } : op_eq, "expr"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: toStr(x[0]),
            value: x[2]
          }) },
          { name: "raise_using_what", symbols: [lexer_1.lexerAny.has("kw_table") ? { type: "kw_table" } : kw_table] },
          { name: "raise_using_what", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: anyKw("message", "detail", "hint", "errcode", "column", "constraint", "datatype", "schema") },
          { name: "comment_statement", symbols: ["kw_comment", lexer_1.lexerAny.has("kw_on") ? { type: "kw_on" } : kw_on, "comment_what", lexer_1.lexerAny.has("kw_is") ? { type: "kw_is" } : kw_is, "string"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "comment",
            comment: (0, lexer_2.unbox)(last(x)),
            on: unwrap2(x[2])
          }) },
          { name: "comment_what", symbols: ["comment_what_col"] },
          { name: "comment_what", symbols: ["comment_what_nm"] },
          { name: "comment_what_nm$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_table") ? { type: "kw_table" } : kw_table] },
          { name: "comment_what_nm$subexpression$1", symbols: ["kw_materialized", "kw_view"] },
          { name: "comment_what_nm$subexpression$1", symbols: [lexer_1.lexerAny.has("word") ? { type: "word" } : word], postprocess: anyKw("database", "index", "trigger", "type", "view") },
          { name: "comment_what_nm", symbols: ["comment_what_nm$subexpression$1", "qualified_name"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: toStr(x[0]),
            name: x[1]
          }) },
          { name: "comment_what_col", symbols: ["kw_column", "qcolumn"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "column",
            column: last(x)
          }) },
          { name: "simplestatements_begin$ebnf$1$subexpression$1", symbols: ["kw_transaction"] },
          { name: "simplestatements_begin$ebnf$1$subexpression$1", symbols: ["kw_work"] },
          { name: "simplestatements_begin$ebnf$1", symbols: ["simplestatements_begin$ebnf$1$subexpression$1"], postprocess: id },
          { name: "simplestatements_begin$ebnf$1", symbols: [], postprocess: () => null },
          { name: "simplestatements_begin$ebnf$2", symbols: [] },
          { name: "simplestatements_begin$ebnf$2$subexpression$1", symbols: ["simplestatements_begin_isol"] },
          { name: "simplestatements_begin$ebnf$2$subexpression$1", symbols: ["simplestatements_begin_writ"] },
          { name: "simplestatements_begin$ebnf$2$subexpression$1", symbols: ["simplestatements_begin_def"] },
          { name: "simplestatements_begin$ebnf$2", symbols: ["simplestatements_begin$ebnf$2", "simplestatements_begin$ebnf$2$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          {
            name: "simplestatements_begin",
            symbols: ["kw_begin", "simplestatements_begin$ebnf$1", "simplestatements_begin$ebnf$2"],
            postprocess: (x) => (0, lexer_2.track)(x, {
              type: "begin",
              ...x[2].reduce((a, b) => ({ ...unwrap2(a), ...unwrap2(b) }), {})
            })
          },
          { name: "simplestatements_begin_isol$subexpression$1", symbols: ["kw_isolation", "kw_level"] },
          { name: "simplestatements_begin_isol$subexpression$2", symbols: ["kw_serializable"] },
          { name: "simplestatements_begin_isol$subexpression$2$subexpression$1", symbols: ["word"], postprocess: kw("repeatable") },
          { name: "simplestatements_begin_isol$subexpression$2", symbols: ["simplestatements_begin_isol$subexpression$2$subexpression$1", "kw_read"] },
          { name: "simplestatements_begin_isol$subexpression$2$subexpression$2", symbols: ["word"], postprocess: kw("committed") },
          { name: "simplestatements_begin_isol$subexpression$2", symbols: ["kw_read", "simplestatements_begin_isol$subexpression$2$subexpression$2"] },
          { name: "simplestatements_begin_isol$subexpression$2$subexpression$3", symbols: ["word"], postprocess: kw("uncommitted") },
          { name: "simplestatements_begin_isol$subexpression$2", symbols: ["kw_read", "simplestatements_begin_isol$subexpression$2$subexpression$3"] },
          { name: "simplestatements_begin_isol", symbols: ["simplestatements_begin_isol$subexpression$1", "simplestatements_begin_isol$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            isolationLevel: toStr(x[1], " ")
          }) },
          { name: "simplestatements_begin_writ$subexpression$1", symbols: ["kw_read", "kw_write"] },
          { name: "simplestatements_begin_writ$subexpression$1", symbols: ["kw_read", lexer_1.lexerAny.has("kw_only") ? { type: "kw_only" } : kw_only] },
          { name: "simplestatements_begin_writ", symbols: ["simplestatements_begin_writ$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, {
            writeable: toStr(x, " ")
          }) },
          { name: "simplestatements_begin_def$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_not") ? { type: "kw_not" } : kw_not], postprocess: id },
          { name: "simplestatements_begin_def$ebnf$1", symbols: [], postprocess: () => null },
          { name: "simplestatements_begin_def", symbols: ["simplestatements_begin_def$ebnf$1", lexer_1.lexerAny.has("kw_deferrable") ? { type: "kw_deferrable" } : kw_deferrable], postprocess: (x) => (0, lexer_2.track)(x, {
            deferrable: !x[0]
          }) },
          { name: "insert_statement$subexpression$1", symbols: ["kw_insert", lexer_1.lexerAny.has("kw_into") ? { type: "kw_into" } : kw_into] },
          { name: "insert_statement$ebnf$1", symbols: ["collist_paren"], postprocess: id },
          { name: "insert_statement$ebnf$1", symbols: [], postprocess: () => null },
          { name: "insert_statement$ebnf$2$subexpression$1$subexpression$1", symbols: ["kw_system"] },
          { name: "insert_statement$ebnf$2$subexpression$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_user") ? { type: "kw_user" } : kw_user] },
          { name: "insert_statement$ebnf$2$subexpression$1", symbols: ["kw_overriding", "insert_statement$ebnf$2$subexpression$1$subexpression$1", "kw_value"], postprocess: get(1) },
          { name: "insert_statement$ebnf$2", symbols: ["insert_statement$ebnf$2$subexpression$1"], postprocess: id },
          { name: "insert_statement$ebnf$2", symbols: [], postprocess: () => null },
          { name: "insert_statement$ebnf$3$subexpression$1", symbols: ["selection"] },
          { name: "insert_statement$ebnf$3$subexpression$1", symbols: ["selection_paren"] },
          { name: "insert_statement$ebnf$3", symbols: ["insert_statement$ebnf$3$subexpression$1"], postprocess: id },
          { name: "insert_statement$ebnf$3", symbols: [], postprocess: () => null },
          { name: "insert_statement$ebnf$4$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_on") ? { type: "kw_on" } : kw_on, "kw_conflict", "insert_on_conflict"], postprocess: last },
          { name: "insert_statement$ebnf$4", symbols: ["insert_statement$ebnf$4$subexpression$1"], postprocess: id },
          { name: "insert_statement$ebnf$4", symbols: [], postprocess: () => null },
          { name: "insert_statement$ebnf$5$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_returning") ? { type: "kw_returning" } : kw_returning, "select_expr_list_aliased"], postprocess: last },
          { name: "insert_statement$ebnf$5", symbols: ["insert_statement$ebnf$5$subexpression$1"], postprocess: id },
          { name: "insert_statement$ebnf$5", symbols: [], postprocess: () => null },
          { name: "insert_statement", symbols: ["insert_statement$subexpression$1", "table_ref_aliased", "insert_statement$ebnf$1", "insert_statement$ebnf$2", "insert_statement$ebnf$3", "insert_statement$ebnf$4", "insert_statement$ebnf$5"], postprocess: (x) => {
            const columns = x[2] && x[2].map(asName);
            const overriding = toStr(x[3]);
            const insert2 = unwrap2(x[4]);
            const onConflict = x[5];
            const returning = x[6];
            return (0, lexer_2.track)(x, {
              type: "insert",
              into: unwrap2(x[1]),
              insert: insert2,
              ...overriding && { overriding },
              ...columns && { columns },
              ...returning && { returning },
              ...onConflict && { onConflict }
            });
          } },
          { name: "insert_values$ebnf$1", symbols: [] },
          { name: "insert_values$ebnf$1$subexpression$1", symbols: ["comma", "insert_value"], postprocess: last },
          { name: "insert_values$ebnf$1", symbols: ["insert_values$ebnf$1", "insert_values$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "insert_values", symbols: ["insert_value", "insert_values$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "insert_value", symbols: ["lparen", "insert_expr_list_raw", "rparen"], postprocess: get(1) },
          { name: "insert_expr_list_raw$ebnf$1", symbols: [] },
          { name: "insert_expr_list_raw$ebnf$1$subexpression$1", symbols: ["comma", "expr_or_select"], postprocess: last },
          { name: "insert_expr_list_raw$ebnf$1", symbols: ["insert_expr_list_raw$ebnf$1", "insert_expr_list_raw$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "insert_expr_list_raw", symbols: ["expr_or_select", "insert_expr_list_raw$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "insert_on_conflict$ebnf$1", symbols: ["insert_on_conflict_what"], postprocess: id },
          { name: "insert_on_conflict$ebnf$1", symbols: [], postprocess: () => null },
          { name: "insert_on_conflict", symbols: ["insert_on_conflict$ebnf$1", "insert_on_conflict_do"], postprocess: (x) => (0, lexer_2.track)(x, {
            ...x[0] ? { on: unwrap2(x[0]) } : {},
            ...x[1]
          }) },
          { name: "insert_on_conflict_what", symbols: ["lparen", "expr_list_raw", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "on expr",
            exprs: x[1]
          }) },
          { name: "insert_on_conflict_what", symbols: [lexer_1.lexerAny.has("kw_on") ? { type: "kw_on" } : kw_on, lexer_1.lexerAny.has("kw_constraint") ? { type: "kw_constraint" } : kw_constraint, "qname"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "on constraint",
            constraint: last(x)
          }) },
          { name: "insert_on_conflict_do", symbols: [lexer_1.lexerAny.has("kw_do") ? { type: "kw_do" } : kw_do, "kw_nothing"], postprocess: (x) => ({ do: "do nothing" }) },
          { name: "insert_on_conflict_do$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_do") ? { type: "kw_do" } : kw_do, "kw_update", "kw_set"] },
          { name: "insert_on_conflict_do$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_where") ? { type: "kw_where" } : kw_where, "expr"], postprocess: last },
          { name: "insert_on_conflict_do$ebnf$1", symbols: ["insert_on_conflict_do$ebnf$1$subexpression$1"], postprocess: id },
          { name: "insert_on_conflict_do$ebnf$1", symbols: [], postprocess: () => null },
          { name: "insert_on_conflict_do", symbols: ["insert_on_conflict_do$subexpression$1", "update_set_list", "insert_on_conflict_do$ebnf$1"], postprocess: (x) => ({
            do: { sets: x[1] },
            ...x[2] && { where: x[2] }
          }) },
          { name: "update_statement$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_from") ? { type: "kw_from" } : kw_from, "select_from_subject"], postprocess: last },
          { name: "update_statement$ebnf$1", symbols: ["update_statement$ebnf$1$subexpression$1"], postprocess: id },
          { name: "update_statement$ebnf$1", symbols: [], postprocess: () => null },
          { name: "update_statement$ebnf$2", symbols: ["select_where"], postprocess: id },
          { name: "update_statement$ebnf$2", symbols: [], postprocess: () => null },
          { name: "update_statement$ebnf$3$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_returning") ? { type: "kw_returning" } : kw_returning, "select_expr_list_aliased"], postprocess: last },
          { name: "update_statement$ebnf$3", symbols: ["update_statement$ebnf$3$subexpression$1"], postprocess: id },
          { name: "update_statement$ebnf$3", symbols: [], postprocess: () => null },
          { name: "update_statement", symbols: ["kw_update", "table_ref_aliased", "kw_set", "update_set_list", "update_statement$ebnf$1", "update_statement$ebnf$2", "update_statement$ebnf$3"], postprocess: (x) => {
            const from = unwrap2(x[4]);
            const where = unwrap2(x[5]);
            const returning = x[6];
            return (0, lexer_2.track)(x, {
              type: "update",
              table: unwrap2(x[1]),
              sets: x[3],
              ...where ? { where } : {},
              ...from ? { from } : {},
              ...returning ? { returning } : {}
            });
          } },
          { name: "update_set_list$ebnf$1", symbols: [] },
          { name: "update_set_list$ebnf$1$subexpression$1", symbols: ["comma", "update_set"], postprocess: last },
          { name: "update_set_list$ebnf$1", symbols: ["update_set_list$ebnf$1", "update_set_list$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "update_set_list", symbols: ["update_set", "update_set_list$ebnf$1"], postprocess: ([head, tail]) => {
            const ret = [];
            for (const _t of [head, ...tail || []]) {
              const t = unwrap2(_t);
              if (Array.isArray(t)) {
                ret.push(...t);
              } else {
                ret.push(t);
              }
            }
            return ret;
          } },
          { name: "update_set", symbols: ["update_set_one"] },
          { name: "update_set", symbols: ["update_set_multiple"] },
          { name: "update_set_one", symbols: ["ident", lexer_1.lexerAny.has("op_eq") ? { type: "op_eq" } : op_eq, "expr"], postprocess: (x) => (0, lexer_2.box)(x, {
            column: asName(x[0]),
            value: unwrap2(x[2])
          }) },
          { name: "update_set_multiple$subexpression$1", symbols: ["lparen", "expr_list_raw", "rparen"], postprocess: get(1) },
          { name: "update_set_multiple", symbols: ["collist_paren", lexer_1.lexerAny.has("op_eq") ? { type: "op_eq" } : op_eq, "update_set_multiple$subexpression$1"], postprocess: (x) => {
            const cols = x[0];
            const exprs = x[2];
            if (cols.length !== exprs.length) {
              throw new Error("number of columns does not match number of values");
            }
            return (0, lexer_2.box)(x, cols.map((x2, i) => ({
              column: asName(x2),
              value: unwrap2(exprs[i])
            })));
          } },
          { name: "altertable_statement$ebnf$1", symbols: ["kw_ifexists"], postprocess: id },
          { name: "altertable_statement$ebnf$1", symbols: [], postprocess: () => null },
          { name: "altertable_statement$ebnf$2", symbols: [lexer_1.lexerAny.has("kw_only") ? { type: "kw_only" } : kw_only], postprocess: id },
          { name: "altertable_statement$ebnf$2", symbols: [], postprocess: () => null },
          { name: "altertable_statement", symbols: ["kw_alter", lexer_1.lexerAny.has("kw_table") ? { type: "kw_table" } : kw_table, "altertable_statement$ebnf$1", "altertable_statement$ebnf$2", "table_ref", "altertable_actions"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "alter table",
            ...x[2] ? { ifExists: true } : {},
            ...x[3] ? { only: true } : {},
            table: unwrap2(x[4]),
            changes: (0, lexer_2.unbox)(x[5]).map(unwrap2)
          }) },
          { name: "altertable_actions$ebnf$1", symbols: [] },
          { name: "altertable_actions$ebnf$1$subexpression$1", symbols: ["comma", "altertable_action"], postprocess: last },
          { name: "altertable_actions$ebnf$1", symbols: ["altertable_actions$ebnf$1", "altertable_actions$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "altertable_actions", symbols: ["altertable_action", "altertable_actions$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "altertable_action", symbols: ["altertable_rename_table"] },
          { name: "altertable_action", symbols: ["altertable_rename_column"] },
          { name: "altertable_action", symbols: ["altertable_rename_constraint"] },
          { name: "altertable_action", symbols: ["altertable_add_column"] },
          { name: "altertable_action", symbols: ["altertable_drop_column"] },
          { name: "altertable_action", symbols: ["altertable_alter_column"] },
          { name: "altertable_action", symbols: ["altertable_add_constraint"] },
          { name: "altertable_action", symbols: ["altertable_drop_constraint"] },
          { name: "altertable_action", symbols: ["altertable_owner"] },
          { name: "altertable_rename_table", symbols: ["kw_rename", lexer_1.lexerAny.has("kw_to") ? { type: "kw_to" } : kw_to, "word"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "rename",
            to: asName(last(x))
          }) },
          { name: "altertable_rename_column$ebnf$1", symbols: ["kw_column"], postprocess: id },
          { name: "altertable_rename_column$ebnf$1", symbols: [], postprocess: () => null },
          { name: "altertable_rename_column", symbols: ["kw_rename", "altertable_rename_column$ebnf$1", "ident", lexer_1.lexerAny.has("kw_to") ? { type: "kw_to" } : kw_to, "ident"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "rename column",
            column: asName(x[2]),
            to: asName(last(x))
          }) },
          { name: "altertable_rename_constraint", symbols: ["kw_rename", lexer_1.lexerAny.has("kw_constraint") ? { type: "kw_constraint" } : kw_constraint, "ident", lexer_1.lexerAny.has("kw_to") ? { type: "kw_to" } : kw_to, "ident"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "rename constraint",
            constraint: asName(x[2]),
            to: asName(last(x))
          }) },
          { name: "altertable_add_column$ebnf$1", symbols: ["kw_column"], postprocess: id },
          { name: "altertable_add_column$ebnf$1", symbols: [], postprocess: () => null },
          { name: "altertable_add_column$ebnf$2", symbols: ["kw_ifnotexists"], postprocess: id },
          { name: "altertable_add_column$ebnf$2", symbols: [], postprocess: () => null },
          { name: "altertable_add_column", symbols: ["kw_add", "altertable_add_column$ebnf$1", "altertable_add_column$ebnf$2", "createtable_column"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "add column",
            ...x[2] ? { ifNotExists: true } : {},
            column: unwrap2(x[3])
          }) },
          { name: "altertable_drop_column$ebnf$1", symbols: ["kw_column"], postprocess: id },
          { name: "altertable_drop_column$ebnf$1", symbols: [], postprocess: () => null },
          { name: "altertable_drop_column$ebnf$2", symbols: ["kw_ifexists"], postprocess: id },
          { name: "altertable_drop_column$ebnf$2", symbols: [], postprocess: () => null },
          { name: "altertable_drop_column$ebnf$3$subexpression$1", symbols: ["kw_restrict"] },
          { name: "altertable_drop_column$ebnf$3$subexpression$1", symbols: ["kw_cascade"] },
          { name: "altertable_drop_column$ebnf$3", symbols: ["altertable_drop_column$ebnf$3$subexpression$1"], postprocess: id },
          { name: "altertable_drop_column$ebnf$3", symbols: [], postprocess: () => null },
          { name: "altertable_drop_column", symbols: ["kw_drop", "altertable_drop_column$ebnf$1", "altertable_drop_column$ebnf$2", "ident", "altertable_drop_column$ebnf$3"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "drop column",
            ...x[2] ? { ifExists: true } : {},
            column: asName(x[3]),
            ...x[4] ? { behaviour: toStr(x[4], " ") } : {}
          }) },
          { name: "altertable_alter_column$ebnf$1", symbols: ["kw_column"], postprocess: id },
          { name: "altertable_alter_column$ebnf$1", symbols: [], postprocess: () => null },
          { name: "altertable_alter_column", symbols: ["kw_alter", "altertable_alter_column$ebnf$1", "ident", "altercol"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "alter column",
            column: asName(x[2]),
            alter: unwrap2(x[3])
          }) },
          { name: "altercol$ebnf$1$subexpression$1", symbols: ["kw_set", "kw_data"] },
          { name: "altercol$ebnf$1", symbols: ["altercol$ebnf$1$subexpression$1"], postprocess: id },
          { name: "altercol$ebnf$1", symbols: [], postprocess: () => null },
          { name: "altercol", symbols: ["altercol$ebnf$1", "kw_type", "data_type"], postprocess: (x) => (0, lexer_2.track)(x, { type: "set type", dataType: unwrap2(last(x)) }) },
          { name: "altercol", symbols: ["kw_set", lexer_1.lexerAny.has("kw_default") ? { type: "kw_default" } : kw_default, "expr"], postprocess: (x) => (0, lexer_2.track)(x, { type: "set default", default: unwrap2(last(x)) }) },
          { name: "altercol", symbols: ["kw_drop", lexer_1.lexerAny.has("kw_default") ? { type: "kw_default" } : kw_default], postprocess: (x) => (0, lexer_2.track)(x, { type: "drop default" }) },
          { name: "altercol$subexpression$1", symbols: ["kw_set"] },
          { name: "altercol$subexpression$1", symbols: ["kw_drop"] },
          { name: "altercol", symbols: ["altercol$subexpression$1", "kw_not_null"], postprocess: (x) => (0, lexer_2.track)(x, { type: toStr(x, " ") }) },
          { name: "altercol", symbols: ["altercol_generated_add"], postprocess: unwrap2 },
          { name: "altertable_add_constraint", symbols: ["kw_add", "createtable_constraint"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "add constraint",
            constraint: unwrap2(last(x))
          }) },
          { name: "altertable_drop_constraint$ebnf$1", symbols: ["kw_ifexists"], postprocess: id },
          { name: "altertable_drop_constraint$ebnf$1", symbols: [], postprocess: () => null },
          { name: "altertable_drop_constraint$ebnf$2$subexpression$1", symbols: ["kw_restrict"] },
          { name: "altertable_drop_constraint$ebnf$2$subexpression$1", symbols: ["kw_cascade"] },
          { name: "altertable_drop_constraint$ebnf$2", symbols: ["altertable_drop_constraint$ebnf$2$subexpression$1"], postprocess: id },
          { name: "altertable_drop_constraint$ebnf$2", symbols: [], postprocess: () => null },
          { name: "altertable_drop_constraint", symbols: ["kw_drop", lexer_1.lexerAny.has("kw_constraint") ? { type: "kw_constraint" } : kw_constraint, "altertable_drop_constraint$ebnf$1", "ident", "altertable_drop_constraint$ebnf$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "drop constraint",
            ...x[2] ? { ifExists: true } : {},
            constraint: asName(x[3]),
            ...x[4] ? { behaviour: toStr(x[4], " ") } : {}
          }) },
          { name: "altertable_owner", symbols: ["kw_owner", lexer_1.lexerAny.has("kw_to") ? { type: "kw_to" } : kw_to, "ident"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "owner",
            to: asName(last(x))
          }) },
          { name: "altercol_generated_add", symbols: ["kw_add", "altercol_generated"], postprocess: last },
          { name: "altercol_generated$ebnf$1$subexpression$1", symbols: ["kw_always"] },
          { name: "altercol_generated$ebnf$1$subexpression$1", symbols: ["kw_by", lexer_1.lexerAny.has("kw_default") ? { type: "kw_default" } : kw_default] },
          { name: "altercol_generated$ebnf$1", symbols: ["altercol_generated$ebnf$1$subexpression$1"], postprocess: id },
          { name: "altercol_generated$ebnf$1", symbols: [], postprocess: () => null },
          { name: "altercol_generated$ebnf$2$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as, "kw_identity"] },
          { name: "altercol_generated$ebnf$2", symbols: ["altercol_generated$ebnf$2$subexpression$1"], postprocess: id },
          { name: "altercol_generated$ebnf$2", symbols: [], postprocess: () => null },
          { name: "altercol_generated$ebnf$3$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as, "lparen", "expr", "rparen"], postprocess: get(2) },
          { name: "altercol_generated$ebnf$3", symbols: ["altercol_generated$ebnf$3$subexpression$1"], postprocess: id },
          { name: "altercol_generated$ebnf$3", symbols: [], postprocess: () => null },
          { name: "altercol_generated$ebnf$4$subexpression$1", symbols: ["lparen", "altercol_generated_seq", "rparen"], postprocess: get(1) },
          { name: "altercol_generated$ebnf$4", symbols: ["altercol_generated$ebnf$4$subexpression$1"], postprocess: id },
          { name: "altercol_generated$ebnf$4", symbols: [], postprocess: () => null },
          { name: "altercol_generated$ebnf$5$subexpression$1", symbols: ["kw_stored"] },
          { name: "altercol_generated$ebnf$5", symbols: ["altercol_generated$ebnf$5$subexpression$1"], postprocess: id },
          { name: "altercol_generated$ebnf$5", symbols: [], postprocess: () => null },
          { name: "altercol_generated", symbols: ["kw_generated", "altercol_generated$ebnf$1", "altercol_generated$ebnf$2", "altercol_generated$ebnf$3", "altercol_generated$ebnf$4", "altercol_generated$ebnf$5"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "add generated",
            ...x[1] && { always: toStr(x[1], " ") },
            ...x[3] && { expression: unwrap2(x[3]) },
            ...x[4] && { sequence: unwrap2(x[4]) },
            ...x[5] && { stored: true }
          }) },
          { name: "altercol_generated_seq$ebnf$1$subexpression$1", symbols: ["kw_sequence", "kw_name", "qualified_name"] },
          { name: "altercol_generated_seq$ebnf$1", symbols: ["altercol_generated_seq$ebnf$1$subexpression$1"], postprocess: id },
          { name: "altercol_generated_seq$ebnf$1", symbols: [], postprocess: () => null },
          { name: "altercol_generated_seq$ebnf$2", symbols: [] },
          { name: "altercol_generated_seq$ebnf$2", symbols: ["altercol_generated_seq$ebnf$2", "create_sequence_option"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "altercol_generated_seq", symbols: ["altercol_generated_seq$ebnf$1", "altercol_generated_seq$ebnf$2"], postprocess: (x) => {
            const ret = {
              ...x[0] && { name: unwrap2(last(x[0])) }
            };
            setSeqOpts(ret, x[1]);
            return (0, lexer_2.track)(x, ret);
          } },
          { name: "alterindex_statement$ebnf$1", symbols: ["kw_ifexists"], postprocess: id },
          { name: "alterindex_statement$ebnf$1", symbols: [], postprocess: () => null },
          { name: "alterindex_statement", symbols: ["kw_alter", "kw_index", "alterindex_statement$ebnf$1", "table_ref", "alterindex_action"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "alter index",
            ...x[2] ? { ifExists: true } : {},
            index: unwrap2(x[3]),
            change: unwrap2(x[4])
          }) },
          { name: "alterindex_action", symbols: ["alterindex_rename"] },
          { name: "alterindex_action", symbols: ["alterindex_set_tablespace"] },
          { name: "alterindex_rename", symbols: ["kw_rename", lexer_1.lexerAny.has("kw_to") ? { type: "kw_to" } : kw_to, "word"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "rename",
            to: asName(last(x))
          }) },
          { name: "alterindex_set_tablespace", symbols: ["kw_set", "kw_tablespace", "word"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "set tablespace",
            tablespace: asName(last(x))
          }) },
          { name: "delete_statement", symbols: ["delete_delete"] },
          { name: "delete_statement", symbols: ["delete_truncate"] },
          { name: "delete_delete$subexpression$1", symbols: ["kw_delete", lexer_1.lexerAny.has("kw_from") ? { type: "kw_from" } : kw_from] },
          { name: "delete_delete$ebnf$1", symbols: ["select_where"], postprocess: id },
          { name: "delete_delete$ebnf$1", symbols: [], postprocess: () => null },
          { name: "delete_delete$ebnf$2$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_returning") ? { type: "kw_returning" } : kw_returning, "select_expr_list_aliased"], postprocess: last },
          { name: "delete_delete$ebnf$2", symbols: ["delete_delete$ebnf$2$subexpression$1"], postprocess: id },
          { name: "delete_delete$ebnf$2", symbols: [], postprocess: () => null },
          { name: "delete_delete", symbols: ["delete_delete$subexpression$1", "table_ref_aliased", "delete_delete$ebnf$1", "delete_delete$ebnf$2"], postprocess: (x) => {
            const where = x[2];
            const returning = x[3];
            return (0, lexer_2.track)(x, {
              type: "delete",
              from: unwrap2(x[1]),
              ...where ? { where } : {},
              ...returning ? { returning } : {}
            });
          } },
          { name: "delete_truncate$subexpression$1$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_table") ? { type: "kw_table" } : kw_table], postprocess: id },
          { name: "delete_truncate$subexpression$1$ebnf$1", symbols: [], postprocess: () => null },
          { name: "delete_truncate$subexpression$1", symbols: ["kw_truncate", "delete_truncate$subexpression$1$ebnf$1"] },
          { name: "delete_truncate$macrocall$2", symbols: ["table_ref"] },
          { name: "delete_truncate$macrocall$1$ebnf$1", symbols: [] },
          { name: "delete_truncate$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "delete_truncate$macrocall$2"], postprocess: last },
          { name: "delete_truncate$macrocall$1$ebnf$1", symbols: ["delete_truncate$macrocall$1$ebnf$1", "delete_truncate$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "delete_truncate$macrocall$1", symbols: ["delete_truncate$macrocall$2", "delete_truncate$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "delete_truncate$ebnf$1$subexpression$1$subexpression$1", symbols: ["kw_restart"] },
          { name: "delete_truncate$ebnf$1$subexpression$1$subexpression$1", symbols: ["kw_continue"] },
          { name: "delete_truncate$ebnf$1$subexpression$1", symbols: ["delete_truncate$ebnf$1$subexpression$1$subexpression$1", "kw_identity"] },
          { name: "delete_truncate$ebnf$1", symbols: ["delete_truncate$ebnf$1$subexpression$1"], postprocess: id },
          { name: "delete_truncate$ebnf$1", symbols: [], postprocess: () => null },
          { name: "delete_truncate$ebnf$2$subexpression$1", symbols: ["kw_restrict"] },
          { name: "delete_truncate$ebnf$2$subexpression$1", symbols: ["kw_cascade"] },
          { name: "delete_truncate$ebnf$2", symbols: ["delete_truncate$ebnf$2$subexpression$1"], postprocess: id },
          { name: "delete_truncate$ebnf$2", symbols: [], postprocess: () => null },
          { name: "delete_truncate", symbols: ["delete_truncate$subexpression$1", "delete_truncate$macrocall$1", "delete_truncate$ebnf$1", "delete_truncate$ebnf$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "truncate table",
            tables: x[1],
            ...x[2] && { identity: toStr(x[2][0]) },
            ...x[3] && { cascade: toStr(x[3]) }
          }) },
          { name: "create_sequence_statement$ebnf$1$subexpression$1", symbols: ["kw_temp"] },
          { name: "create_sequence_statement$ebnf$1$subexpression$1", symbols: ["kw_temporary"] },
          { name: "create_sequence_statement$ebnf$1", symbols: ["create_sequence_statement$ebnf$1$subexpression$1"], postprocess: id },
          { name: "create_sequence_statement$ebnf$1", symbols: [], postprocess: () => null },
          { name: "create_sequence_statement$ebnf$2", symbols: ["kw_ifnotexists"], postprocess: id },
          { name: "create_sequence_statement$ebnf$2", symbols: [], postprocess: () => null },
          { name: "create_sequence_statement$ebnf$3", symbols: [] },
          { name: "create_sequence_statement$ebnf$3", symbols: ["create_sequence_statement$ebnf$3", "create_sequence_option"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "create_sequence_statement", symbols: [lexer_1.lexerAny.has("kw_create") ? { type: "kw_create" } : kw_create, "create_sequence_statement$ebnf$1", "kw_sequence", "create_sequence_statement$ebnf$2", "qualified_name", "create_sequence_statement$ebnf$3"], postprocess: (x) => {
            const ret = {
              type: "create sequence",
              ...x[1] && { temp: true },
              ...x[3] && { ifNotExists: true },
              name: unwrap2(x[4]),
              options: {}
            };
            setSeqOpts(ret.options, x[5]);
            return (0, lexer_2.track)(x, ret);
          } },
          { name: "create_sequence_option", symbols: [lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as, "data_type"], postprocess: (x) => (0, lexer_2.box)(x, ["as", x[1]]) },
          { name: "create_sequence_option$ebnf$1", symbols: ["kw_by"], postprocess: id },
          { name: "create_sequence_option$ebnf$1", symbols: [], postprocess: () => null },
          { name: "create_sequence_option", symbols: ["kw_increment", "create_sequence_option$ebnf$1", "int"], postprocess: (x) => (0, lexer_2.box)(x, ["incrementBy", x[2]]) },
          { name: "create_sequence_option", symbols: ["create_sequence_minvalue"], postprocess: (x) => (0, lexer_2.box)(x, ["minValue", x[0]]) },
          { name: "create_sequence_option", symbols: ["create_sequence_maxvalue"], postprocess: (x) => (0, lexer_2.box)(x, ["maxValue", x[0]]) },
          { name: "create_sequence_option$ebnf$2", symbols: [lexer_1.lexerAny.has("kw_with") ? { type: "kw_with" } : kw_with], postprocess: id },
          { name: "create_sequence_option$ebnf$2", symbols: [], postprocess: () => null },
          { name: "create_sequence_option", symbols: ["kw_start", "create_sequence_option$ebnf$2", "int"], postprocess: (x) => (0, lexer_2.box)(x, ["startWith", x[2]]) },
          { name: "create_sequence_option", symbols: ["kw_cache", "int"], postprocess: (x) => (0, lexer_2.box)(x, ["cache", x[1]]) },
          { name: "create_sequence_option$ebnf$3", symbols: ["kw_no"], postprocess: id },
          { name: "create_sequence_option$ebnf$3", symbols: [], postprocess: () => null },
          { name: "create_sequence_option", symbols: ["create_sequence_option$ebnf$3", "kw_cycle"], postprocess: (x) => (0, lexer_2.box)(x, ["cycle", toStr(x, " ")]) },
          { name: "create_sequence_option", symbols: ["create_sequence_owned_by"], postprocess: (x) => (0, lexer_2.box)(x, ["ownedBy", unwrap2(x)]) },
          { name: "create_sequence_minvalue", symbols: ["kw_minvalue", "int"], postprocess: last },
          { name: "create_sequence_minvalue", symbols: ["kw_no", "kw_minvalue"], postprocess: (x) => (0, lexer_2.box)(x, "no minvalue") },
          { name: "create_sequence_maxvalue", symbols: ["kw_maxvalue", "int"], postprocess: last },
          { name: "create_sequence_maxvalue", symbols: ["kw_no", "kw_maxvalue"], postprocess: (x) => (0, lexer_2.box)(x, "no maxvalue") },
          { name: "create_sequence_owned_by$subexpression$1", symbols: ["kw_none"] },
          { name: "create_sequence_owned_by$subexpression$1", symbols: ["qcolumn"] },
          { name: "create_sequence_owned_by", symbols: ["kw_owned", "kw_by", "create_sequence_owned_by$subexpression$1"], postprocess: (x) => (0, lexer_2.box)(x, unwrap2(last(x))) },
          { name: "alter_sequence_statement$ebnf$1", symbols: ["kw_ifexists"], postprocess: id },
          { name: "alter_sequence_statement$ebnf$1", symbols: [], postprocess: () => null },
          { name: "alter_sequence_statement", symbols: ["kw_alter", "kw_sequence", "alter_sequence_statement$ebnf$1", "qualified_name", "alter_sequence_statement_body"], postprocess: (x) => {
            const ret = {
              type: "alter sequence",
              ...x[2] && { ifExists: true },
              name: unwrap2(x[3]),
              change: x[4]
            };
            return (0, lexer_2.track)(x, ret);
          } },
          { name: "alter_sequence_statement_body$ebnf$1", symbols: ["alter_sequence_option"] },
          { name: "alter_sequence_statement_body$ebnf$1", symbols: ["alter_sequence_statement_body$ebnf$1", "alter_sequence_option"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "alter_sequence_statement_body", symbols: ["alter_sequence_statement_body$ebnf$1"], postprocess: (x) => {
            const ret = {
              type: "set options"
            };
            setSeqOpts(ret, x[0]);
            return (0, lexer_2.track)(x, ret);
          } },
          { name: "alter_sequence_statement_body$subexpression$1", symbols: ["ident"] },
          { name: "alter_sequence_statement_body$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_session_user") ? { type: "kw_session_user" } : kw_session_user] },
          { name: "alter_sequence_statement_body$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_current_user") ? { type: "kw_current_user" } : kw_current_user] },
          { name: "alter_sequence_statement_body", symbols: ["kw_owner", lexer_1.lexerAny.has("kw_to") ? { type: "kw_to" } : kw_to, "alter_sequence_statement_body$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, { type: "owner to", owner: asName(last(x)) }) },
          { name: "alter_sequence_statement_body", symbols: ["kw_rename", lexer_1.lexerAny.has("kw_to") ? { type: "kw_to" } : kw_to, "ident"], postprocess: (x) => (0, lexer_2.track)(x, { type: "rename", newName: asName(last(x)) }) },
          { name: "alter_sequence_statement_body", symbols: ["kw_set", "kw_schema", "ident"], postprocess: (x) => (0, lexer_2.track)(x, { type: "set schema", newSchema: asName(last(x)) }) },
          { name: "alter_sequence_option", symbols: ["create_sequence_option"], postprocess: unwrap2 },
          { name: "alter_sequence_option$ebnf$1$subexpression$1$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_with") ? { type: "kw_with" } : kw_with], postprocess: id },
          { name: "alter_sequence_option$ebnf$1$subexpression$1$ebnf$1", symbols: [], postprocess: () => null },
          { name: "alter_sequence_option$ebnf$1$subexpression$1", symbols: ["alter_sequence_option$ebnf$1$subexpression$1$ebnf$1", "int"], postprocess: last },
          { name: "alter_sequence_option$ebnf$1", symbols: ["alter_sequence_option$ebnf$1$subexpression$1"], postprocess: id },
          { name: "alter_sequence_option$ebnf$1", symbols: [], postprocess: () => null },
          { name: "alter_sequence_option", symbols: ["kw_restart", "alter_sequence_option$ebnf$1"], postprocess: (x) => (0, lexer_2.box)(x, ["restart", typeof (0, lexer_2.unbox)(x[1]) === "number" ? (0, lexer_2.unbox)(x[1]) : true]) },
          { name: "drop_statement$ebnf$1", symbols: ["kw_ifexists"], postprocess: id },
          { name: "drop_statement$ebnf$1", symbols: [], postprocess: () => null },
          { name: "drop_statement$macrocall$2", symbols: ["qualified_name"] },
          { name: "drop_statement$macrocall$1$ebnf$1", symbols: [] },
          { name: "drop_statement$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "drop_statement$macrocall$2"], postprocess: last },
          { name: "drop_statement$macrocall$1$ebnf$1", symbols: ["drop_statement$macrocall$1$ebnf$1", "drop_statement$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "drop_statement$macrocall$1", symbols: ["drop_statement$macrocall$2", "drop_statement$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "drop_statement$ebnf$2$subexpression$1", symbols: ["kw_cascade"] },
          { name: "drop_statement$ebnf$2$subexpression$1", symbols: ["kw_restrict"] },
          { name: "drop_statement$ebnf$2", symbols: ["drop_statement$ebnf$2$subexpression$1"], postprocess: id },
          { name: "drop_statement$ebnf$2", symbols: [], postprocess: () => null },
          { name: "drop_statement", symbols: ["kw_drop", "drop_what", "drop_statement$ebnf$1", "drop_statement$macrocall$1", "drop_statement$ebnf$2"], postprocess: (x, rej) => {
            const v = unwrap2(x[1]);
            return (0, lexer_2.track)(x, {
              ...v,
              ...x[2] && { ifExists: true },
              names: x[3],
              ...x[4] && { cascade: toStr(x[4]) }
            });
          } },
          { name: "drop_what", symbols: [lexer_1.lexerAny.has("kw_table") ? { type: "kw_table" } : kw_table], postprocess: (x) => (0, lexer_2.track)(x, { type: "drop table" }) },
          { name: "drop_what", symbols: ["kw_sequence"], postprocess: (x) => (0, lexer_2.track)(x, { type: "drop sequence" }) },
          { name: "drop_what", symbols: ["kw_type"], postprocess: (x) => (0, lexer_2.track)(x, { type: "drop type" }) },
          { name: "drop_what", symbols: ["kw_trigger"], postprocess: (x) => (0, lexer_2.track)(x, { type: "drop trigger" }) },
          { name: "drop_what$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_concurrently") ? { type: "kw_concurrently" } : kw_concurrently], postprocess: id },
          { name: "drop_what$ebnf$1", symbols: [], postprocess: () => null },
          { name: "drop_what", symbols: ["kw_index", "drop_what$ebnf$1"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "drop index",
            ...x[1] && { concurrently: true }
          }) },
          { name: "with_statement", symbols: [lexer_1.lexerAny.has("kw_with") ? { type: "kw_with" } : kw_with, "with_statement_bindings", "with_statement_statement"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "with",
            bind: x[1],
            in: unwrap2(x[2])
          }) },
          { name: "with_recursive_statement$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_with") ? { type: "kw_with" } : kw_with, "kw_recursive"] },
          { name: "with_recursive_statement", symbols: ["with_recursive_statement$subexpression$1", "ident", "collist_paren", lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as, "lparen", "union_statement", "rparen", "with_statement_statement"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "with recursive",
            alias: asName(x[1]),
            columnNames: x[2].map(asName),
            bind: x[5],
            in: unwrap2(x[7])
          }) },
          { name: "with_statement_bindings$ebnf$1", symbols: [] },
          { name: "with_statement_bindings$ebnf$1$subexpression$1", symbols: ["comma", "with_statement_binding"], postprocess: last },
          { name: "with_statement_bindings$ebnf$1", symbols: ["with_statement_bindings$ebnf$1", "with_statement_bindings$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "with_statement_bindings", symbols: ["with_statement_binding", "with_statement_bindings$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "with_statement_binding", symbols: ["word", lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as, "lparen", "with_statement_statement", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            alias: asName(x[0]),
            statement: unwrap2(x[3])
          }) },
          { name: "with_statement_statement", symbols: ["selection"] },
          { name: "with_statement_statement", symbols: ["insert_statement"] },
          { name: "with_statement_statement", symbols: ["update_statement"] },
          { name: "with_statement_statement", symbols: ["delete_statement"] },
          { name: "createtype_statement$subexpression$1", symbols: ["createtype_enum"] },
          { name: "createtype_statement$subexpression$1", symbols: ["createtype_composite"] },
          { name: "createtype_statement", symbols: [lexer_1.lexerAny.has("kw_create") ? { type: "kw_create" } : kw_create, "kw_type", "qualified_name", "createtype_statement$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, {
            name: x[2],
            ...unwrap2(x[3])
          }) },
          { name: "createtype_enum$macrocall$2", symbols: ["enum_value"] },
          { name: "createtype_enum$macrocall$1$ebnf$1", symbols: [] },
          { name: "createtype_enum$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "createtype_enum$macrocall$2"], postprocess: last },
          { name: "createtype_enum$macrocall$1$ebnf$1", symbols: ["createtype_enum$macrocall$1$ebnf$1", "createtype_enum$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "createtype_enum$macrocall$1", symbols: ["createtype_enum$macrocall$2", "createtype_enum$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "createtype_enum", symbols: [lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as, "kw_enum", "lparen", "createtype_enum$macrocall$1", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "create enum",
            values: x[3]
          }) },
          { name: "enum_value", symbols: ["string"], postprocess: (x) => (0, lexer_2.track)(x, { value: toStr(x) }) },
          { name: "createtype_composite$macrocall$2", symbols: ["createtype_composite_attr"] },
          { name: "createtype_composite$macrocall$1$ebnf$1", symbols: [] },
          { name: "createtype_composite$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "createtype_composite$macrocall$2"], postprocess: last },
          { name: "createtype_composite$macrocall$1$ebnf$1", symbols: ["createtype_composite$macrocall$1$ebnf$1", "createtype_composite$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "createtype_composite$macrocall$1", symbols: ["createtype_composite$macrocall$2", "createtype_composite$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "createtype_composite", symbols: [lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as, "lparen", "createtype_composite$macrocall$1", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "create composite type",
            attributes: x[2]
          }) },
          { name: "createtype_composite_attr$ebnf$1", symbols: ["createtable_collate"], postprocess: id },
          { name: "createtype_composite_attr$ebnf$1", symbols: [], postprocess: () => null },
          { name: "createtype_composite_attr", symbols: ["word", "data_type", "createtype_composite_attr$ebnf$1"], postprocess: (x) => {
            return (0, lexer_2.track)(x, {
              name: asName(x[0]),
              dataType: x[1],
              ...x[2] ? { collate: x[2][1] } : {}
            });
          } },
          { name: "altertype_statement$subexpression$1", symbols: ["altertype_enum_add_value"] },
          { name: "altertype_statement$subexpression$1", symbols: ["altertype_enum_rename"] },
          { name: "altertype_statement", symbols: ["kw_alter", "kw_type", "qualified_name", "altertype_statement$subexpression$1"], postprocess: (x) => (0, lexer_2.track)(x, {
            name: x[2],
            ...unwrap2(x[3])
          }) },
          { name: "altertype_enum_add_value", symbols: ["kw_add", "kw_value", "enum_additional_value"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "alter enum",
            change: {
              type: "add value",
              add: x[2]
            }
          }) },
          { name: "enum_additional_value", symbols: ["string"], postprocess: (x) => (0, lexer_2.track)(x, { value: toStr(x) }) },
          { name: "altertype_enum_rename", symbols: ["kw_rename", lexer_1.lexerAny.has("kw_to") ? { type: "kw_to" } : kw_to, "word"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "alter enum",
            change: {
              type: "rename",
              to: asName(last(x))
            }
          }) },
          { name: "union_left", symbols: ["select_statement"] },
          { name: "union_left", symbols: ["select_values"] },
          { name: "union_left", symbols: ["selection_paren"] },
          { name: "union_right", symbols: ["selection"] },
          { name: "union_right", symbols: ["selection_paren"] },
          { name: "union_statement$subexpression$1$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_all") ? { type: "kw_all" } : kw_all], postprocess: id },
          { name: "union_statement$subexpression$1$ebnf$1", symbols: [], postprocess: () => null },
          { name: "union_statement$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_union") ? { type: "kw_union" } : kw_union, "union_statement$subexpression$1$ebnf$1"] },
          { name: "union_statement", symbols: ["union_left", "union_statement$subexpression$1", "union_right"], postprocess: (x) => {
            return (0, lexer_2.track)(x, {
              type: toStr(x[1], " "),
              left: unwrap2(x[0]),
              right: unwrap2(x[2])
            });
          } },
          { name: "prepare$ebnf$1$subexpression$1", symbols: ["lparen", "data_type_list", "rparen"], postprocess: get(1) },
          { name: "prepare$ebnf$1", symbols: ["prepare$ebnf$1$subexpression$1"], postprocess: id },
          { name: "prepare$ebnf$1", symbols: [], postprocess: () => null },
          { name: "prepare", symbols: ["kw_prepare", "ident", "prepare$ebnf$1", lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as, "statement_noprep"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "prepare",
            name: asName(x[1]),
            ...x[2] && { args: x[2] },
            statement: unwrap2(last(x))
          }) },
          { name: "deallocate$ebnf$1", symbols: ["kw_prepare"], postprocess: id },
          { name: "deallocate$ebnf$1", symbols: [], postprocess: () => null },
          { name: "deallocate", symbols: ["kw_deallocate", "deallocate$ebnf$1", "deallocate_target"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "deallocate",
            target: x[2]
          }) },
          { name: "deallocate_target", symbols: ["deallocate_all"], postprocess: unwrap2 },
          { name: "deallocate_target", symbols: ["deallocate_name"], postprocess: unwrap2 },
          { name: "deallocate_name", symbols: ["ident"], postprocess: (x) => (0, lexer_2.track)(x, asName(x[0])) },
          { name: "deallocate_all", symbols: [lexer_1.lexerAny.has("kw_all") ? { type: "kw_all" } : kw_all], postprocess: (x) => (0, lexer_2.track)(x, { option: "all" }) },
          { name: "create_view_statements", symbols: ["create_view"] },
          { name: "create_view_statements", symbols: ["create_materialized_view"] },
          { name: "create_view$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_or") ? { type: "kw_or" } : kw_or, "kw_replace"] },
          { name: "create_view$ebnf$1", symbols: ["create_view$ebnf$1$subexpression$1"], postprocess: id },
          { name: "create_view$ebnf$1", symbols: [], postprocess: () => null },
          { name: "create_view$ebnf$2$subexpression$1", symbols: ["kw_temp"] },
          { name: "create_view$ebnf$2$subexpression$1", symbols: ["kw_temporary"] },
          { name: "create_view$ebnf$2", symbols: ["create_view$ebnf$2$subexpression$1"], postprocess: id },
          { name: "create_view$ebnf$2", symbols: [], postprocess: () => null },
          { name: "create_view$ebnf$3", symbols: ["kw_recursive"], postprocess: id },
          { name: "create_view$ebnf$3", symbols: [], postprocess: () => null },
          { name: "create_view$ebnf$4$subexpression$1$macrocall$2", symbols: ["ident"] },
          { name: "create_view$ebnf$4$subexpression$1$macrocall$1$ebnf$1", symbols: [] },
          { name: "create_view$ebnf$4$subexpression$1$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "create_view$ebnf$4$subexpression$1$macrocall$2"], postprocess: last },
          { name: "create_view$ebnf$4$subexpression$1$macrocall$1$ebnf$1", symbols: ["create_view$ebnf$4$subexpression$1$macrocall$1$ebnf$1", "create_view$ebnf$4$subexpression$1$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "create_view$ebnf$4$subexpression$1$macrocall$1", symbols: ["create_view$ebnf$4$subexpression$1$macrocall$2", "create_view$ebnf$4$subexpression$1$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "create_view$ebnf$4$subexpression$1", symbols: ["lparen", "create_view$ebnf$4$subexpression$1$macrocall$1", "rparen"], postprocess: get(1) },
          { name: "create_view$ebnf$4", symbols: ["create_view$ebnf$4$subexpression$1"], postprocess: id },
          { name: "create_view$ebnf$4", symbols: [], postprocess: () => null },
          { name: "create_view$ebnf$5", symbols: ["create_view_opts"], postprocess: id },
          { name: "create_view$ebnf$5", symbols: [], postprocess: () => null },
          { name: "create_view$ebnf$6$subexpression$1$subexpression$1", symbols: ["kw_local"] },
          { name: "create_view$ebnf$6$subexpression$1$subexpression$1", symbols: ["kw_cascaded"] },
          { name: "create_view$ebnf$6$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_with") ? { type: "kw_with" } : kw_with, "create_view$ebnf$6$subexpression$1$subexpression$1", lexer_1.lexerAny.has("kw_check") ? { type: "kw_check" } : kw_check, "kw_option"], postprocess: get(1) },
          { name: "create_view$ebnf$6", symbols: ["create_view$ebnf$6$subexpression$1"], postprocess: id },
          { name: "create_view$ebnf$6", symbols: [], postprocess: () => null },
          { name: "create_view", symbols: [lexer_1.lexerAny.has("kw_create") ? { type: "kw_create" } : kw_create, "create_view$ebnf$1", "create_view$ebnf$2", "create_view$ebnf$3", "kw_view", "qualified_name", "create_view$ebnf$4", "create_view$ebnf$5", lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as, "selection", "create_view$ebnf$6"], postprocess: (x) => {
            return (0, lexer_2.track)(x, {
              type: "create view",
              ...x[1] && { orReplace: true },
              ...x[2] && { temp: true },
              ...x[3] && { recursive: true },
              name: x[5],
              ...x[6] && { columnNames: x[6].map(asName) },
              ...x[7] && { parameters: fromEntries(x[7]) },
              query: x[9],
              ...x[10] && { checkOption: toStr(x[10]) }
            });
          } },
          { name: "create_view_opt", symbols: ["ident", lexer_1.lexerAny.has("op_eq") ? { type: "op_eq" } : op_eq, "ident"], postprocess: ([a, _, b]) => [toStr(a), toStr(b)] },
          { name: "create_view_opts$macrocall$2", symbols: ["create_view_opt"] },
          { name: "create_view_opts$macrocall$1$ebnf$1", symbols: [] },
          { name: "create_view_opts$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "create_view_opts$macrocall$2"], postprocess: last },
          { name: "create_view_opts$macrocall$1$ebnf$1", symbols: ["create_view_opts$macrocall$1$ebnf$1", "create_view_opts$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "create_view_opts$macrocall$1", symbols: ["create_view_opts$macrocall$2", "create_view_opts$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "create_view_opts", symbols: [lexer_1.lexerAny.has("kw_with") ? { type: "kw_with" } : kw_with, "create_view_opts$macrocall$1"], postprocess: last },
          { name: "create_materialized_view$ebnf$1", symbols: ["kw_ifnotexists"], postprocess: id },
          { name: "create_materialized_view$ebnf$1", symbols: [], postprocess: () => null },
          { name: "create_materialized_view$ebnf$2$subexpression$1$macrocall$2", symbols: ["ident"] },
          { name: "create_materialized_view$ebnf$2$subexpression$1$macrocall$1$ebnf$1", symbols: [] },
          { name: "create_materialized_view$ebnf$2$subexpression$1$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "create_materialized_view$ebnf$2$subexpression$1$macrocall$2"], postprocess: last },
          { name: "create_materialized_view$ebnf$2$subexpression$1$macrocall$1$ebnf$1", symbols: ["create_materialized_view$ebnf$2$subexpression$1$macrocall$1$ebnf$1", "create_materialized_view$ebnf$2$subexpression$1$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "create_materialized_view$ebnf$2$subexpression$1$macrocall$1", symbols: ["create_materialized_view$ebnf$2$subexpression$1$macrocall$2", "create_materialized_view$ebnf$2$subexpression$1$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "create_materialized_view$ebnf$2$subexpression$1", symbols: ["lparen", "create_materialized_view$ebnf$2$subexpression$1$macrocall$1", "rparen"], postprocess: get(1) },
          { name: "create_materialized_view$ebnf$2", symbols: ["create_materialized_view$ebnf$2$subexpression$1"], postprocess: id },
          { name: "create_materialized_view$ebnf$2", symbols: [], postprocess: () => null },
          { name: "create_materialized_view$ebnf$3", symbols: ["create_view_opts"], postprocess: id },
          { name: "create_materialized_view$ebnf$3", symbols: [], postprocess: () => null },
          { name: "create_materialized_view$ebnf$4$subexpression$1", symbols: ["kw_tablespace", "ident"], postprocess: last },
          { name: "create_materialized_view$ebnf$4", symbols: ["create_materialized_view$ebnf$4$subexpression$1"], postprocess: id },
          { name: "create_materialized_view$ebnf$4", symbols: [], postprocess: () => null },
          { name: "create_materialized_view$ebnf$5$subexpression$1$ebnf$1", symbols: ["kw_no"], postprocess: id },
          { name: "create_materialized_view$ebnf$5$subexpression$1$ebnf$1", symbols: [], postprocess: () => null },
          { name: "create_materialized_view$ebnf$5$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_with") ? { type: "kw_with" } : kw_with, "create_materialized_view$ebnf$5$subexpression$1$ebnf$1", "kw_data"] },
          { name: "create_materialized_view$ebnf$5", symbols: ["create_materialized_view$ebnf$5$subexpression$1"], postprocess: id },
          { name: "create_materialized_view$ebnf$5", symbols: [], postprocess: () => null },
          { name: "create_materialized_view", symbols: [lexer_1.lexerAny.has("kw_create") ? { type: "kw_create" } : kw_create, "kw_materialized", "kw_view", "create_materialized_view$ebnf$1", "qualified_name", "create_materialized_view$ebnf$2", "create_materialized_view$ebnf$3", "create_materialized_view$ebnf$4", lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as, "selection", "create_materialized_view$ebnf$5"], postprocess: (x) => {
            return (0, lexer_2.track)(x, {
              type: "create materialized view",
              ...x[3] && { ifNotExists: true },
              name: x[4],
              ...x[5] && { columnNames: x[6].map(asName) },
              ...x[6] && { parameters: fromEntries(x[6]) },
              ...x[7] && { tablespace: asName(x[7]) },
              query: x[9],
              ...x[10] && { withData: toStr(x[10][1]) !== "no" }
            });
          } },
          { name: "refresh_view_statements$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_concurrently") ? { type: "kw_concurrently" } : kw_concurrently], postprocess: id },
          { name: "refresh_view_statements$ebnf$1", symbols: [], postprocess: () => null },
          { name: "refresh_view_statements$ebnf$2$subexpression$1$ebnf$1", symbols: ["kw_no"], postprocess: id },
          { name: "refresh_view_statements$ebnf$2$subexpression$1$ebnf$1", symbols: [], postprocess: () => null },
          { name: "refresh_view_statements$ebnf$2$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_with") ? { type: "kw_with" } : kw_with, "refresh_view_statements$ebnf$2$subexpression$1$ebnf$1", "kw_data"] },
          { name: "refresh_view_statements$ebnf$2", symbols: ["refresh_view_statements$ebnf$2$subexpression$1"], postprocess: id },
          { name: "refresh_view_statements$ebnf$2", symbols: [], postprocess: () => null },
          { name: "refresh_view_statements", symbols: ["kw_refresh", "kw_materialized", "kw_view", "refresh_view_statements$ebnf$1", "qname", "refresh_view_statements$ebnf$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "refresh materialized view",
            ...x[3] ? { concurrently: true } : {},
            name: x[4],
            ...x[5] ? { withData: toStr(x[5][1]) !== "no" } : {}
          }) },
          { name: "functions_statements", symbols: ["create_func"] },
          { name: "functions_statements", symbols: ["do_stm"] },
          { name: "functions_statements", symbols: ["drop_func"] },
          { name: "create_func$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("kw_or") ? { type: "kw_or" } : kw_or, "kw_replace"] },
          { name: "create_func$ebnf$1", symbols: ["create_func$ebnf$1$subexpression$1"], postprocess: id },
          { name: "create_func$ebnf$1", symbols: [], postprocess: () => null },
          { name: "create_func$subexpression$1$ebnf$1$macrocall$2", symbols: ["func_argdef"] },
          { name: "create_func$subexpression$1$ebnf$1$macrocall$1$ebnf$1", symbols: [] },
          { name: "create_func$subexpression$1$ebnf$1$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "create_func$subexpression$1$ebnf$1$macrocall$2"], postprocess: last },
          { name: "create_func$subexpression$1$ebnf$1$macrocall$1$ebnf$1", symbols: ["create_func$subexpression$1$ebnf$1$macrocall$1$ebnf$1", "create_func$subexpression$1$ebnf$1$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "create_func$subexpression$1$ebnf$1$macrocall$1", symbols: ["create_func$subexpression$1$ebnf$1$macrocall$2", "create_func$subexpression$1$ebnf$1$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "create_func$subexpression$1$ebnf$1", symbols: ["create_func$subexpression$1$ebnf$1$macrocall$1"], postprocess: id },
          { name: "create_func$subexpression$1$ebnf$1", symbols: [], postprocess: () => null },
          { name: "create_func$subexpression$1", symbols: ["lparen", "create_func$subexpression$1$ebnf$1", "rparen"], postprocess: get(1) },
          { name: "create_func$ebnf$2", symbols: ["func_spec"] },
          { name: "create_func$ebnf$2", symbols: ["create_func$ebnf$2", "func_spec"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "create_func", symbols: [lexer_1.lexerAny.has("kw_create") ? { type: "kw_create" } : kw_create, "create_func$ebnf$1", "kw_function", "qname", "create_func$subexpression$1", "create_func$ebnf$2"], postprocess: (x, rej) => {
            var _a;
            const specs = {};
            for (const s of x[5]) {
              for (const k in s) {
                if (k[0] !== "_" && k in specs) {
                  throw new Error("conflicting or redundant options " + k);
                }
              }
              Object.assign(specs, s);
            }
            return (0, lexer_2.track)(x, {
              type: "create function",
              ...x[1] && { orReplace: true },
              name: x[3],
              arguments: (_a = x[4]) !== null && _a !== undefined ? _a : [],
              ...specs
            });
          } },
          { name: "func_argdef$ebnf$1", symbols: ["func_argopts"], postprocess: id },
          { name: "func_argdef$ebnf$1", symbols: [], postprocess: () => null },
          { name: "func_argdef$ebnf$2", symbols: ["func_argdefault"], postprocess: id },
          { name: "func_argdef$ebnf$2", symbols: [], postprocess: () => null },
          { name: "func_argdef", symbols: ["func_argdef$ebnf$1", "data_type", "func_argdef$ebnf$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            default: x[2],
            type: x[1],
            ...x[0]
          }) },
          {
            name: "func_argdefault",
            symbols: [lexer_1.lexerAny.has("kw_default") ? { type: "kw_default" } : kw_default, "expr"],
            postprocess: (x) => x[1]
          },
          { name: "func_argdefault", symbols: [lexer_1.lexerAny.has("op_eq") ? { type: "op_eq" } : op_eq, "expr"], postprocess: (x) => x[1] },
          { name: "func_argopts$ebnf$1", symbols: ["word"], postprocess: id },
          { name: "func_argopts$ebnf$1", symbols: [], postprocess: () => null },
          { name: "func_argopts", symbols: ["func_argmod", "func_argopts$ebnf$1"], postprocess: (x) => (0, lexer_2.track)(x, {
            mode: toStr(x[0]),
            ...x[1] && { name: asName(x[1]) }
          }) },
          { name: "func_argopts", symbols: ["word"], postprocess: (x, rej) => {
            const name = asName(x);
            if (name === "out" || name === "inout" || name === "variadic") {
              return rej;
            }
            return (0, lexer_2.track)(x, { name });
          } },
          { name: "func_argmod", symbols: [lexer_1.lexerAny.has("kw_in") ? { type: "kw_in" } : kw_in] },
          { name: "func_argmod", symbols: ["kw_out"] },
          { name: "func_argmod", symbols: ["kw_inout"] },
          { name: "func_argmod", symbols: ["kw_variadic"] },
          { name: "func_spec", symbols: ["kw_language", "word"], postprocess: (x) => (0, lexer_2.track)(x, { language: asName(last(x)) }) },
          { name: "func_spec", symbols: ["func_purity"], postprocess: (x) => (0, lexer_2.track)(x, { purity: toStr(x) }) },
          { name: "func_spec$subexpression$1", symbols: [lexer_1.lexerAny.has("codeblock") ? { type: "codeblock" } : codeblock] },
          { name: "func_spec$subexpression$1", symbols: ["string"] },
          { name: "func_spec", symbols: [lexer_1.lexerAny.has("kw_as") ? { type: "kw_as" } : kw_as, "func_spec$subexpression$1"], postprocess: (x) => ({ code: toStr(last(x)) }) },
          { name: "func_spec$ebnf$1", symbols: [lexer_1.lexerAny.has("kw_not") ? { type: "kw_not" } : kw_not], postprocess: id },
          { name: "func_spec$ebnf$1", symbols: [], postprocess: () => null },
          { name: "func_spec$subexpression$2", symbols: ["word"], postprocess: kw("leakproof") },
          { name: "func_spec", symbols: ["func_spec$ebnf$1", "func_spec$subexpression$2"], postprocess: (x) => (0, lexer_2.track)(x, { leakproof: !x[0] }) },
          { name: "func_spec", symbols: ["func_returns"], postprocess: (x) => (0, lexer_2.track)(x, { returns: unwrap2(x) }) },
          { name: "func_spec$subexpression$3", symbols: ["word"], postprocess: kw("called") },
          { name: "func_spec", symbols: ["func_spec$subexpression$3", "oninp"], postprocess: () => ({ onNullInput: "call" }) },
          { name: "func_spec$subexpression$4", symbols: ["word"], postprocess: kw("returns") },
          { name: "func_spec", symbols: ["func_spec$subexpression$4", lexer_1.lexerAny.has("kw_null") ? { type: "kw_null" } : kw_null, "oninp"], postprocess: () => ({ onNullInput: "null" }) },
          { name: "func_spec$subexpression$5", symbols: ["word"], postprocess: kw("strict") },
          { name: "func_spec", symbols: ["func_spec$subexpression$5"], postprocess: () => ({ onNullInput: "strict" }) },
          { name: "func_purity", symbols: ["word"], postprocess: kw("immutable") },
          { name: "func_purity", symbols: ["word"], postprocess: kw("stable") },
          { name: "func_purity", symbols: ["word"], postprocess: kw("volatile") },
          { name: "oninp$subexpression$1", symbols: ["word"], postprocess: kw("input") },
          { name: "oninp", symbols: [lexer_1.lexerAny.has("kw_on") ? { type: "kw_on" } : kw_on, lexer_1.lexerAny.has("kw_null") ? { type: "kw_null" } : kw_null, "oninp$subexpression$1"] },
          { name: "func_returns", symbols: ["kw_returns", "data_type"], postprocess: last },
          { name: "func_returns$macrocall$2", symbols: ["func_ret_table_col"] },
          { name: "func_returns$macrocall$1$ebnf$1", symbols: [] },
          { name: "func_returns$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "func_returns$macrocall$2"], postprocess: last },
          { name: "func_returns$macrocall$1$ebnf$1", symbols: ["func_returns$macrocall$1$ebnf$1", "func_returns$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "func_returns$macrocall$1", symbols: ["func_returns$macrocall$2", "func_returns$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "func_returns", symbols: ["kw_returns", lexer_1.lexerAny.has("kw_table") ? { type: "kw_table" } : kw_table, "lparen", "func_returns$macrocall$1", "rparen"], postprocess: (x) => (0, lexer_2.track)(x, {
            kind: "table",
            columns: x[3]
          }) },
          { name: "func_ret_table_col", symbols: ["word", "data_type"], postprocess: (x) => (0, lexer_2.track)(x, { name: asName(x[0]), type: x[1] }) },
          { name: "do_stm$ebnf$1$subexpression$1", symbols: ["kw_language", "word"], postprocess: last },
          { name: "do_stm$ebnf$1", symbols: ["do_stm$ebnf$1$subexpression$1"], postprocess: id },
          { name: "do_stm$ebnf$1", symbols: [], postprocess: () => null },
          { name: "do_stm", symbols: [lexer_1.lexerAny.has("kw_do") ? { type: "kw_do" } : kw_do, "do_stm$ebnf$1", lexer_1.lexerAny.has("codeblock") ? { type: "codeblock" } : codeblock], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "do",
            ...x[1] && { language: asName(x[1]) },
            code: x[2].value
          }) },
          { name: "drop_func$ebnf$1$subexpression$1", symbols: ["kw_if", "kw_exists"] },
          { name: "drop_func$ebnf$1", symbols: ["drop_func$ebnf$1$subexpression$1"], postprocess: id },
          { name: "drop_func$ebnf$1", symbols: [], postprocess: () => null },
          { name: "drop_func$ebnf$2", symbols: ["drop_func_overload"], postprocess: id },
          { name: "drop_func$ebnf$2", symbols: [], postprocess: () => null },
          { name: "drop_func", symbols: ["kw_drop", "kw_function", "drop_func$ebnf$1", "qname", "drop_func$ebnf$2"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: "drop function",
            ...x[2] && { ifExists: true },
            name: x[3],
            ...x[4] && { arguments: x[4] }
          }) },
          { name: "drop_func_overload$macrocall$2", symbols: ["drop_func_overload_col"] },
          { name: "drop_func_overload$macrocall$1$ebnf$1", symbols: [] },
          { name: "drop_func_overload$macrocall$1$ebnf$1$subexpression$1", symbols: [lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "drop_func_overload$macrocall$2"], postprocess: last },
          { name: "drop_func_overload$macrocall$1$ebnf$1", symbols: ["drop_func_overload$macrocall$1$ebnf$1", "drop_func_overload$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "drop_func_overload$macrocall$1", symbols: ["drop_func_overload$macrocall$2", "drop_func_overload$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "drop_func_overload", symbols: ["lparen", "drop_func_overload$macrocall$1", "rparen"], postprocess: get(1) },
          { name: "drop_func_overload_col$ebnf$1", symbols: ["word"], postprocess: id },
          { name: "drop_func_overload_col$ebnf$1", symbols: [], postprocess: () => null },
          { name: "drop_func_overload_col", symbols: ["drop_func_overload_col$ebnf$1", "qname"], postprocess: (x) => (0, lexer_2.track)(x, {
            type: x[1],
            ...x[0] && { name: asName(x[0]) }
          }) },
          { name: "main$ebnf$1", symbols: [] },
          { name: "main$ebnf$1", symbols: ["main$ebnf$1", "statement_separator"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "main$ebnf$2", symbols: [] },
          { name: "main$ebnf$2$subexpression$1$ebnf$1", symbols: ["statement_separator"] },
          { name: "main$ebnf$2$subexpression$1$ebnf$1", symbols: ["main$ebnf$2$subexpression$1$ebnf$1", "statement_separator"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "main$ebnf$2$subexpression$1", symbols: ["main$ebnf$2$subexpression$1$ebnf$1", "statement"] },
          { name: "main$ebnf$2", symbols: ["main$ebnf$2", "main$ebnf$2$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "main$ebnf$3", symbols: [] },
          { name: "main$ebnf$3", symbols: ["main$ebnf$3", "statement_separator"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "main", symbols: ["main$ebnf$1", "statement", "main$ebnf$2", "main$ebnf$3"], postprocess: ([_, head, _tail]) => {
            const tail = _tail;
            const ret = [unwrap2(head), ...tail.map((x) => unwrap2(x[1]))];
            return ret.length === 1 ? ret[0] : ret;
          } },
          { name: "statement_separator", symbols: [lexer_1.lexerAny.has("semicolon") ? { type: "semicolon" } : semicolon] },
          { name: "statement", symbols: ["statement_noprep"] },
          { name: "statement", symbols: ["prepare"] },
          { name: "statement", symbols: ["deallocate"] },
          { name: "statement_noprep", symbols: ["selection"] },
          { name: "statement_noprep", symbols: ["createtable_statement"] },
          { name: "statement_noprep", symbols: ["createextension_statement"] },
          { name: "statement_noprep", symbols: ["createindex_statement"] },
          { name: "statement_noprep", symbols: ["simplestatements_all"] },
          { name: "statement_noprep", symbols: ["insert_statement"] },
          { name: "statement_noprep", symbols: ["update_statement"] },
          { name: "statement_noprep", symbols: ["altertable_statement"] },
          { name: "statement_noprep", symbols: ["alterindex_statement"] },
          { name: "statement_noprep", symbols: ["delete_statement"] },
          { name: "statement_noprep", symbols: ["create_sequence_statement"] },
          { name: "statement_noprep", symbols: ["alter_sequence_statement"] },
          { name: "statement_noprep", symbols: ["drop_statement"] },
          { name: "statement_noprep", symbols: ["createtype_statement"] },
          { name: "statement_noprep", symbols: ["altertype_statement"] },
          { name: "statement_noprep", symbols: ["create_view_statements"] },
          { name: "statement_noprep", symbols: ["refresh_view_statements"] },
          { name: "statement_noprep", symbols: ["create_schema"] },
          { name: "statement_noprep", symbols: ["raise_statement"] },
          { name: "statement_noprep", symbols: ["comment_statement"] },
          { name: "statement_noprep", symbols: ["functions_statements"] },
          { name: "selection", symbols: ["select_statement"], postprocess: unwrap2 },
          { name: "selection", symbols: ["select_values"], postprocess: unwrap2 },
          { name: "selection", symbols: ["with_statement"], postprocess: unwrap2 },
          { name: "selection", symbols: ["with_recursive_statement"], postprocess: unwrap2 },
          { name: "selection", symbols: ["union_statement"], postprocess: unwrap2 },
          { name: "selection_paren", symbols: ["lparen", "selection", "rparen"], postprocess: get(1) }
        ],
        ParserStart: "main"
      };
      exports2.default = grammar;
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      function id(d) {
        return d[0];
      }
      const array_lexer_1 = __webpack_require__(12);
      const get = (i) => (x) => x[i];
      const last = (x) => x && x[x.length - 1];
      const grammar = {
        Lexer: array_lexer_1.lexerAny,
        ParserRules: [
          { name: "main$ebnf$1", symbols: ["elements"], postprocess: id },
          { name: "main$ebnf$1", symbols: [], postprocess: () => null },
          { name: "main", symbols: [array_lexer_1.lexerAny.has("start_list") ? { type: "start_list" } : start_list, "main$ebnf$1", array_lexer_1.lexerAny.has("end_list") ? { type: "end_list" } : end_list], postprocess: (x) => x[1] || [] },
          { name: "elements$ebnf$1", symbols: [] },
          { name: "elements$ebnf$1$subexpression$1", symbols: [array_lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "elt"], postprocess: last },
          { name: "elements$ebnf$1", symbols: ["elements$ebnf$1", "elements$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "elements", symbols: ["elt", "elements$ebnf$1"], postprocess: ([head, tail]) => {
            return [head, ...tail || []];
          } },
          { name: "elt", symbols: [array_lexer_1.lexerAny.has("value") ? { type: "value" } : value], postprocess: (x) => x[0].value },
          { name: "elt", symbols: ["main"], postprocess: (x) => x[0] }
        ],
        ParserStart: "main"
      };
      exports2.default = grammar;
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.lexerAny = exports2.lexer = undefined;
      const moo_1 = __webpack_require__(0);
      exports2.lexer = (0, moo_1.compile)({
        valueString: {
          match: /"(?:\\["\\]|[^\n"\\])*"/,
          value: (x) => JSON.parse(x),
          type: (x) => "value"
        },
        valueRaw: {
          match: /[^\s,\{\}"](?:[^,\{\}"]*[^\s,\{\}"])?/,
          type: () => "value"
        },
        comma: ",",
        space: { match: /[\s\t\n\v\f\r]+/, lineBreaks: true },
        start_list: "{",
        end_list: "}"
      });
      exports2.lexer.next = ((next) => () => {
        let tok;
        while ((tok = next.call(exports2.lexer)) && tok.type === "space") {}
        return tok;
      })(exports2.lexer.next);
      exports2.lexerAny = exports2.lexer;
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      function id(d) {
        return d[0];
      }
      const geometric_lexer_1 = __webpack_require__(14);
      const get = (i) => (x) => x[i];
      const last = (x) => x && x[x.length - 1];
      function unwrap2(e) {
        if (Array.isArray(e) && e.length === 1) {
          e = unwrap2(e[0]);
        }
        if (Array.isArray(e) && !e.length) {
          return null;
        }
        return e;
      }
      const grammar = {
        Lexer: geometric_lexer_1.lexerAny,
        ParserRules: [
          { name: "number$subexpression$1", symbols: ["float"] },
          { name: "number$subexpression$1", symbols: ["int"] },
          { name: "number", symbols: ["number$subexpression$1"], postprocess: unwrap2 },
          { name: "float", symbols: [geometric_lexer_1.lexerAny.has("float") ? { type: "float" } : float], postprocess: (args) => parseFloat(unwrap2(args)) },
          { name: "int", symbols: [geometric_lexer_1.lexerAny.has("int") ? { type: "int" } : int], postprocess: (arg) => parseInt(unwrap2(arg), 10) },
          { name: "comma", symbols: [geometric_lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma], postprocess: id },
          { name: "point$macrocall$2", symbols: ["point_content"] },
          { name: "point$macrocall$1$subexpression$1", symbols: ["point$macrocall$2"] },
          { name: "point$macrocall$1$subexpression$1", symbols: [geometric_lexer_1.lexerAny.has("lparen") ? { type: "lparen" } : lparen, "point$macrocall$2", geometric_lexer_1.lexerAny.has("rparen") ? { type: "rparen" } : rparen], postprocess: get(1) },
          { name: "point$macrocall$1", symbols: ["point$macrocall$1$subexpression$1"], postprocess: unwrap2 },
          { name: "point", symbols: ["point$macrocall$1"], postprocess: unwrap2 },
          { name: "point_content", symbols: ["number", "comma", "number"], postprocess: (x) => ({ x: x[0], y: x[2] }) },
          { name: "line", symbols: [geometric_lexer_1.lexerAny.has("lcurl") ? { type: "lcurl" } : lcurl, "number", "comma", "number", "comma", "number", geometric_lexer_1.lexerAny.has("rcurl") ? { type: "rcurl" } : rcurl], postprocess: (x) => ({
            a: x[1],
            b: x[3],
            c: x[5]
          }) },
          { name: "box", symbols: ["closed_path"], postprocess: ([x], rej) => {
            if (x.length !== 2) {
              return rej;
            }
            return x;
          } },
          { name: "lseg", symbols: ["path"], postprocess: ([x], rej) => {
            if (x.path.length !== 2) {
              return rej;
            }
            return x.path;
          } },
          { name: "path", symbols: ["open_path"], postprocess: ([path]) => ({ closed: false, path }) },
          { name: "path", symbols: ["closed_path"], postprocess: ([path]) => ({ closed: true, path }) },
          { name: "open_path$macrocall$2", symbols: [geometric_lexer_1.lexerAny.has("lbracket") ? { type: "lbracket" } : lbracket] },
          { name: "open_path$macrocall$3", symbols: [geometric_lexer_1.lexerAny.has("rbracket") ? { type: "rbracket" } : rbracket] },
          { name: "open_path$macrocall$1$macrocall$2", symbols: ["point"] },
          { name: "open_path$macrocall$1$macrocall$1$ebnf$1", symbols: [] },
          { name: "open_path$macrocall$1$macrocall$1$ebnf$1$subexpression$1", symbols: [geometric_lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "open_path$macrocall$1$macrocall$2"], postprocess: last },
          { name: "open_path$macrocall$1$macrocall$1$ebnf$1", symbols: ["open_path$macrocall$1$macrocall$1$ebnf$1", "open_path$macrocall$1$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "open_path$macrocall$1$macrocall$1", symbols: ["open_path$macrocall$1$macrocall$2", "open_path$macrocall$1$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "open_path$macrocall$1", symbols: ["open_path$macrocall$2", "open_path$macrocall$1$macrocall$1", "open_path$macrocall$3"], postprocess: get(1) },
          { name: "open_path", symbols: ["open_path$macrocall$1"], postprocess: last },
          { name: "closed_path$subexpression$1$macrocall$2", symbols: [geometric_lexer_1.lexerAny.has("lparen") ? { type: "lparen" } : lparen] },
          { name: "closed_path$subexpression$1$macrocall$3", symbols: [geometric_lexer_1.lexerAny.has("rparen") ? { type: "rparen" } : rparen] },
          { name: "closed_path$subexpression$1$macrocall$1$macrocall$2", symbols: ["point"] },
          { name: "closed_path$subexpression$1$macrocall$1$macrocall$1$ebnf$1", symbols: [] },
          { name: "closed_path$subexpression$1$macrocall$1$macrocall$1$ebnf$1$subexpression$1", symbols: [geometric_lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "closed_path$subexpression$1$macrocall$1$macrocall$2"], postprocess: last },
          { name: "closed_path$subexpression$1$macrocall$1$macrocall$1$ebnf$1", symbols: ["closed_path$subexpression$1$macrocall$1$macrocall$1$ebnf$1", "closed_path$subexpression$1$macrocall$1$macrocall$1$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "closed_path$subexpression$1$macrocall$1$macrocall$1", symbols: ["closed_path$subexpression$1$macrocall$1$macrocall$2", "closed_path$subexpression$1$macrocall$1$macrocall$1$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "closed_path$subexpression$1$macrocall$1", symbols: ["closed_path$subexpression$1$macrocall$2", "closed_path$subexpression$1$macrocall$1$macrocall$1", "closed_path$subexpression$1$macrocall$3"], postprocess: get(1) },
          { name: "closed_path$subexpression$1", symbols: ["closed_path$subexpression$1$macrocall$1"], postprocess: last },
          { name: "closed_path$subexpression$1$macrocall$5", symbols: ["point"] },
          { name: "closed_path$subexpression$1$macrocall$4$ebnf$1", symbols: [] },
          { name: "closed_path$subexpression$1$macrocall$4$ebnf$1$subexpression$1", symbols: [geometric_lexer_1.lexerAny.has("comma") ? { type: "comma" } : comma, "closed_path$subexpression$1$macrocall$5"], postprocess: last },
          { name: "closed_path$subexpression$1$macrocall$4$ebnf$1", symbols: ["closed_path$subexpression$1$macrocall$4$ebnf$1", "closed_path$subexpression$1$macrocall$4$ebnf$1$subexpression$1"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "closed_path$subexpression$1$macrocall$4", symbols: ["closed_path$subexpression$1$macrocall$5", "closed_path$subexpression$1$macrocall$4$ebnf$1"], postprocess: ([head, tail]) => {
            return [unwrap2(head), ...tail.map(unwrap2) || []];
          } },
          { name: "closed_path$subexpression$1", symbols: ["closed_path$subexpression$1$macrocall$4"], postprocess: last },
          { name: "closed_path", symbols: ["closed_path$subexpression$1"], postprocess: get(0) },
          { name: "polygon", symbols: ["closed_path"], postprocess: get(0) },
          { name: "circle_body", symbols: ["point", "comma", "number"], postprocess: (x) => ({ c: x[0], r: x[2] }) },
          { name: "circle$subexpression$1$macrocall$2", symbols: [geometric_lexer_1.lexerAny.has("lcomp") ? { type: "lcomp" } : lcomp] },
          { name: "circle$subexpression$1$macrocall$3", symbols: [geometric_lexer_1.lexerAny.has("rcomp") ? { type: "rcomp" } : rcomp] },
          { name: "circle$subexpression$1$macrocall$1", symbols: ["circle$subexpression$1$macrocall$2", "circle_body", "circle$subexpression$1$macrocall$3"], postprocess: get(1) },
          { name: "circle$subexpression$1", symbols: ["circle$subexpression$1$macrocall$1"] },
          { name: "circle$subexpression$1$macrocall$5", symbols: [geometric_lexer_1.lexerAny.has("lparen") ? { type: "lparen" } : lparen] },
          { name: "circle$subexpression$1$macrocall$6", symbols: [geometric_lexer_1.lexerAny.has("rparen") ? { type: "rparen" } : rparen] },
          { name: "circle$subexpression$1$macrocall$4", symbols: ["circle$subexpression$1$macrocall$5", "circle_body", "circle$subexpression$1$macrocall$6"], postprocess: get(1) },
          { name: "circle$subexpression$1", symbols: ["circle$subexpression$1$macrocall$4"] },
          { name: "circle$subexpression$1", symbols: ["circle_body"] },
          { name: "circle", symbols: ["circle$subexpression$1"], postprocess: unwrap2 }
        ],
        ParserStart: "number"
      };
      exports2.default = grammar;
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.lexerAny = exports2.lexer = undefined;
      const moo_1 = __webpack_require__(0);
      exports2.lexer = (0, moo_1.compile)({
        comma: ",",
        space: { match: /[\s\t\n\v\f\r]+/, lineBreaks: true },
        int: /\-?\d+(?![\.\d])/,
        float: /\-?(?:(?:\d*\.\d+)|(?:\d+\.\d*))/,
        lcurl: "{",
        rcurl: "}",
        lparen: "(",
        rparen: ")",
        lbracket: "[",
        rbracket: "]",
        lcomp: "<",
        rcomp: ">"
      });
      exports2.lexer.next = ((next) => () => {
        let tok;
        while ((tok = next.call(exports2.lexer)) && tok.type === "space") {}
        return tok;
      })(exports2.lexer.next);
      exports2.lexerAny = exports2.lexer;
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      function id(d) {
        return d[0];
      }
      const interval_lexer_1 = __webpack_require__(16);
      const grammar = {
        Lexer: interval_lexer_1.lexerAny,
        ParserRules: [
          { name: "main$ebnf$1", symbols: ["elt"] },
          { name: "main$ebnf$1", symbols: ["main$ebnf$1", "elt"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "main", symbols: ["main$ebnf$1"], postprocess: ([elts]) => {
            const s = new Set;
            for (const e of elts) {
              const k = typeof e[1] === "number" ? e[0] : "time";
              if (s.has(k)) {
                return "invalid";
              }
              s.add(k);
            }
            return elts;
          } },
          { name: "elt", symbols: ["time"] },
          { name: "elt", symbols: ["num", "unit"], postprocess: ([[n], u]) => {
            u = u[0].type;
            return [u, n];
          } },
          { name: "unit", symbols: [interval_lexer_1.lexerAny.has("years") ? { type: "years" } : years] },
          { name: "unit", symbols: [interval_lexer_1.lexerAny.has("months") ? { type: "months" } : months] },
          { name: "unit", symbols: [interval_lexer_1.lexerAny.has("days") ? { type: "days" } : days] },
          { name: "unit", symbols: [interval_lexer_1.lexerAny.has("hours") ? { type: "hours" } : hours] },
          { name: "unit", symbols: [interval_lexer_1.lexerAny.has("minutes") ? { type: "minutes" } : minutes] },
          { name: "unit", symbols: [interval_lexer_1.lexerAny.has("seconds") ? { type: "seconds" } : seconds] },
          { name: "unit", symbols: [interval_lexer_1.lexerAny.has("milliseconds") ? { type: "milliseconds" } : milliseconds] },
          { name: "num", symbols: ["int"] },
          { name: "num", symbols: ["float"] },
          { name: "uint", symbols: [interval_lexer_1.lexerAny.has("int") ? { type: "int" } : int], postprocess: ([x]) => parseInt(x, 10) },
          { name: "int$ebnf$1$subexpression$1", symbols: [interval_lexer_1.lexerAny.has("neg") ? { type: "neg" } : neg] },
          { name: "int$ebnf$1", symbols: ["int$ebnf$1$subexpression$1"], postprocess: id },
          { name: "int$ebnf$1", symbols: [], postprocess: () => null },
          { name: "int", symbols: ["int$ebnf$1", interval_lexer_1.lexerAny.has("int") ? { type: "int" } : int], postprocess: ([neg2, x]) => parseInt(x, 10) * (neg2 ? -1 : 1) },
          { name: "float$ebnf$1$subexpression$1", symbols: [interval_lexer_1.lexerAny.has("neg") ? { type: "neg" } : neg] },
          { name: "float$ebnf$1", symbols: ["float$ebnf$1$subexpression$1"], postprocess: id },
          { name: "float$ebnf$1", symbols: [], postprocess: () => null },
          { name: "float$ebnf$2", symbols: [interval_lexer_1.lexerAny.has("int") ? { type: "int" } : int], postprocess: id },
          { name: "float$ebnf$2", symbols: [], postprocess: () => null },
          { name: "float", symbols: ["float$ebnf$1", "float$ebnf$2", interval_lexer_1.lexerAny.has("dot") ? { type: "dot" } : dot, interval_lexer_1.lexerAny.has("int") ? { type: "int" } : int], postprocess: ([neg2, ...v]) => parseFloat(v.map((v2) => v2 ? v2.text : "0").join("")) * (neg2 ? -1 : 1) },
          { name: "time$ebnf$1$subexpression$1", symbols: [interval_lexer_1.lexerAny.has("colon") ? { type: "colon" } : colon, "uint"] },
          { name: "time$ebnf$1", symbols: ["time$ebnf$1$subexpression$1"], postprocess: id },
          { name: "time$ebnf$1", symbols: [], postprocess: () => null },
          { name: "time$ebnf$2$subexpression$1", symbols: [interval_lexer_1.lexerAny.has("dot") ? { type: "dot" } : dot, interval_lexer_1.lexerAny.has("int") ? { type: "int" } : int] },
          { name: "time$ebnf$2", symbols: ["time$ebnf$2$subexpression$1"], postprocess: id },
          { name: "time$ebnf$2", symbols: [], postprocess: () => null },
          { name: "time", symbols: ["uint", interval_lexer_1.lexerAny.has("colon") ? { type: "colon" } : colon, "uint", "time$ebnf$1", "time$ebnf$2"], postprocess: ([a, _, b, c, d]) => {
            c = c && c[1];
            d = d && d[1];
            const ret = typeof c === "number" ? [
              ["hours", a],
              ["minutes", b],
              ["seconds", c]
            ] : [
              ["minutes", a],
              ["seconds", b]
            ];
            if (d) {
              ret.push(["milliseconds", parseFloat("0." + d) * 1000]);
            }
            return ret;
          } }
        ],
        ParserStart: "main"
      };
      exports2.default = grammar;
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.lexerAny = exports2.lexer = undefined;
      const moo_1 = __webpack_require__(0);
      exports2.lexer = (0, moo_1.compile)({
        int: /\d+/,
        neg: "-",
        dot: ".",
        years: /(?:y|yrs?|years?)\b/,
        months: /(?:mon(?:th)?s?)\b/,
        days: /(?:d|days?)\b/,
        hours: /(?:h|hrs?|hours?)\b/,
        minutes: /(?:m|mins?|minutes?)\b/,
        seconds: /(?:s|secs?|seconds?)\b/,
        milliseconds: /(?:ms|milliseconds?)\b/,
        space: { match: /[\s\t\n\v\f\r]+/, lineBreaks: true },
        colon: ":"
      });
      exports2.lexer.next = ((next) => () => {
        let tok;
        while ((tok = next.call(exports2.lexer)) && tok.type === "space") {}
        return tok;
      })(exports2.lexer.next);
      exports2.lexerAny = exports2.lexer;
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      function id(d) {
        return d[0];
      }
      const interval_iso_lexer_1 = __webpack_require__(18);
      const grammar = {
        Lexer: interval_iso_lexer_1.lexerAny,
        ParserRules: [
          { name: "num", symbols: [interval_iso_lexer_1.lexerAny.has("int") ? { type: "int" } : int] },
          { name: "num", symbols: [interval_iso_lexer_1.lexerAny.has("float") ? { type: "float" } : float] },
          { name: "main$ebnf$1", symbols: [] },
          { name: "main$ebnf$1", symbols: ["main$ebnf$1", "long"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "main$ebnf$2$subexpression$1$ebnf$1", symbols: ["short"] },
          { name: "main$ebnf$2$subexpression$1$ebnf$1", symbols: ["main$ebnf$2$subexpression$1$ebnf$1", "short"], postprocess: (d) => d[0].concat([d[1]]) },
          { name: "main$ebnf$2$subexpression$1", symbols: [interval_iso_lexer_1.lexerAny.has("T") ? { type: "T" } : T, "main$ebnf$2$subexpression$1$ebnf$1"] },
          { name: "main$ebnf$2", symbols: ["main$ebnf$2$subexpression$1"], postprocess: id },
          { name: "main$ebnf$2", symbols: [], postprocess: () => null },
          { name: "main", symbols: [interval_iso_lexer_1.lexerAny.has("P") ? { type: "P" } : P, "main$ebnf$1", "main$ebnf$2"], postprocess: ([_, a, b], rej) => {
            b = !b ? [] : b[1];
            {}
            if (!a.length && !b.length) {
              return rej;
            }
            return !a.length ? b : !b.length ? a : [...a, ...b];
          } },
          { name: "long$subexpression$1", symbols: [interval_iso_lexer_1.lexerAny.has("Y") ? { type: "Y" } : Y] },
          { name: "long$subexpression$1", symbols: [interval_iso_lexer_1.lexerAny.has("M") ? { type: "M" } : M] },
          { name: "long$subexpression$1", symbols: [interval_iso_lexer_1.lexerAny.has("W") ? { type: "W" } : W] },
          { name: "long$subexpression$1", symbols: [interval_iso_lexer_1.lexerAny.has("D") ? { type: "D" } : D] },
          { name: "long", symbols: ["num", "long$subexpression$1"], postprocess: ([n, u]) => {
            n = parseFloat(n[0].value);
            u = u[0].type;
            switch (u) {
              case "Y":
                return ["years", n];
              case "M":
                return ["months", n];
              case "W":
                return ["days", n * 7];
              case "D":
                return ["days", n];
              default:
                throw new Error("Unexpected unit " + u);
            }
          } },
          { name: "short$ebnf$1", symbols: [interval_iso_lexer_1.lexerAny.has("T") ? { type: "T" } : T], postprocess: id },
          { name: "short$ebnf$1", symbols: [], postprocess: () => null },
          { name: "short$subexpression$1", symbols: [interval_iso_lexer_1.lexerAny.has("H") ? { type: "H" } : H] },
          { name: "short$subexpression$1", symbols: [interval_iso_lexer_1.lexerAny.has("M") ? { type: "M" } : M] },
          { name: "short$subexpression$1", symbols: [interval_iso_lexer_1.lexerAny.has("S") ? { type: "S" } : S] },
          { name: "short", symbols: ["short$ebnf$1", "num", "short$subexpression$1"], postprocess: ([_, n, u]) => {
            n = parseFloat(n[0].value);
            u = u[0].type;
            switch (u) {
              case "H":
                return ["hours", n];
              case "M":
                return ["minutes", n];
              case "S":
                return ["seconds", n];
              default:
                throw new Error("Unexpected unit " + u);
            }
          } }
        ],
        ParserStart: "num"
      };
      exports2.default = grammar;
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.lexerAny = exports2.lexer = undefined;
      const moo_1 = __webpack_require__(0);
      exports2.lexer = (0, moo_1.compile)({
        int: /\-?\d+(?![\.\d])/,
        float: /\-?(?:(?:\d*\.\d+)|(?:\d+\.\d*))/,
        P: "P",
        Y: "Y",
        M: "M",
        W: "W",
        D: "D",
        H: "H",
        S: "S",
        T: "T"
      });
      exports2.lexerAny = exports2.lexer;
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.toSql = undefined;
      const ast_mapper_1 = __webpack_require__(2);
      const ast_visitor_1 = __webpack_require__(5);
      const utils_1 = __webpack_require__(6);
      const pg_escape_1 = __webpack_require__(20);
      const keywords_1 = __webpack_require__(3);
      const kwSet = new Set(keywords_1.sqlKeywords.map((x) => x.toLowerCase()));
      let ret = [];
      function name(nm) {
        return ident(nm.name);
      }
      function ident(nm, forceDoubleQuote) {
        if (!forceDoubleQuote) {
          const low = nm.toLowerCase();
          if (low === nm && !kwSet.has(low) && /^[a-z][a-z0-9_]*$/.test(low)) {
            return nm;
          }
        }
        return '"' + nm + '"';
      }
      function list(elems, act, addParen) {
        if (addParen) {
          ret.push("(");
        }
        let first = true;
        for (const e of elems) {
          if (!first) {
            ret.push(", ");
          }
          first = false;
          act(e);
        }
        if (addParen) {
          ret.push(")");
        }
      }
      function addConstraint(c, m) {
        switch (c.type) {
          case "foreign key":
            ret.push(" foreign key (", ...c.localColumns.map(name).join(", "), ")");
          case "reference":
            ret.push(" REFERENCES ");
            m.tableRef(c.foreignTable);
            ret.push("(", ...c.foreignColumns.map(name).join(", "), ") ");
            if (c.match) {
              ret.push(" MATCH ", c.match.toUpperCase());
            }
            if (c.onDelete) {
              ret.push(" ON DELETE ", c.onDelete);
            }
            if (c.onUpdate) {
              ret.push(" ON UPDATE ", c.onUpdate);
            }
            break;
          case "primary key":
          case "unique":
            ret.push(" ", c.type, " ");
            if ("columns" in c) {
              ret.push("(", ...c.columns.map(name).join(", "), ") ");
            }
            break;
          case "check":
            ret.push(" check ");
            m.expr(c.expr);
            break;
          case "not null":
          case "null":
            ret.push(" ", c.type, " ");
            break;
          case "default":
            ret.push(" default ");
            m.expr(c.default);
            break;
          case "add generated":
            ret.push(" GENERATED ");
            visitGenerated(m, c);
            break;
          default:
            throw utils_1.NotSupported.never(c);
        }
        ret.push(" ");
      }
      function visitQualifiedName(cs, forceDoubleQuote) {
        if (cs.schema) {
          ret.push(ident(cs.schema), ".");
        }
        ret.push(ident(cs.name, forceDoubleQuote), " ");
      }
      function visitQualifiedNameAliased(cs) {
        visitQualifiedName(cs);
        if (cs.alias) {
          ret.push(" AS ", ident(cs.alias), " ");
        }
      }
      function visitOrderBy(m, orderBy) {
        ret.push(" ORDER BY ");
        list(orderBy, (e) => {
          m.expr(e.by);
          if (e.order) {
            ret.push(" ", e.order, " ");
          }
          if (e.nulls) {
            ret.push(" NULLS ", e.nulls, " ");
          }
        }, false);
      }
      function visitSetVal(set) {
        switch (set.type) {
          case "default":
            ret.push("DEFAULT ");
            break;
          case "identifier":
            ret.push(set.name);
            break;
          case "list":
            let first = true;
            for (const v of set.values) {
              if (!first) {
                ret.push(", ");
              }
              first = false;
              visitSetVal(v);
            }
            break;
          case "value":
            ret.push(typeof set.value === "number" ? set.value.toString() : (0, pg_escape_1.literal)(set.value));
            break;
          default:
            throw utils_1.NotSupported.never(set);
        }
      }
      function visitGenerated(m, alter) {
        if (alter.always) {
          ret.push(alter.always.toUpperCase(), " ");
        }
        ret.push("AS ");
        if (alter.expression) {
          ret.push("(");
          m.expr(alter.expression);
          ret.push(") ");
        } else {
          ret.push("IDENTITY ");
        }
        if (alter.sequence) {
          ret.push("(");
          if (alter.sequence.name) {
            ret.push("SEQUENCE NAME ");
            visitQualifiedName(alter.sequence.name);
            ret.push(" ");
          }
          visitSeqOpts(m, alter.sequence);
          ret.push(") ");
        }
        if (alter.stored) {
          ret.push("STORED ");
        }
      }
      function visitSeqOpts(m, cs) {
        if (cs.as) {
          ret.push("AS ");
          m.dataType(cs.as);
          ret.push(" ");
        }
        if (typeof cs.incrementBy === "number") {
          ret.push("INCREMENT BY ", cs.incrementBy.toString(), " ");
        }
        if (cs.minValue === "no minvalue") {
          ret.push("NO MINVALUE ");
        }
        if (typeof cs.minValue === "number") {
          ret.push("MINVALUE ", cs.minValue.toString(), " ");
        }
        if (cs.maxValue === "no maxvalue") {
          ret.push("NO MAXVALUE ");
        }
        if (typeof cs.maxValue === "number") {
          ret.push("MAXVALUE ", cs.maxValue.toString(), " ");
        }
        if (typeof cs.startWith === "number") {
          ret.push("START WITH ", cs.startWith.toString(), " ");
        }
        if (typeof cs.cache === "number") {
          ret.push("CACHE ", cs.cache.toString(), " ");
        }
        if (cs.cycle) {
          ret.push(cs.cycle, " ");
        }
        if (cs.ownedBy === "none") {
          ret.push("OWNED BY NONE ");
        } else if (cs.ownedBy) {
          ret.push("OWNED BY ");
          visitQColumn(cs.ownedBy);
        }
        if ("restart" in cs) {
          if (cs.restart === true) {
            ret.push("RESTART ");
          } else if (cs.restart) {
            ret.push("RESTART WITH ", cs.restart.toString(), " ");
          }
        }
      }
      function visitQColumn(col) {
        if (col.schema) {
          ret.push(ident(col.schema), ".");
        }
        ret.push(ident(col.table), ".", ident(col.column), " ");
      }
      function join(m, j, tbl) {
        if (!j) {
          tbl();
          return;
        }
        ret.push(j.type, " ");
        tbl();
        if (j.on) {
          ret.push("ON ");
          m.expr(j.on);
        }
        if (j.using) {
          ret.push("USING (");
          list(j.using, (x) => ret.push(name(x)), false);
          ret.push(") ");
        }
        ret.push(" ");
      }
      function visitOp(v) {
        if (v.opSchema) {
          ret.push(" operator(", ident(v.opSchema), ".", v.op, ") ");
        } else {
          ret.push(" ", v.op, " ");
        }
      }
      const visitor = (0, ast_visitor_1.astVisitor)((m) => ({
        addColumn: (...args) => {
          ret.push(" ADD COLUMN ");
          if (args[0].ifNotExists) {
            ret.push("IF NOT EXISTS ");
          }
          m.super().addColumn(...args);
        },
        createExtension: (e) => {
          ret.push("CREATE EXTENSION ");
          if (e.ifNotExists) {
            ret.push(" IF NOT EXISTS ");
          }
          ret.push(name(e.extension));
          if (!e.from && !e.version && !e.schema) {
            return;
          }
          ret.push(" WITH");
          if (e.schema) {
            ret.push(" SCHEMA ", name(e.schema));
          }
          if (e.version) {
            ret.push(" VERSION ", (0, pg_escape_1.literal)(e.version.value));
          }
          if (e.from) {
            ret.push(" FROM ", (0, pg_escape_1.literal)(e.from.value));
          }
        },
        tablespace: (t) => {
          ret.push("TABLESPACE ", name(t.tablespace));
        },
        addConstraint: (c) => {
          ret.push(" ADD ");
          const cname = c.constraint.constraintName;
          if (cname) {
            ret.push(" CONSTRAINT ", name(cname), " ");
          }
          addConstraint(c.constraint, m);
        },
        alterColumn: (c, t) => {
          ret.push(" ALTER COLUMN ", name(c.column), " ");
          m.super().alterColumn(c, t);
        },
        setColumnDefault: (a, t, c) => {
          ret.push(" SET DEFAULT ");
          m.expr(a.default);
          if (a.updateExisting) {
            throw new Error("Not implemented: updateExisting on set column default");
          }
        },
        createEnum: (t) => {
          ret.push("CREATE TYPE ");
          visitQualifiedName(t.name);
          ret.push(" AS ENUM ");
          list(t.values, (x) => ret.push((0, pg_escape_1.literal)(x.value)), true);
          ret.push(" ");
        },
        alterEnum: (t) => {
          ret.push("ALTER TYPE ");
          visitQualifiedName(t.name);
          if (t.change.type === "rename") {
            ret.push(" RENAME TO ");
            visitQualifiedName(t.change.to);
          } else {
            ret.push(" ADD VALUE ", (0, pg_escape_1.literal)(t.change.add.value));
          }
        },
        createCompositeType: (c) => {
          ret.push("CREATE TYPE ");
          visitQualifiedName(c.name);
          ret.push(" AS ");
          list(c.attributes, (x) => {
            ret.push(name(x.name), " ");
            m.dataType(x.dataType);
            if (x.collate) {
              ret.push("COLLATE ");
              visitQualifiedName(x.collate);
            }
          }, true);
          ret.push(" ");
        },
        setTableOwner: (o) => {
          ret.push(" OWNER TO ", name(o.to));
        },
        alterColumnSimple: (c) => ret.push(c.type),
        alterColumnAddGenerated: (alter) => {
          ret.push(" ADD GENERATED ");
          visitGenerated(m, alter);
        },
        setColumnType: (t) => {
          ret.push(" SET DATA TYPE ");
          m.dataType(t.dataType);
          ret.push(" ");
        },
        alterTable: (t) => {
          ret.push("ALTER TABLE ");
          if (t.ifExists) {
            ret.push(" IF EXISTS ");
          }
          if (t.only) {
            ret.push(" ONLY ");
          }
          visitQualifiedNameAliased(t.table);
          list(t.changes, (change) => m.tableAlteration(change, t.table), false);
        },
        alterIndex: (t) => {
          ret.push("ALTER INDEX ");
          if (t.ifExists) {
            ret.push(" IF EXISTS ");
          }
          visitQualifiedNameAliased(t.index);
          switch (t.change.type) {
            case "rename":
              ret.push(" RENAME TO ");
              visitQualifiedName(t.change.to);
              ret.push(" ");
              break;
            case "set tablespace":
              ret.push(" SET TABLESPACE ");
              visitQualifiedName(t.change.tablespace);
              ret.push(" ");
              break;
            default:
              throw utils_1.NotSupported.never(t.change, "Alter index type not supported: ");
          }
        },
        tableAlteration: (change, table) => {
          switch (change.type) {
            case "add column":
              return m.addColumn(change, table);
            case "add constraint":
              return m.addConstraint(change, table);
            case "alter column":
              return m.alterColumn(change, table);
            case "rename":
              return m.renameTable(change, table);
            case "rename column":
              return m.renameColumn(change, table);
            case "rename constraint":
              return m.renameConstraint(change, table);
            case "drop column":
              return m.dropColumn(change, table);
            case "drop constraint":
              return m.dropConstraint(change, table);
            case "owner":
              return m.setTableOwner(change, table);
            default:
              throw utils_1.NotSupported.never(change);
          }
        },
        array: (v) => {
          ret.push(v.type === "array" ? "ARRAY[" : "(");
          list(v.expressions, (e) => m.expr(e), false);
          ret.push(v.type === "array" ? "]" : ")");
        },
        arrayIndex: (v) => {
          m.expr(v.array);
          ret.push("[");
          m.expr(v.index);
          ret.push("] ");
        },
        expr: (e) => {
          if (e.type === "ref") {
            m.ref(e);
            return;
          }
          if (e.type === "list") {
            m.super().expr(e);
            return;
          }
          ret.push("(");
          m.super().expr(e);
          ret.push(")");
        },
        callOverlay: (o) => {
          ret.push("OVERLAY(");
          m.expr(o.value);
          ret.push(" PLACING ");
          m.expr(o.placing);
          ret.push(" FROM ");
          m.expr(o.from);
          if (o.for) {
            ret.push(" FOR ");
            m.expr(o.for);
          }
          ret.push(")");
        },
        callSubstring: (s) => {
          ret.push("SUBSTRING(");
          m.expr(s.value);
          if (s.from) {
            ret.push(" FROM ");
            m.expr(s.from);
          }
          if (s.for) {
            ret.push(" FOR ");
            m.expr(s.for);
          }
          ret.push(")");
        },
        binary: (v) => {
          m.expr(v.left);
          visitOp(v);
          m.expr(v.right);
        },
        call: (v) => {
          visitQualifiedName(v.function);
          ret.push("(");
          if (v.distinct) {
            ret.push(v.distinct, " ");
          }
          list(v.args, (e) => m.expr(e), false);
          if (v.orderBy) {
            visitOrderBy(m, v.orderBy);
          }
          ret.push(") ");
          if (v.filter) {
            ret.push("filter (where ");
            m.expr(v.filter);
            ret.push(") ");
          }
          if (v.withinGroup) {
            ret.push("WITHIN GROUP (");
            visitOrderBy(m, [v.withinGroup]);
            ret.push(") ");
          }
          if (v.over) {
            ret.push("over (");
            if (v.over.partitionBy) {
              ret.push("PARTITION BY ");
              list(v.over.partitionBy, (x) => m.expr(x), false);
              ret.push(" ");
            }
            if (v.over.orderBy) {
              visitOrderBy(m, v.over.orderBy);
              ret.push(" ");
            }
            ret.push(") ");
          }
        },
        case: (c) => {
          ret.push("CASE ");
          if (c.value) {
            m.expr(c.value);
          }
          for (const e of c.whens) {
            ret.push(" WHEN ");
            m.expr(e.when);
            ret.push(" THEN ");
            m.expr(e.value);
          }
          if (c.else) {
            ret.push(" ELSE ");
            m.expr(c.else);
          }
          ret.push(" END ");
        },
        cast: (c) => {
          m.expr(c.operand);
          ret.push("::");
          m.dataType(c.to);
        },
        constant: (c) => {
          switch (c.type) {
            case "boolean":
              ret.push(c.value ? "true" : "false");
              break;
            case "integer":
              ret.push(c.value.toString(10));
              break;
            case "numeric":
              ret.push(c.value.toString());
              if (Number.isInteger(c.value)) {
                ret.push(".");
              }
              break;
            case "null":
              ret.push("null");
              break;
            case "constant":
              break;
            case "string":
              ret.push((0, pg_escape_1.literal)(c.value));
              break;
            default:
              throw utils_1.NotSupported.never(c);
          }
        },
        valueKeyword: (v) => {
          ret.push(v.keyword, " ");
        },
        comment: (c) => {
          ret.push("COMMENT ON ", c.on.type.toUpperCase(), " ");
          switch (c.on.type) {
            case "column":
              visitQColumn(c.on.column);
              break;
            default:
              visitQualifiedName(c.on.name);
              break;
          }
          ret.push(" IS ", (0, pg_escape_1.literal)(c.comment), " ");
        },
        extract: (v) => {
          ret.push("EXTRACT (", v.field.name.toUpperCase(), " FROM ");
          m.expr(v.from);
          ret.push(") ");
        },
        createColumn: (c) => {
          var _a;
          ret.push(name(c.name), " ");
          m.dataType(c.dataType);
          ret.push(" ");
          if (c.collate) {
            ret.push("COLLATE ");
            visitQualifiedName(c.collate);
          }
          for (const cst of (_a = c.constraints) !== null && _a !== undefined ? _a : []) {
            m.constraint(cst);
          }
        },
        begin: (beg) => {
          ret.push("BEGIN ");
          if (beg.isolationLevel) {
            ret.push("ISOLATION LEVEL ", beg.isolationLevel.toUpperCase(), " ");
          }
          if (beg.writeable) {
            ret.push(beg.writeable.toUpperCase(), " ");
          }
          if (typeof beg.deferrable === "boolean") {
            if (!beg.deferrable) {
              ret.push("NOT ");
            }
            ret.push("DEFERRABLE ");
          }
        },
        alterSequence: (cs) => {
          ret.push("ALTER SEQUENCE ");
          if (cs.ifExists) {
            ret.push("IF EXISTS ");
          }
          visitQualifiedName(cs.name);
          switch (cs.change.type) {
            case "set options":
              visitSeqOpts(m, cs.change);
              break;
            case "rename":
              ret.push("RENAME TO ", name(cs.change.newName), " ");
              break;
            case "set schema":
              ret.push("SET SCHEMA ", name(cs.change.newSchema), " ");
              break;
            case "owner to":
              const own = cs.change.owner;
              ret.push("OWNER TO ", name(cs.change.owner), " ");
              break;
            default:
              throw utils_1.NotSupported.never(cs.change);
          }
        },
        createSequence: (cs) => {
          ret.push("CREATE ");
          if (cs.temp) {
            ret.push("TEMPORARY ");
          }
          ret.push("SEQUENCE ");
          if (cs.ifNotExists) {
            ret.push("IF NOT EXISTS ");
          }
          visitQualifiedName(cs.name);
          visitSeqOpts(m, cs.options);
        },
        drop: (val) => {
          ret.push(val.type.toUpperCase(), " ");
          if (val.concurrently) {
            ret.push("CONCURRENTLY ");
          }
          if (val.ifExists) {
            ret.push("IF EXISTS ");
          }
          list(val.names, (x) => m.tableRef(x), false);
          if (val.cascade) {
            ret.push(val.cascade.toUpperCase(), " ");
          }
        },
        constraint: (cst) => {
          if (cst.constraintName) {
            ret.push(" CONSTRAINT ", name(cst.constraintName), " ");
          }
          addConstraint(cst, m);
        },
        do: (d) => {
          ret.push("DO");
          if (d.language) {
            ret.push(" LANGUAGE ", d.language.name);
          }
          ret.push(" $$", d.code, "$$");
        },
        createFunction: (c) => {
          var _a;
          ret.push(c.orReplace ? "CREATE OR REPLACE FUNCTION " : "CREATE FUNCTION ");
          visitQualifiedName(c.name);
          list(c.arguments, (a) => {
            if (a.mode) {
              ret.push(a.mode, " ");
            }
            if (a.name) {
              ret.push(name(a.name), " ");
            }
            m.dataType(a.type);
            if (a.default) {
              ret.push(" = ");
              m.expr(a.default);
            }
          }, true);
          if (c.returns) {
            switch (c.returns.kind) {
              case "table":
                ret.push(" RETURNS TABLE ");
                list(c.returns.columns, (t) => {
                  ret.push(name(t.name), " ");
                  m.dataType(t.type);
                }, true);
                break;
              case undefined:
              case null:
              case "array":
                ret.push(" RETURNS ");
                m.dataType(c.returns);
                break;
              default:
                throw utils_1.NotSupported.never(c.returns);
            }
          }
          ret.push(" AS $$", (_a = c.code) !== null && _a !== undefined ? _a : "", "$$");
          if (c.language) {
            ret.push("LANGUAGE ", c.language.name, " ");
          }
          if (c.purity) {
            ret.push(c.purity.toUpperCase(), " ");
          }
          if (typeof c.leakproof === "boolean") {
            ret.push(c.leakproof ? "LEAKPROOF " : "NOT LEAKPROOF ");
          }
          switch (c.onNullInput) {
            case "call":
              ret.push("CALLED ON NULL INPUT ");
              break;
            case "null":
              ret.push("RETURNS NULL ON NULL INPUT ");
              break;
            case "strict":
              ret.push("STRICT ");
              break;
            case null:
            case undefined:
              break;
            default:
              throw utils_1.NotSupported.never(c.onNullInput);
          }
        },
        dropFunction: (d) => {
          ret.push("DROP FUNCTION ");
          if (d.ifExists) {
            ret.push("IF EXISTS ");
          }
          visitQualifiedName(d.name);
          if (d.arguments) {
            list(d.arguments, (a) => {
              if (a.name) {
                visitQualifiedName(a.name);
                ret.push(" ");
              }
              m.dataType(a.type);
            }, true);
          }
          ret.push(" ");
        },
        with: (w) => {
          ret.push("WITH ");
          list(w.bind, (b) => {
            ret.push(name(b.alias), " AS (");
            m.statement(b.statement);
            ret.push(") ");
          }, false);
          m.statement(w.in);
        },
        withRecursive: (val) => {
          ret.push("WITH RECURSIVE ", name(val.alias), "(", ...val.columnNames.map(name).join(", "), ") AS (");
          m.union(val.bind);
          ret.push(") ");
          m.statement(val.in);
        },
        setGlobal: (g) => {
          ret.push("SET ");
          if (g.scope) {
            ret.push(g.scope.toUpperCase() + " ");
          }
          ret.push(name(g.variable), " = ");
          visitSetVal(g.set);
        },
        setTimezone: (g) => {
          ret.push("SET TIME ZONE ");
          switch (g.to.type) {
            case "default":
            case "local":
              ret.push(g.to.type.toUpperCase(), " ");
              break;
            case "value":
              ret.push(typeof g.to.value === "string" ? (0, pg_escape_1.literal)(g.to.value) : g.to.value.toString(10));
              break;
            case "interval":
              ret.push("INTERVAL ", (0, pg_escape_1.literal)(g.to.value), " HOUR TO MINUTE");
              break;
            default:
              throw utils_1.NotSupported.never(g.to);
          }
        },
        setNames: (g) => {
          ret.push("SET NAMES ");
          switch (g.to.type) {
            case "value":
              ret.push((0, pg_escape_1.literal)(g.to.value));
              break;
          }
        },
        dataType: (d) => {
          var _a, _b;
          if ((d === null || d === undefined ? undefined : d.kind) === "array") {
            m.dataType(d.arrayOf);
            ret.push("[]");
            return;
          }
          if (!(d === null || d === undefined ? undefined : d.name)) {
            ret.push("unkown");
            return;
          }
          let appendConfig = true;
          if (d.schema) {
            visitQualifiedName(d, d.doubleQuoted);
          } else {
            if (d.doubleQuoted) {
              visitQualifiedName(d, true);
            } else {
              switch (d.name) {
                case "double precision":
                case "character varying":
                case "bit varying":
                  ret.push(d.name, " ");
                  break;
                case "time without time zone":
                case "timestamp without time zone":
                case "time with time zone":
                case "timestamp with time zone":
                  const parts = d.name.split(" ");
                  ret.push(parts.shift());
                  if ((_a = d.config) === null || _a === undefined ? undefined : _a.length) {
                    list(d.config, (v) => ret.push(v.toString(10)), true);
                  }
                  ret.push(" ");
                  ret.push(parts.join(" "), " ");
                  appendConfig = false;
                  break;
                default:
                  visitQualifiedName(d);
                  break;
              }
            }
          }
          if (appendConfig && ((_b = d.config) === null || _b === undefined ? undefined : _b.length)) {
            list(d.config, (v) => ret.push(v.toString(10)), true);
          }
        },
        createIndex: (c) => {
          ret.push(c.unique ? "CREATE UNIQUE INDEX " : "CREATE INDEX ");
          if (c.concurrently) {
            ret.push("CONCURRENTLY ");
          }
          if (c.ifNotExists) {
            ret.push(" IF NOT EXISTS ");
          }
          if (c.indexName) {
            ret.push(name(c.indexName), " ");
          }
          ret.push("ON ");
          m.tableRef(c.table);
          if (c.using) {
            ret.push("USING ", name(c.using), " ");
          }
          list(c.expressions, (e) => {
            m.expr(e.expression);
            ret.push(" ");
            if (e.collate) {
              ret.push("COLLATE ");
              visitQualifiedName(e.collate);
            }
            if (e.opclass) {
              visitQualifiedName(e.opclass);
            }
            if (e.order) {
              ret.push(e.order, " ");
            }
            if (e.nulls) {
              ret.push("nulls ", e.nulls, " ");
            }
          }, true);
          if (c.with) {
            ret.push("WITH ");
            list(c.with, (w) => {
              ret.push(w.parameter, " = ", (0, pg_escape_1.literal)(w.value));
            }, true);
          }
          if (c.tablespace) {
            ret.push("TABLESPACE ", ident(c.tablespace));
          }
          if (c.where) {
            ret.push(" WHERE ");
            m.expr(c.where);
          }
          ret.push(" ");
        },
        createTable: (t) => {
          var _a;
          ret.push("CREATE ");
          if (t.locality) {
            ret.push(t.locality.toUpperCase(), " ");
          }
          if (t.temporary) {
            ret.push("TEMPORARY ");
          }
          if (t.unlogged) {
            ret.push("UNLOGGED ");
          }
          ret.push(t.ifNotExists ? "TABLE IF NOT EXISTS " : "TABLE ");
          m.tableRef(t.name);
          ret.push("(");
          list(t.columns, (c) => {
            switch (c.kind) {
              case "column":
                return m.createColumn(c);
              case "like table":
                return m.likeTable(c);
              default:
                throw utils_1.NotSupported.never(c);
            }
          }, false);
          if (t.constraints) {
            ret.push(", ");
            list(t.constraints, (c) => {
              const cname = c.constraintName;
              if (cname) {
                ret.push("CONSTRAINT ", name(cname), " ");
              }
              addConstraint(c, m);
            }, false);
          }
          ret.push(") ");
          if ((_a = t.inherits) === null || _a === undefined ? undefined : _a.length) {
            ret.push(" INHERITS ");
            list(t.inherits, (i) => visitQualifiedName(i), true);
          }
        },
        likeTable: (l) => {
          ret.push(" LIKE ");
          m.tableRef(l.like);
          ret.push(" ");
          for (const { verb, option } of l.options) {
            ret.push(verb.toUpperCase(), " ", option.toUpperCase(), " ");
          }
        },
        createSchema: (s) => {
          ret.push(s.ifNotExists ? "CREATE SCHEMA IF NOT EXISTS " : "CREATE SCHEMA ");
          ret.push(name(s.name));
        },
        truncateTable: (t) => {
          ret.push("TRUNCATE TABLE ");
          let first = true;
          for (const tbl of t.tables) {
            if (!first) {
              ret.push(", ");
            }
            first = false;
            m.tableRef(tbl);
          }
          if (t.identity) {
            switch (t.identity) {
              case "restart":
                ret.push(" RESTART IDENTITY ");
                break;
              case "continue":
                ret.push(" CONTINUE IDENTITY ");
                break;
            }
          }
          if (t.cascade) {
            ret.push(" ", t.cascade, " ");
          }
        },
        delete: (t) => {
          ret.push("DELETE FROM ");
          m.tableRef(t.from);
          if (t.where) {
            ret.push(" WHERE ");
            m.expr(t.where);
          }
          if (t.returning) {
            ret.push(" RETURNING ");
            list(t.returning, (r) => m.selectionColumn(r), false);
          }
          ret.push(" ");
        },
        dropColumn: (t) => {
          ret.push(" DROP COLUMN ");
          if (t.ifExists) {
            ret.push(" IF EXISTS ");
          }
          ret.push(name(t.column));
          if (t.behaviour) {
            ret.push(" ", t.behaviour);
          }
          ret.push(" ");
        },
        dropConstraint: (t) => {
          ret.push(" DROP CONSTRAINT ");
          if (t.ifExists) {
            ret.push(" IF EXISTS ");
          }
          ret.push(name(t.constraint));
          if (t.behaviour) {
            ret.push(" ", t.behaviour.toUpperCase(), " ");
          }
        },
        from: (t) => m.super().from(t),
        fromCall: (s) => {
          join(m, s.join, () => {
            var _a, _b;
            if (s.lateral) {
              ret.push("LATERAL ");
            }
            m.call(s);
            if (s.withOrdinality) {
              ret.push(" WITH ORDINALITY");
            }
            if (s.alias) {
              ret.push(" AS ", name(s.alias), " ");
              const len = (_b = (_a = s.alias.columns) === null || _a === undefined ? undefined : _a.length) !== null && _b !== undefined ? _b : 0;
              if (len > 0) {
                ret.push("(");
                for (let ix = 0;ix < len; ++ix) {
                  if (ix !== 0) {
                    ret.push(", ");
                  }
                  ret.push(name(s.alias.columns[ix]));
                }
                ret.push(")");
              }
            }
          });
          ret.push(" ");
        },
        fromStatement: (s) => {
          join(m, s.join, () => {
            if (s.lateral) {
              ret.push("LATERAL ");
            }
            ret.push("(");
            m.select(s.statement);
            ret.push(") ");
            if (s.alias) {
              ret.push(" AS ", ident(s.alias));
              if (s.columnNames) {
                list(s.columnNames, (c) => ret.push(name(c)), true);
              }
              ret.push(" ");
            }
          });
          ret.push(" ");
        },
        values: (s) => {
          ret.push("VALUES ");
          list(s.values, (vlist) => {
            list(vlist, (e) => {
              m.expr(e);
            }, true);
          }, false);
        },
        fromTable: (s) => {
          join(m, s.join, () => {
            m.tableRef(s.name);
            if (s.name.columnNames) {
              if (!s.name.alias) {
                throw new Error("Cannot specify aliased column names without an alias");
              }
              list(s.name.columnNames, (c) => ret.push(name(c)), true);
            }
          });
        },
        join: (j) => {
          throw new Error("Should not happen \uD83D\uDC80");
        },
        insert: (i) => {
          ret.push("INSERT INTO ");
          m.tableRef(i.into);
          if (i.columns) {
            ret.push("(", i.columns.map(name).join(", "), ")");
          }
          ret.push(" ");
          if (i.overriding) {
            ret.push("OVERRIDING ", i.overriding.toUpperCase(), " VALUE ");
          }
          m.select(i.insert);
          ret.push(" ");
          if (i.onConflict) {
            ret.push("ON CONFLICT ");
            const on2 = i.onConflict.on;
            switch (on2 === null || on2 === undefined ? undefined : on2.type) {
              case "on expr":
                list(on2.exprs, (e) => m.expr(e), true);
                break;
              case "on constraint":
                ret.push("ON CONSTRAINT ");
                visitQualifiedName(on2.constraint);
              case null:
              case undefined:
                break;
              default:
                throw utils_1.NotSupported.never(on2);
            }
            if (i.onConflict.do === "do nothing") {
              ret.push(" DO NOTHING");
            } else {
              ret.push(" DO UPDATE SET ");
              list(i.onConflict.do.sets, (s) => m.set(s), false);
              if (i.onConflict.where) {
                ret.push(" WHERE ");
                m.expr(i.onConflict.where);
              }
            }
            ret.push(" ");
          }
          if (i.returning) {
            ret.push(" RETURNING ");
            list(i.returning, (r) => m.selectionColumn(r), false);
          }
        },
        raise: (r) => {
          var _a, _b;
          ret.push("RAISE ");
          if (r.level) {
            ret.push(r.level.toUpperCase(), " ");
          }
          ret.push((0, pg_escape_1.literal)(r.format), " ");
          if ((_a = r.formatExprs) === null || _a === undefined ? undefined : _a.length) {
            ret.push(", ");
            list(r.formatExprs, (e) => m.expr(e), false);
          }
          if ((_b = r.using) === null || _b === undefined ? undefined : _b.length) {
            ret.push(" USING ");
            list(r.using, ({ type, value: value2 }) => {
              ret.push(type.toUpperCase(), "=");
              m.expr(value2);
            }, false);
          }
          ret.push(" ");
        },
        default: () => {
          ret.push(" DEFAULT ");
        },
        member: (e) => {
          m.expr(e.operand);
          ret.push(e.op);
          ret.push(typeof e.member === "number" ? e.member.toString(10) : (0, pg_escape_1.literal)(e.member));
        },
        ref: (r) => {
          if (r.table) {
            visitQualifiedName(r.table);
            ret.push(".");
          }
          ret.push(r.name === "*" ? "*" : ident(r.name));
        },
        parameter: (p) => {
          ret.push(p.name);
        },
        renameColumn: (r) => {
          ret.push(" RENAME COLUMN ", name(r.column), " TO ", name(r.to));
        },
        renameConstraint: (r) => {
          ret.push(" RENAME CONSTRAINT ", name(r.constraint), " TO ", name(r.to));
        },
        renameTable: (r) => {
          ret.push(" RENAME TO ", name(r.to));
        },
        createView: (c) => {
          ret.push("CREATE ");
          if (c.orReplace) {
            ret.push("OR REPLACE ");
          }
          if (c.temp) {
            ret.push("TEMP ");
          }
          if (c.recursive) {
            ret.push("RECURSIVE ");
          }
          ret.push("VIEW ");
          m.tableRef(c.name);
          if (c.columnNames) {
            list(c.columnNames, (c2) => ret.push(name(c2)), true);
          }
          const opts = c.parameters && Object.entries(c.parameters);
          if (opts === null || opts === undefined ? undefined : opts.length) {
            ret.push(" WITH ");
            list(opts, ([k, v]) => ret.push(k, "=", v), false);
          }
          ret.push(" AS ");
          m.select(c.query);
          if (c.checkOption) {
            ret.push(" WITH ", c.checkOption.toUpperCase(), " CHECK OPTION");
          }
        },
        createMaterializedView: (c) => {
          ret.push("CREATE MATERIALIZED VIEW ");
          if (c.ifNotExists) {
            ret.push("IF NOT EXISTS ");
          }
          m.tableRef(c.name);
          if (c.columnNames) {
            list(c.columnNames, (c2) => ret.push(name(c2)), true);
          }
          const opts = c.parameters && Object.entries(c.parameters);
          if (opts === null || opts === undefined ? undefined : opts.length) {
            ret.push(" WITH ");
            list(opts, ([k, v]) => ret.push(k, "=", v), false);
          }
          if (c.tablespace) {
            ret.push(" TABLESPACE ", name(c.tablespace));
          }
          ret.push(" AS ");
          m.select(c.query);
          if (typeof c.withData === "boolean") {
            ret.push(c.withData ? " WITH DATA" : " WITH NO DATA");
          }
        },
        refreshMaterializedView: (val) => {
          ret.push("REFRESH MATERIALIZED VIEW ");
          if (val.concurrently) {
            ret.push("CONCURRENTLY ");
          }
          m.tableRef(val.name);
          if (typeof val.withData === "boolean") {
            ret.push(val.withData ? " WITH DATA" : " WITH NO DATA");
          }
        },
        select: (s) => m.super().select(s),
        selection: (s) => {
          ret.push("SELECT ");
          if (s.distinct) {
            if (typeof s.distinct === "string") {
              ret.push(s.distinct.toUpperCase());
            } else {
              ret.push(" DISTINCT ON ");
              list(s.distinct, (v) => m.expr(v), true);
            }
            ret.push(" ");
          }
          if (s.columns) {
            list(s.columns, (c) => m.selectionColumn(c), false);
          }
          ret.push(" ");
          if (s.from) {
            ret.push("FROM ");
            const tblCnt = s.from.length;
            for (let i = 0;i < tblCnt; i++) {
              const f = s.from[i];
              if (i > 0 && !f.join) {
                ret.push(",");
              }
              m.from(f);
            }
            ret.push(" ");
          }
          if (s.where) {
            ret.push("WHERE ");
            m.expr(s.where);
            ret.push(" ");
          }
          if (s.groupBy) {
            ret.push("GROUP BY ");
            list(s.groupBy, (e) => m.expr(e), false);
            ret.push(" ");
            if (s.having) {
              ret.push(" HAVING ");
              m.expr(s.having);
              ret.push(" ");
            }
          }
          if (s.orderBy) {
            visitOrderBy(m, s.orderBy);
            ret.push(" ");
          }
          if (s.limit) {
            if (s.limit.offset) {
              ret.push(`OFFSET `);
              m.expr(s.limit.offset);
            }
            if (s.limit.limit) {
              ret.push(`LIMIT `);
              m.expr(s.limit.limit);
            }
          }
          if (s.for) {
            ret.push("FOR ", s.for.type.toUpperCase());
            if (s.skip) {
              ret.push(" ", s.skip.type.toUpperCase());
            }
          }
        },
        show: (s) => {
          ret.push("SHOW ", name(s.variable));
        },
        prepare: (s) => {
          var _a;
          ret.push("PREPARE ", name(s.name));
          if ((_a = s.args) === null || _a === undefined ? undefined : _a.length) {
            list(s.args, (a) => m.dataType(a), true);
          }
          ret.push(" AS ");
          m.statement(s.statement);
        },
        deallocate: (s) => {
          ret.push("DEALLOCATE ");
          if ("name" in s.target) {
            ret.push(s.target.name);
            return;
          }
          ret.push("ALL");
        },
        arraySelect: (s) => {
          ret.push("array(");
          m.select(s.select);
          ret.push(")");
        },
        union: (s) => {
          ret.push("(");
          m.statement(s.left);
          ret.push(") ", s.type.toUpperCase(), " ");
          if (s.right.type === "union" || s.right.type === "union all") {
            m.union(s.right);
          } else {
            ret.push("(");
            m.statement(s.right);
            ret.push(")");
          }
        },
        selectionColumn: (c) => {
          m.expr(c.expr);
          if (c.alias) {
            ret.push(" AS ", name(c.alias));
          }
          ret.push(" ");
        },
        set: (s) => {
          ret.push(name(s.column), " = ");
          m.expr(s.value);
          ret.push(" ");
        },
        statement: (s) => m.super().statement(s),
        tableRef: (r) => {
          visitQualifiedName(r);
          if (r.alias) {
            ret.push(" AS ", ident(r.alias));
          }
          ret.push(" ");
        },
        ternary: (t) => {
          m.expr(t.value);
          ret.push(" ", t.op, " ");
          m.expr(t.lo);
          ret.push(" AND ");
          m.expr(t.hi);
          ret.push(" ");
        },
        transaction: (t) => {
          ret.push(t.type);
        },
        unary: (t) => {
          switch (t.op) {
            case "+":
            case "-":
              visitOp(t);
              m.expr(t.operand);
              break;
            case "NOT":
              ret.push(t.op);
              ret.push(" ");
              m.expr(t.operand);
              break;
            default:
              m.expr(t.operand);
              ret.push(" ");
              ret.push(t.op);
          }
        },
        update: (u) => {
          ret.push("UPDATE ");
          m.tableRef(u.table);
          ret.push(" SET ");
          list(u.sets, (s) => m.set(s), false);
          ret.push(" ");
          if (u.from) {
            ret.push("FROM ");
            m.from(u.from);
            ret.push(" ");
          }
          if (u.where) {
            ret.push("WHERE ");
            m.expr(u.where);
            ret.push(" ");
          }
          if (u.returning) {
            ret.push(" RETURNING ");
            list(u.returning, (r) => m.selectionColumn(r), false);
            ret.push(" ");
          }
        }
      }));
      exports2.toSql = {};
      const proto = ast_mapper_1.AstDefaultMapper.prototype;
      for (const k of Object.getOwnPropertyNames(proto)) {
        const orig = proto[k];
        if (k === "constructor" || k === "super" || typeof orig !== "function") {
          continue;
        }
        exports2.toSql[k] = function(...args) {
          try {
            visitor[k].apply(visitor, args);
            return ret.join("").trim();
          } finally {
            ret = [];
          }
        };
      }
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.literal = undefined;
      function literal(val) {
        if (val == null)
          return "NULL";
        if (Array.isArray(val)) {
          var vals = val.map(literal);
          return "(" + vals.join(", ") + ")";
        }
        var backslash = ~val.indexOf("\\");
        var prefix = backslash ? "E" : "";
        val = val.replace(/'/g, "''");
        val = val.replace(/\\/g, "\\\\");
        return prefix + "'" + val + "'";
      }
      exports2.literal = literal;
    },
    function(module2, exports2, __webpack_require__) {
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.locationOf = undefined;
      function locationOf(node) {
        const n = node._location;
        if (!n) {
          throw new Error("This statement has not been parsed using location tracking (which has a small performance hit). ");
        }
        return n;
      }
      exports2.locationOf = locationOf;
    }
  ]));
});

// ../node_modules/solid-js/dist/dev.js
var sharedConfig = {
  context: undefined,
  registry: undefined,
  effects: undefined,
  done: false,
  getContextId() {
    return getContextId(this.context.count);
  },
  getNextContextId() {
    return getContextId(this.context.count++);
  }
};
function getContextId(count) {
  const num = String(count), len = num.length - 1;
  return sharedConfig.context.id + (len ? String.fromCharCode(96 + len) : "") + num;
}
function setHydrateContext(context) {
  sharedConfig.context = context;
}
function nextHydrateContext() {
  return {
    ...sharedConfig.context,
    id: sharedConfig.getNextContextId(),
    count: 0
  };
}
var IS_DEV = true;
var equalFn = (a, b) => a === b;
var $PROXY = Symbol("solid-proxy");
var SUPPORTS_PROXY = typeof Proxy === "function";
var $TRACK = Symbol("solid-track");
var $DEVCOMP = Symbol("solid-dev-component");
var signalOptions = {
  equals: equalFn
};
var ERROR = null;
var runEffects = runQueue;
var STALE = 1;
var PENDING = 2;
var UNOWNED = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
var Owner = null;
var Transition = null;
var Scheduler = null;
var ExternalSourceConfig = null;
var Listener = null;
var Updates = null;
var Effects = null;
var ExecCount = 0;
var DevHooks = {
  afterUpdate: null,
  afterCreateOwner: null,
  afterCreateSignal: null,
  afterRegisterGraph: null
};
function createRoot(fn, detachedOwner) {
  const listener = Listener, owner = Owner, unowned = fn.length === 0, current = detachedOwner === undefined ? owner : detachedOwner, root = unowned ? {
    owned: null,
    cleanups: null,
    context: null,
    owner: null
  } : {
    owned: null,
    cleanups: null,
    context: current ? current.context : null,
    owner: current
  }, updateFn = unowned ? () => fn(() => {
    throw new Error("Dispose method must be an explicit argument to createRoot function");
  }) : () => fn(() => untrack(() => cleanNode(root)));
  DevHooks.afterCreateOwner && DevHooks.afterCreateOwner(root);
  Owner = root;
  Listener = null;
  try {
    return runUpdates(updateFn, true);
  } finally {
    Listener = listener;
    Owner = owner;
  }
}
function createSignal(value2, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const s = {
    value: value2,
    observers: null,
    observerSlots: null,
    comparator: options.equals || undefined
  };
  {
    if (options.name)
      s.name = options.name;
    if (options.internal) {
      s.internal = true;
    } else {
      registerGraph(s);
      if (DevHooks.afterCreateSignal)
        DevHooks.afterCreateSignal(s);
    }
  }
  const setter = (value3) => {
    if (typeof value3 === "function") {
      if (Transition && Transition.running && Transition.sources.has(s))
        value3 = value3(s.tValue);
      else
        value3 = value3(s.value);
    }
    return writeSignal(s, value3);
  };
  return [readSignal.bind(s), setter];
}
function createRenderEffect(fn, value2, options) {
  const c = createComputation(fn, value2, false, STALE, options);
  if (Scheduler && Transition && Transition.running)
    Updates.push(c);
  else
    updateComputation(c);
}
function createEffect(fn, value2, options) {
  runEffects = runUserEffects;
  const c = createComputation(fn, value2, false, STALE, options), s = SuspenseContext && useContext(SuspenseContext);
  if (s)
    c.suspense = s;
  if (!options || !options.render)
    c.user = true;
  Effects ? Effects.push(c) : updateComputation(c);
}
function createMemo(fn, value2, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const c = createComputation(fn, value2, true, 0, options);
  c.observers = null;
  c.observerSlots = null;
  c.comparator = options.equals || undefined;
  if (Scheduler && Transition && Transition.running) {
    c.tState = STALE;
    Updates.push(c);
  } else
    updateComputation(c);
  return readSignal.bind(c);
}
function batch(fn) {
  return runUpdates(fn, false);
}
function untrack(fn) {
  if (!ExternalSourceConfig && Listener === null)
    return fn();
  const listener = Listener;
  Listener = null;
  try {
    if (ExternalSourceConfig)
      return ExternalSourceConfig.untrack(fn);
    return fn();
  } finally {
    Listener = listener;
  }
}
function on(deps, fn, options) {
  const isArray = Array.isArray(deps);
  let prevInput;
  let defer = options && options.defer;
  return (prevValue) => {
    let input;
    if (isArray) {
      input = Array(deps.length);
      for (let i = 0;i < deps.length; i++)
        input[i] = deps[i]();
    } else
      input = deps();
    if (defer) {
      defer = false;
      return prevValue;
    }
    const result = untrack(() => fn(input, prevInput, prevValue));
    prevInput = input;
    return result;
  };
}
function onMount(fn) {
  createEffect(() => untrack(fn));
}
function onCleanup(fn) {
  if (Owner === null)
    console.warn("cleanups created outside a `createRoot` or `render` will never be run");
  else if (Owner.cleanups === null)
    Owner.cleanups = [fn];
  else
    Owner.cleanups.push(fn);
  return fn;
}
function getListener() {
  return Listener;
}
function getOwner() {
  return Owner;
}
function runWithOwner(o, fn) {
  const prev = Owner;
  const prevListener = Listener;
  Owner = o;
  Listener = null;
  try {
    return runUpdates(fn, true);
  } catch (err) {
    handleError(err);
  } finally {
    Owner = prev;
    Listener = prevListener;
  }
}
function startTransition(fn) {
  if (Transition && Transition.running) {
    fn();
    return Transition.done;
  }
  const l = Listener;
  const o = Owner;
  return Promise.resolve().then(() => {
    Listener = l;
    Owner = o;
    let t;
    if (Scheduler || SuspenseContext) {
      t = Transition || (Transition = {
        sources: new Set,
        effects: [],
        promises: new Set,
        disposed: new Set,
        queue: new Set,
        running: true
      });
      t.done || (t.done = new Promise((res) => t.resolve = res));
      t.running = true;
    }
    runUpdates(fn, false);
    Listener = Owner = null;
    return t ? t.done : undefined;
  });
}
var [transPending, setTransPending] = /* @__PURE__ */ createSignal(false);
function devComponent(Comp, props) {
  const c = createComputation(() => untrack(() => {
    Object.assign(Comp, {
      [$DEVCOMP]: true
    });
    return Comp(props);
  }), undefined, true, 0);
  c.props = props;
  c.observers = null;
  c.observerSlots = null;
  c.name = Comp.name;
  c.component = Comp;
  updateComputation(c);
  return c.tValue !== undefined ? c.tValue : c.value;
}
function registerGraph(value2) {
  if (Owner) {
    if (Owner.sourceMap)
      Owner.sourceMap.push(value2);
    else
      Owner.sourceMap = [value2];
    value2.graph = Owner;
  }
  if (DevHooks.afterRegisterGraph)
    DevHooks.afterRegisterGraph(value2);
}
function createContext(defaultValue, options) {
  const id = Symbol("context");
  return {
    id,
    Provider: createProvider(id, options),
    defaultValue
  };
}
function useContext(context) {
  let value2;
  return Owner && Owner.context && (value2 = Owner.context[context.id]) !== undefined ? value2 : context.defaultValue;
}
function children(fn) {
  const children2 = createMemo(fn);
  const memo = createMemo(() => resolveChildren(children2()), undefined, {
    name: "children"
  });
  memo.toArray = () => {
    const c = memo();
    return Array.isArray(c) ? c : c != null ? [c] : [];
  };
  return memo;
}
var SuspenseContext;
function readSignal() {
  const runningTransition = Transition && Transition.running;
  if (this.sources && (runningTransition ? this.tState : this.state)) {
    if ((runningTransition ? this.tState : this.state) === STALE)
      updateComputation(this);
    else {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(this), false);
      Updates = updates;
    }
  }
  if (Listener) {
    const sSlot = this.observers ? this.observers.length : 0;
    if (!Listener.sources) {
      Listener.sources = [this];
      Listener.sourceSlots = [sSlot];
    } else {
      Listener.sources.push(this);
      Listener.sourceSlots.push(sSlot);
    }
    if (!this.observers) {
      this.observers = [Listener];
      this.observerSlots = [Listener.sources.length - 1];
    } else {
      this.observers.push(Listener);
      this.observerSlots.push(Listener.sources.length - 1);
    }
  }
  if (runningTransition && Transition.sources.has(this))
    return this.tValue;
  return this.value;
}
function writeSignal(node, value2, isComp) {
  let current = Transition && Transition.running && Transition.sources.has(node) ? node.tValue : node.value;
  if (!node.comparator || !node.comparator(current, value2)) {
    if (Transition) {
      const TransitionRunning = Transition.running;
      if (TransitionRunning || !isComp && Transition.sources.has(node)) {
        Transition.sources.add(node);
        node.tValue = value2;
      }
      if (!TransitionRunning)
        node.value = value2;
    } else
      node.value = value2;
    if (node.observers && node.observers.length) {
      runUpdates(() => {
        for (let i = 0;i < node.observers.length; i += 1) {
          const o = node.observers[i];
          const TransitionRunning = Transition && Transition.running;
          if (TransitionRunning && Transition.disposed.has(o))
            continue;
          if (TransitionRunning ? !o.tState : !o.state) {
            if (o.pure)
              Updates.push(o);
            else
              Effects.push(o);
            if (o.observers)
              markDownstream(o);
          }
          if (!TransitionRunning)
            o.state = STALE;
          else
            o.tState = STALE;
        }
        if (Updates.length > 1e6) {
          Updates = [];
          if (IS_DEV)
            throw new Error("Potential Infinite Loop Detected.");
          throw new Error;
        }
      }, false);
    }
  }
  return value2;
}
function updateComputation(node) {
  if (!node.fn)
    return;
  cleanNode(node);
  const time = ExecCount;
  runComputation(node, Transition && Transition.running && Transition.sources.has(node) ? node.tValue : node.value, time);
  if (Transition && !Transition.running && Transition.sources.has(node)) {
    queueMicrotask(() => {
      runUpdates(() => {
        Transition && (Transition.running = true);
        Listener = Owner = node;
        runComputation(node, node.tValue, time);
        Listener = Owner = null;
      }, false);
    });
  }
}
function runComputation(node, value2, time) {
  let nextValue;
  const owner = Owner, listener = Listener;
  Listener = Owner = node;
  try {
    nextValue = node.fn(value2);
  } catch (err) {
    if (node.pure) {
      if (Transition && Transition.running) {
        node.tState = STALE;
        node.tOwned && node.tOwned.forEach(cleanNode);
        node.tOwned = undefined;
      } else {
        node.state = STALE;
        node.owned && node.owned.forEach(cleanNode);
        node.owned = null;
      }
    }
    node.updatedAt = time + 1;
    return handleError(err);
  } finally {
    Listener = listener;
    Owner = owner;
  }
  if (!node.updatedAt || node.updatedAt <= time) {
    if (node.updatedAt != null && "observers" in node) {
      writeSignal(node, nextValue, true);
    } else if (Transition && Transition.running && node.pure) {
      Transition.sources.add(node);
      node.tValue = nextValue;
    } else
      node.value = nextValue;
    node.updatedAt = time;
  }
}
function createComputation(fn, init, pure, state = STALE, options) {
  const c = {
    fn,
    state,
    updatedAt: null,
    owned: null,
    sources: null,
    sourceSlots: null,
    cleanups: null,
    value: init,
    owner: Owner,
    context: Owner ? Owner.context : null,
    pure
  };
  if (Transition && Transition.running) {
    c.state = 0;
    c.tState = state;
  }
  if (Owner === null)
    console.warn("computations created outside a `createRoot` or `render` will never be disposed");
  else if (Owner !== UNOWNED) {
    if (Transition && Transition.running && Owner.pure) {
      if (!Owner.tOwned)
        Owner.tOwned = [c];
      else
        Owner.tOwned.push(c);
    } else {
      if (!Owner.owned)
        Owner.owned = [c];
      else
        Owner.owned.push(c);
    }
  }
  if (options && options.name)
    c.name = options.name;
  if (ExternalSourceConfig && c.fn) {
    const [track, trigger] = createSignal(undefined, {
      equals: false
    });
    const ordinary = ExternalSourceConfig.factory(c.fn, trigger);
    onCleanup(() => ordinary.dispose());
    const triggerInTransition = () => startTransition(trigger).then(() => inTransition.dispose());
    const inTransition = ExternalSourceConfig.factory(c.fn, triggerInTransition);
    c.fn = (x) => {
      track();
      return Transition && Transition.running ? inTransition.track(x) : ordinary.track(x);
    };
  }
  DevHooks.afterCreateOwner && DevHooks.afterCreateOwner(c);
  return c;
}
function runTop(node) {
  const runningTransition = Transition && Transition.running;
  if ((runningTransition ? node.tState : node.state) === 0)
    return;
  if ((runningTransition ? node.tState : node.state) === PENDING)
    return lookUpstream(node);
  if (node.suspense && untrack(node.suspense.inFallback))
    return node.suspense.effects.push(node);
  const ancestors = [node];
  while ((node = node.owner) && (!node.updatedAt || node.updatedAt < ExecCount)) {
    if (runningTransition && Transition.disposed.has(node))
      return;
    if (runningTransition ? node.tState : node.state)
      ancestors.push(node);
  }
  for (let i = ancestors.length - 1;i >= 0; i--) {
    node = ancestors[i];
    if (runningTransition) {
      let top = node, prev = ancestors[i + 1];
      while ((top = top.owner) && top !== prev) {
        if (Transition.disposed.has(top))
          return;
      }
    }
    if ((runningTransition ? node.tState : node.state) === STALE) {
      updateComputation(node);
    } else if ((runningTransition ? node.tState : node.state) === PENDING) {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(node, ancestors[0]), false);
      Updates = updates;
    }
  }
}
function runUpdates(fn, init) {
  if (Updates)
    return fn();
  let wait = false;
  if (!init)
    Updates = [];
  if (Effects)
    wait = true;
  else
    Effects = [];
  ExecCount++;
  try {
    const res = fn();
    completeUpdates(wait);
    return res;
  } catch (err) {
    if (!wait)
      Effects = null;
    Updates = null;
    handleError(err);
  }
}
function completeUpdates(wait) {
  if (Updates) {
    if (Scheduler && Transition && Transition.running)
      scheduleQueue(Updates);
    else
      runQueue(Updates);
    Updates = null;
  }
  if (wait)
    return;
  let res;
  if (Transition) {
    if (!Transition.promises.size && !Transition.queue.size) {
      const sources = Transition.sources;
      const disposed = Transition.disposed;
      Effects.push.apply(Effects, Transition.effects);
      res = Transition.resolve;
      for (const e2 of Effects) {
        "tState" in e2 && (e2.state = e2.tState);
        delete e2.tState;
      }
      Transition = null;
      runUpdates(() => {
        for (const d of disposed)
          cleanNode(d);
        for (const v of sources) {
          v.value = v.tValue;
          if (v.owned) {
            for (let i = 0, len = v.owned.length;i < len; i++)
              cleanNode(v.owned[i]);
          }
          if (v.tOwned)
            v.owned = v.tOwned;
          delete v.tValue;
          delete v.tOwned;
          v.tState = 0;
        }
        setTransPending(false);
      }, false);
    } else if (Transition.running) {
      Transition.running = false;
      Transition.effects.push.apply(Transition.effects, Effects);
      Effects = null;
      setTransPending(true);
      return;
    }
  }
  const e = Effects;
  Effects = null;
  if (e.length)
    runUpdates(() => runEffects(e), false);
  else
    DevHooks.afterUpdate && DevHooks.afterUpdate();
  if (res)
    res();
}
function runQueue(queue) {
  for (let i = 0;i < queue.length; i++)
    runTop(queue[i]);
}
function scheduleQueue(queue) {
  for (let i = 0;i < queue.length; i++) {
    const item = queue[i];
    const tasks = Transition.queue;
    if (!tasks.has(item)) {
      tasks.add(item);
      Scheduler(() => {
        tasks.delete(item);
        runUpdates(() => {
          Transition.running = true;
          runTop(item);
        }, false);
        Transition && (Transition.running = false);
      });
    }
  }
}
function runUserEffects(queue) {
  let i, userLength = 0;
  for (i = 0;i < queue.length; i++) {
    const e = queue[i];
    if (!e.user)
      runTop(e);
    else
      queue[userLength++] = e;
  }
  if (sharedConfig.context) {
    if (sharedConfig.count) {
      sharedConfig.effects || (sharedConfig.effects = []);
      sharedConfig.effects.push(...queue.slice(0, userLength));
      return;
    }
    setHydrateContext();
  }
  if (sharedConfig.effects && (sharedConfig.done || !sharedConfig.count)) {
    queue = [...sharedConfig.effects, ...queue];
    userLength += sharedConfig.effects.length;
    delete sharedConfig.effects;
  }
  for (i = 0;i < userLength; i++)
    runTop(queue[i]);
}
function lookUpstream(node, ignore) {
  const runningTransition = Transition && Transition.running;
  if (runningTransition)
    node.tState = 0;
  else
    node.state = 0;
  for (let i = 0;i < node.sources.length; i += 1) {
    const source = node.sources[i];
    if (source.sources) {
      const state = runningTransition ? source.tState : source.state;
      if (state === STALE) {
        if (source !== ignore && (!source.updatedAt || source.updatedAt < ExecCount))
          runTop(source);
      } else if (state === PENDING)
        lookUpstream(source, ignore);
    }
  }
}
function markDownstream(node) {
  const runningTransition = Transition && Transition.running;
  for (let i = 0;i < node.observers.length; i += 1) {
    const o = node.observers[i];
    if (runningTransition ? !o.tState : !o.state) {
      if (runningTransition)
        o.tState = PENDING;
      else
        o.state = PENDING;
      if (o.pure)
        Updates.push(o);
      else
        Effects.push(o);
      o.observers && markDownstream(o);
    }
  }
}
function cleanNode(node) {
  let i;
  if (node.sources) {
    while (node.sources.length) {
      const source = node.sources.pop(), index = node.sourceSlots.pop(), obs = source.observers;
      if (obs && obs.length) {
        const n = obs.pop(), s = source.observerSlots.pop();
        if (index < obs.length) {
          n.sourceSlots[s] = index;
          obs[index] = n;
          source.observerSlots[index] = s;
        }
      }
    }
  }
  if (node.tOwned) {
    for (i = node.tOwned.length - 1;i >= 0; i--)
      cleanNode(node.tOwned[i]);
    delete node.tOwned;
  }
  if (Transition && Transition.running && node.pure) {
    reset(node, true);
  } else if (node.owned) {
    for (i = node.owned.length - 1;i >= 0; i--)
      cleanNode(node.owned[i]);
    node.owned = null;
  }
  if (node.cleanups) {
    for (i = node.cleanups.length - 1;i >= 0; i--)
      node.cleanups[i]();
    node.cleanups = null;
  }
  if (Transition && Transition.running)
    node.tState = 0;
  else
    node.state = 0;
  delete node.sourceMap;
}
function reset(node, top) {
  if (!top) {
    node.tState = 0;
    Transition.disposed.add(node);
  }
  if (node.owned) {
    for (let i = 0;i < node.owned.length; i++)
      reset(node.owned[i]);
  }
}
function castError(err) {
  if (err instanceof Error)
    return err;
  return new Error(typeof err === "string" ? err : "Unknown error", {
    cause: err
  });
}
function runErrors(err, fns, owner) {
  try {
    for (const f of fns)
      f(err);
  } catch (e) {
    handleError(e, owner && owner.owner || null);
  }
}
function handleError(err, owner = Owner) {
  const fns = ERROR && owner && owner.context && owner.context[ERROR];
  const error = castError(err);
  if (!fns)
    throw error;
  if (Effects)
    Effects.push({
      fn() {
        runErrors(error, fns, owner);
      },
      state: STALE
    });
  else
    runErrors(error, fns, owner);
}
function resolveChildren(children2) {
  if (typeof children2 === "function" && !children2.length)
    return resolveChildren(children2());
  if (Array.isArray(children2)) {
    const results = [];
    for (let i = 0;i < children2.length; i++) {
      const result = resolveChildren(children2[i]);
      Array.isArray(result) ? results.push.apply(results, result) : results.push(result);
    }
    return results;
  }
  return children2;
}
function createProvider(id, options) {
  return function provider(props) {
    let res;
    createRenderEffect(() => res = untrack(() => {
      Owner.context = {
        ...Owner.context,
        [id]: props.value
      };
      return children(() => props.children);
    }), undefined, options);
    return res;
  };
}
var FALLBACK = Symbol("fallback");
function dispose(d) {
  for (let i = 0;i < d.length; i++)
    d[i]();
}
function mapArray(list, mapFn, options = {}) {
  let items = [], mapped = [], disposers = [], len = 0, indexes = mapFn.length > 1 ? [] : null;
  onCleanup(() => dispose(disposers));
  return () => {
    let newItems = list() || [], newLen = newItems.length, i, j;
    newItems[$TRACK];
    return untrack(() => {
      let newIndices, newIndicesNext, temp, tempdisposers, tempIndexes, start, end, newEnd, item;
      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          indexes && (indexes = []);
        }
        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot((disposer) => {
            disposers[0] = disposer;
            return options.fallback();
          });
          len = 1;
        }
      } else if (len === 0) {
        mapped = new Array(newLen);
        for (j = 0;j < newLen; j++) {
          items[j] = newItems[j];
          mapped[j] = createRoot(mapper);
        }
        len = newLen;
      } else {
        temp = new Array(newLen);
        tempdisposers = new Array(newLen);
        indexes && (tempIndexes = new Array(newLen));
        for (start = 0, end = Math.min(len, newLen);start < end && items[start] === newItems[start]; start++)
          ;
        for (end = len - 1, newEnd = newLen - 1;end >= start && newEnd >= start && items[end] === newItems[newEnd]; end--, newEnd--) {
          temp[newEnd] = mapped[end];
          tempdisposers[newEnd] = disposers[end];
          indexes && (tempIndexes[newEnd] = indexes[end]);
        }
        newIndices = new Map;
        newIndicesNext = new Array(newEnd + 1);
        for (j = newEnd;j >= start; j--) {
          item = newItems[j];
          i = newIndices.get(item);
          newIndicesNext[j] = i === undefined ? -1 : i;
          newIndices.set(item, j);
        }
        for (i = start;i <= end; i++) {
          item = items[i];
          j = newIndices.get(item);
          if (j !== undefined && j !== -1) {
            temp[j] = mapped[i];
            tempdisposers[j] = disposers[i];
            indexes && (tempIndexes[j] = indexes[i]);
            j = newIndicesNext[j];
            newIndices.set(item, j);
          } else
            disposers[i]();
        }
        for (j = start;j < newLen; j++) {
          if (j in temp) {
            mapped[j] = temp[j];
            disposers[j] = tempdisposers[j];
            if (indexes) {
              indexes[j] = tempIndexes[j];
              indexes[j](j);
            }
          } else
            mapped[j] = createRoot(mapper);
        }
        mapped = mapped.slice(0, len = newLen);
        items = newItems.slice(0);
      }
      return mapped;
    });
    function mapper(disposer) {
      disposers[j] = disposer;
      if (indexes) {
        const [s, set] = createSignal(j, {
          name: "index"
        });
        indexes[j] = set;
        return mapFn(newItems[j], s);
      }
      return mapFn(newItems[j]);
    }
  };
}
var hydrationEnabled = false;
function createComponent(Comp, props) {
  if (hydrationEnabled) {
    if (sharedConfig.context) {
      const c = sharedConfig.context;
      setHydrateContext(nextHydrateContext());
      const r = devComponent(Comp, props || {});
      setHydrateContext(c);
      return r;
    }
  }
  return devComponent(Comp, props || {});
}
function trueFn() {
  return true;
}
var propTraps = {
  get(_, property, receiver) {
    if (property === $PROXY)
      return receiver;
    return _.get(property);
  },
  has(_, property) {
    if (property === $PROXY)
      return true;
    return _.has(property);
  },
  set: trueFn,
  deleteProperty: trueFn,
  getOwnPropertyDescriptor(_, property) {
    return {
      configurable: true,
      enumerable: true,
      get() {
        return _.get(property);
      },
      set: trueFn,
      deleteProperty: trueFn
    };
  },
  ownKeys(_) {
    return _.keys();
  }
};
function resolveSource(s) {
  return !(s = typeof s === "function" ? s() : s) ? {} : s;
}
function resolveSources() {
  for (let i = 0, length = this.length;i < length; ++i) {
    const v = this[i]();
    if (v !== undefined)
      return v;
  }
}
function mergeProps(...sources) {
  let proxy = false;
  for (let i = 0;i < sources.length; i++) {
    const s = sources[i];
    proxy = proxy || !!s && $PROXY in s;
    sources[i] = typeof s === "function" ? (proxy = true, createMemo(s)) : s;
  }
  if (SUPPORTS_PROXY && proxy) {
    return new Proxy({
      get(property) {
        for (let i = sources.length - 1;i >= 0; i--) {
          const v = resolveSource(sources[i])[property];
          if (v !== undefined)
            return v;
        }
      },
      has(property) {
        for (let i = sources.length - 1;i >= 0; i--) {
          if (property in resolveSource(sources[i]))
            return true;
        }
        return false;
      },
      keys() {
        const keys = [];
        for (let i = 0;i < sources.length; i++)
          keys.push(...Object.keys(resolveSource(sources[i])));
        return [...new Set(keys)];
      }
    }, propTraps);
  }
  const sourcesMap = {};
  const defined = Object.create(null);
  for (let i = sources.length - 1;i >= 0; i--) {
    const source = sources[i];
    if (!source)
      continue;
    const sourceKeys = Object.getOwnPropertyNames(source);
    for (let i2 = sourceKeys.length - 1;i2 >= 0; i2--) {
      const key = sourceKeys[i2];
      if (key === "__proto__" || key === "constructor")
        continue;
      const desc = Object.getOwnPropertyDescriptor(source, key);
      if (!defined[key]) {
        defined[key] = desc.get ? {
          enumerable: true,
          configurable: true,
          get: resolveSources.bind(sourcesMap[key] = [desc.get.bind(source)])
        } : desc.value !== undefined ? desc : undefined;
      } else {
        const sources2 = sourcesMap[key];
        if (sources2) {
          if (desc.get)
            sources2.push(desc.get.bind(source));
          else if (desc.value !== undefined)
            sources2.push(() => desc.value);
        }
      }
    }
  }
  const target = {};
  const definedKeys = Object.keys(defined);
  for (let i = definedKeys.length - 1;i >= 0; i--) {
    const key = definedKeys[i], desc = defined[key];
    if (desc && desc.get)
      Object.defineProperty(target, key, desc);
    else
      target[key] = desc ? desc.value : undefined;
  }
  return target;
}
function splitProps(props, ...keys) {
  if (SUPPORTS_PROXY && $PROXY in props) {
    const blocked = new Set(keys.length > 1 ? keys.flat() : keys[0]);
    const res = keys.map((k) => {
      return new Proxy({
        get(property) {
          return k.includes(property) ? props[property] : undefined;
        },
        has(property) {
          return k.includes(property) && property in props;
        },
        keys() {
          return k.filter((property) => (property in props));
        }
      }, propTraps);
    });
    res.push(new Proxy({
      get(property) {
        return blocked.has(property) ? undefined : props[property];
      },
      has(property) {
        return blocked.has(property) ? false : (property in props);
      },
      keys() {
        return Object.keys(props).filter((k) => !blocked.has(k));
      }
    }, propTraps));
    return res;
  }
  const otherObject = {};
  const objects = keys.map(() => ({}));
  for (const propName of Object.getOwnPropertyNames(props)) {
    const desc = Object.getOwnPropertyDescriptor(props, propName);
    const isDefaultDesc = !desc.get && !desc.set && desc.enumerable && desc.writable && desc.configurable;
    let blocked = false;
    let objectIndex = 0;
    for (const k of keys) {
      if (k.includes(propName)) {
        blocked = true;
        isDefaultDesc ? objects[objectIndex][propName] = desc.value : Object.defineProperty(objects[objectIndex], propName, desc);
      }
      ++objectIndex;
    }
    if (!blocked) {
      isDefaultDesc ? otherObject[propName] = desc.value : Object.defineProperty(otherObject, propName, desc);
    }
  }
  return [...objects, otherObject];
}
var narrowedError = (name) => `Attempting to access a stale value from <${name}> that could possibly be undefined. This may occur because you are reading the accessor returned from the component at a time where it has already been unmounted. We recommend cleaning up any stale timers or async, or reading from the initial condition.`;
function For(props) {
  const fallback = "fallback" in props && {
    fallback: () => props.fallback
  };
  return createMemo(mapArray(() => props.each, props.children, fallback || undefined), undefined, {
    name: "value"
  });
}
function Show(props) {
  const keyed = props.keyed;
  const conditionValue = createMemo(() => props.when, undefined, {
    name: "condition value"
  });
  const condition = keyed ? conditionValue : createMemo(conditionValue, undefined, {
    equals: (a, b) => !a === !b,
    name: "condition"
  });
  return createMemo(() => {
    const c = condition();
    if (c) {
      const child = props.children;
      const fn = typeof child === "function" && child.length > 0;
      return fn ? untrack(() => child(keyed ? c : () => {
        if (!untrack(condition))
          throw narrowedError("Show");
        return conditionValue();
      })) : child;
    }
    return props.fallback;
  }, undefined, {
    name: "value"
  });
}
var Errors;
function resetErrorBoundaries() {
  Errors && [...Errors].forEach((fn) => fn());
}
var DEV = {
  hooks: DevHooks,
  writeSignal,
  registerGraph
};
if (globalThis) {
  if (!globalThis.Solid$$)
    globalThis.Solid$$ = true;
  else
    console.warn("You appear to have multiple instances of Solid. This can lead to unexpected behavior.");
}

// ../node_modules/solid-js/web/dist/dev.js
var booleans = [
  "allowfullscreen",
  "async",
  "alpha",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "disabled",
  "formnovalidate",
  "hidden",
  "indeterminate",
  "inert",
  "ismap",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "seamless",
  "selected",
  "adauctionheaders",
  "browsingtopics",
  "credentialless",
  "defaultchecked",
  "defaultmuted",
  "defaultselected",
  "defer",
  "disablepictureinpicture",
  "disableremoteplayback",
  "preservespitch",
  "shadowrootclonable",
  "shadowrootcustomelementregistry",
  "shadowrootdelegatesfocus",
  "shadowrootserializable",
  "sharedstoragewritable"
];
var Properties = /* @__PURE__ */ new Set([
  "className",
  "value",
  "readOnly",
  "noValidate",
  "formNoValidate",
  "isMap",
  "noModule",
  "playsInline",
  "adAuctionHeaders",
  "allowFullscreen",
  "browsingTopics",
  "defaultChecked",
  "defaultMuted",
  "defaultSelected",
  "disablePictureInPicture",
  "disableRemotePlayback",
  "preservesPitch",
  "shadowRootClonable",
  "shadowRootCustomElementRegistry",
  "shadowRootDelegatesFocus",
  "shadowRootSerializable",
  "sharedStorageWritable",
  ...booleans
]);
var ChildProperties = /* @__PURE__ */ new Set(["innerHTML", "textContent", "innerText", "children"]);
var Aliases = /* @__PURE__ */ Object.assign(Object.create(null), {
  className: "class",
  htmlFor: "for"
});
var PropAliases = /* @__PURE__ */ Object.assign(Object.create(null), {
  class: "className",
  novalidate: {
    $: "noValidate",
    FORM: 1
  },
  formnovalidate: {
    $: "formNoValidate",
    BUTTON: 1,
    INPUT: 1
  },
  ismap: {
    $: "isMap",
    IMG: 1
  },
  nomodule: {
    $: "noModule",
    SCRIPT: 1
  },
  playsinline: {
    $: "playsInline",
    VIDEO: 1
  },
  readonly: {
    $: "readOnly",
    INPUT: 1,
    TEXTAREA: 1
  },
  adauctionheaders: {
    $: "adAuctionHeaders",
    IFRAME: 1
  },
  allowfullscreen: {
    $: "allowFullscreen",
    IFRAME: 1
  },
  browsingtopics: {
    $: "browsingTopics",
    IMG: 1
  },
  defaultchecked: {
    $: "defaultChecked",
    INPUT: 1
  },
  defaultmuted: {
    $: "defaultMuted",
    AUDIO: 1,
    VIDEO: 1
  },
  defaultselected: {
    $: "defaultSelected",
    OPTION: 1
  },
  disablepictureinpicture: {
    $: "disablePictureInPicture",
    VIDEO: 1
  },
  disableremoteplayback: {
    $: "disableRemotePlayback",
    AUDIO: 1,
    VIDEO: 1
  },
  preservespitch: {
    $: "preservesPitch",
    AUDIO: 1,
    VIDEO: 1
  },
  shadowrootclonable: {
    $: "shadowRootClonable",
    TEMPLATE: 1
  },
  shadowrootdelegatesfocus: {
    $: "shadowRootDelegatesFocus",
    TEMPLATE: 1
  },
  shadowrootserializable: {
    $: "shadowRootSerializable",
    TEMPLATE: 1
  },
  sharedstoragewritable: {
    $: "sharedStorageWritable",
    IFRAME: 1,
    IMG: 1
  }
});
function getPropAlias(prop, tagName) {
  const a = PropAliases[prop];
  return typeof a === "object" ? a[tagName] ? a["$"] : undefined : a;
}
var DelegatedEvents = /* @__PURE__ */ new Set(["beforeinput", "click", "dblclick", "contextmenu", "focusin", "focusout", "input", "keydown", "keyup", "mousedown", "mousemove", "mouseout", "mouseover", "mouseup", "pointerdown", "pointermove", "pointerout", "pointerover", "pointerup", "touchend", "touchmove", "touchstart"]);
var SVGNamespace = {
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace"
};
var memo = (fn) => createMemo(() => fn());
function reconcileArrays(parentNode, a, b) {
  let bLength = b.length, aEnd = a.length, bEnd = bLength, aStart = 0, bStart = 0, after = a[aEnd - 1].nextSibling, map = null;
  while (aStart < aEnd || bStart < bEnd) {
    if (a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
      continue;
    }
    while (a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    if (aEnd === aStart) {
      const node = bEnd < bLength ? bStart ? b[bStart - 1].nextSibling : b[bEnd - bStart] : after;
      while (bStart < bEnd)
        parentNode.insertBefore(b[bStart++], node);
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        if (!map || !map.has(a[aStart]))
          a[aStart].remove();
        aStart++;
      }
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
      const node = a[--aEnd].nextSibling;
      parentNode.insertBefore(b[bStart++], a[aStart++].nextSibling);
      parentNode.insertBefore(b[--bEnd], node);
      a[aEnd] = b[bEnd];
    } else {
      if (!map) {
        map = new Map;
        let i = bStart;
        while (i < bEnd)
          map.set(b[i], i++);
      }
      const index = map.get(a[aStart]);
      if (index != null) {
        if (bStart < index && index < bEnd) {
          let i = aStart, sequence = 1, t;
          while (++i < aEnd && i < bEnd) {
            if ((t = map.get(a[i])) == null || t !== index + sequence)
              break;
            sequence++;
          }
          if (sequence > index - bStart) {
            const node = a[aStart];
            while (bStart < index)
              parentNode.insertBefore(b[bStart++], node);
          } else
            parentNode.replaceChild(b[bStart++], a[aStart++]);
        } else
          aStart++;
      } else
        a[aStart++].remove();
    }
  }
}
var $$EVENTS = "_$DX_DELEGATE";
function render(code, element, init, options = {}) {
  if (!element) {
    throw new Error("The `element` passed to `render(..., element)` doesn't exist. Make sure `element` exists in the document.");
  }
  let disposer;
  createRoot((dispose2) => {
    disposer = dispose2;
    element === document ? code() : insert(element, code(), element.firstChild ? null : undefined, init);
  }, options.owner);
  return () => {
    disposer();
    element.textContent = "";
  };
}
function template(html, isImportNode, isSVG, isMathML) {
  let node;
  const create = () => {
    if (isHydrating())
      throw new Error("Failed attempt to create new DOM elements during hydration. Check that the libraries you are using support hydration.");
    const t = isMathML ? document.createElementNS("http://www.w3.org/1998/Math/MathML", "template") : document.createElement("template");
    t.innerHTML = html;
    return isSVG ? t.content.firstChild.firstChild : isMathML ? t.firstChild : t.content.firstChild;
  };
  const fn = isImportNode ? () => untrack(() => document.importNode(node || (node = create()), true)) : () => (node || (node = create())).cloneNode(true);
  fn.cloneNode = fn;
  return fn;
}
function delegateEvents(eventNames, document2 = window.document) {
  const e = document2[$$EVENTS] || (document2[$$EVENTS] = new Set);
  for (let i = 0, l = eventNames.length;i < l; i++) {
    const name = eventNames[i];
    if (!e.has(name)) {
      e.add(name);
      document2.addEventListener(name, eventHandler);
    }
  }
}
function setAttribute(node, name, value2) {
  if (isHydrating(node))
    return;
  if (value2 == null)
    node.removeAttribute(name);
  else
    node.setAttribute(name, value2);
}
function setAttributeNS(node, namespace, name, value2) {
  if (isHydrating(node))
    return;
  if (value2 == null)
    node.removeAttributeNS(namespace, name);
  else
    node.setAttributeNS(namespace, name, value2);
}
function setBoolAttribute(node, name, value2) {
  if (isHydrating(node))
    return;
  value2 ? node.setAttribute(name, "") : node.removeAttribute(name);
}
function className(node, value2) {
  if (isHydrating(node))
    return;
  if (value2 == null)
    node.removeAttribute("class");
  else
    node.className = value2;
}
function addEventListener(node, name, handler, delegate) {
  if (delegate) {
    if (Array.isArray(handler)) {
      node[`$$${name}`] = handler[0];
      node[`$$${name}Data`] = handler[1];
    } else
      node[`$$${name}`] = handler;
  } else if (Array.isArray(handler)) {
    const handlerFn = handler[0];
    node.addEventListener(name, handler[0] = (e) => handlerFn.call(node, handler[1], e));
  } else
    node.addEventListener(name, handler, typeof handler !== "function" && handler);
}
function classList(node, value2, prev = {}) {
  const classKeys = Object.keys(value2 || {}), prevKeys = Object.keys(prev);
  let i, len;
  for (i = 0, len = prevKeys.length;i < len; i++) {
    const key = prevKeys[i];
    if (!key || key === "undefined" || value2[key])
      continue;
    toggleClassKey(node, key, false);
    delete prev[key];
  }
  for (i = 0, len = classKeys.length;i < len; i++) {
    const key = classKeys[i], classValue = !!value2[key];
    if (!key || key === "undefined" || prev[key] === classValue || !classValue)
      continue;
    toggleClassKey(node, key, true);
    prev[key] = classValue;
  }
  return prev;
}
function style(node, value2, prev) {
  if (!value2)
    return prev ? setAttribute(node, "style") : value2;
  const nodeStyle = node.style;
  if (typeof value2 === "string")
    return nodeStyle.cssText = value2;
  typeof prev === "string" && (nodeStyle.cssText = prev = undefined);
  prev || (prev = {});
  value2 || (value2 = {});
  let v, s;
  for (s in prev) {
    value2[s] == null && nodeStyle.removeProperty(s);
    delete prev[s];
  }
  for (s in value2) {
    v = value2[s];
    if (v !== prev[s]) {
      nodeStyle.setProperty(s, v);
      prev[s] = v;
    }
  }
  return prev;
}
function setStyleProperty(node, name, value2) {
  value2 != null ? node.style.setProperty(name, value2) : node.style.removeProperty(name);
}
function spread(node, props = {}, isSVG, skipChildren) {
  const prevProps = {};
  if (!skipChildren) {
    createRenderEffect(() => prevProps.children = insertExpression(node, props.children, prevProps.children));
  }
  createRenderEffect(() => typeof props.ref === "function" && use(props.ref, node));
  createRenderEffect(() => assign(node, props, isSVG, true, prevProps, true));
  return prevProps;
}
function use(fn, element, arg) {
  return untrack(() => fn(element, arg));
}
function insert(parent, accessor, marker, initial) {
  if (marker !== undefined && !initial)
    initial = [];
  if (typeof accessor !== "function")
    return insertExpression(parent, accessor, initial, marker);
  createRenderEffect((current) => insertExpression(parent, accessor(), current, marker), initial);
}
function assign(node, props, isSVG, skipChildren, prevProps = {}, skipRef = false) {
  props || (props = {});
  for (const prop in prevProps) {
    if (!(prop in props)) {
      if (prop === "children")
        continue;
      prevProps[prop] = assignProp(node, prop, null, prevProps[prop], isSVG, skipRef, props);
    }
  }
  for (const prop in props) {
    if (prop === "children") {
      if (!skipChildren)
        insertExpression(node, props.children);
      continue;
    }
    const value2 = props[prop];
    prevProps[prop] = assignProp(node, prop, value2, prevProps[prop], isSVG, skipRef, props);
  }
}
function isHydrating(node) {
  return !!sharedConfig.context && !sharedConfig.done && (!node || node.isConnected);
}
function toPropertyName(name) {
  return name.toLowerCase().replace(/-([a-z])/g, (_, w) => w.toUpperCase());
}
function toggleClassKey(node, key, value2) {
  const classNames = key.trim().split(/\s+/);
  for (let i = 0, nameLen = classNames.length;i < nameLen; i++)
    node.classList.toggle(classNames[i], value2);
}
function assignProp(node, prop, value2, prev, isSVG, skipRef, props) {
  let isCE, isProp, isChildProp, propAlias, forceProp;
  if (prop === "style")
    return style(node, value2, prev);
  if (prop === "classList")
    return classList(node, value2, prev);
  if (value2 === prev)
    return prev;
  if (prop === "ref") {
    if (!skipRef)
      value2(node);
  } else if (prop.slice(0, 3) === "on:") {
    const e = prop.slice(3);
    prev && node.removeEventListener(e, prev, typeof prev !== "function" && prev);
    value2 && node.addEventListener(e, value2, typeof value2 !== "function" && value2);
  } else if (prop.slice(0, 10) === "oncapture:") {
    const e = prop.slice(10);
    prev && node.removeEventListener(e, prev, true);
    value2 && node.addEventListener(e, value2, true);
  } else if (prop.slice(0, 2) === "on") {
    const name = prop.slice(2).toLowerCase();
    const delegate = DelegatedEvents.has(name);
    if (!delegate && prev) {
      const h = Array.isArray(prev) ? prev[0] : prev;
      node.removeEventListener(name, h);
    }
    if (delegate || value2) {
      addEventListener(node, name, value2, delegate);
      delegate && delegateEvents([name]);
    }
  } else if (prop.slice(0, 5) === "attr:") {
    setAttribute(node, prop.slice(5), value2);
  } else if (prop.slice(0, 5) === "bool:") {
    setBoolAttribute(node, prop.slice(5), value2);
  } else if ((forceProp = prop.slice(0, 5) === "prop:") || (isChildProp = ChildProperties.has(prop)) || !isSVG && ((propAlias = getPropAlias(prop, node.tagName)) || (isProp = Properties.has(prop))) || (isCE = node.nodeName.includes("-") || ("is" in props))) {
    if (forceProp) {
      prop = prop.slice(5);
      isProp = true;
    } else if (isHydrating(node))
      return value2;
    if (prop === "class" || prop === "className")
      className(node, value2);
    else if (isCE && !isProp && !isChildProp)
      node[toPropertyName(prop)] = value2;
    else
      node[propAlias || prop] = value2;
  } else {
    const ns = isSVG && prop.indexOf(":") > -1 && SVGNamespace[prop.split(":")[0]];
    if (ns)
      setAttributeNS(node, ns, prop, value2);
    else
      setAttribute(node, Aliases[prop] || prop, value2);
  }
  return value2;
}
function eventHandler(e) {
  if (sharedConfig.registry && sharedConfig.events) {
    if (sharedConfig.events.find(([el, ev]) => ev === e))
      return;
  }
  let node = e.target;
  const key = `$$${e.type}`;
  const oriTarget = e.target;
  const oriCurrentTarget = e.currentTarget;
  const retarget = (value2) => Object.defineProperty(e, "target", {
    configurable: true,
    value: value2
  });
  const handleNode = () => {
    const handler = node[key];
    if (handler && !node.disabled) {
      const data = node[`${key}Data`];
      data !== undefined ? handler.call(node, data, e) : handler.call(node, e);
      if (e.cancelBubble)
        return;
    }
    node.host && typeof node.host !== "string" && !node.host._$host && node.contains(e.target) && retarget(node.host);
    return true;
  };
  const walkUpTree = () => {
    while (handleNode() && (node = node._$host || node.parentNode || node.host))
      ;
  };
  Object.defineProperty(e, "currentTarget", {
    configurable: true,
    get() {
      return node || document;
    }
  });
  if (sharedConfig.registry && !sharedConfig.done)
    sharedConfig.done = _$HY.done = true;
  if (e.composedPath) {
    const path = e.composedPath();
    retarget(path[0]);
    for (let i = 0;i < path.length - 2; i++) {
      node = path[i];
      if (!handleNode())
        break;
      if (node._$host) {
        node = node._$host;
        walkUpTree();
        break;
      }
      if (node.parentNode === oriCurrentTarget) {
        break;
      }
    }
  } else
    walkUpTree();
  retarget(oriTarget);
}
function insertExpression(parent, value2, current, marker, unwrapArray) {
  const hydrating = isHydrating(parent);
  if (hydrating) {
    !current && (current = [...parent.childNodes]);
    let cleaned = [];
    for (let i = 0;i < current.length; i++) {
      const node = current[i];
      if (node.nodeType === 8 && node.data.slice(0, 2) === "!$")
        node.remove();
      else
        cleaned.push(node);
    }
    current = cleaned;
  }
  while (typeof current === "function")
    current = current();
  if (value2 === current)
    return current;
  const t = typeof value2, multi = marker !== undefined;
  parent = multi && current[0] && current[0].parentNode || parent;
  if (t === "string" || t === "number") {
    if (hydrating)
      return current;
    if (t === "number") {
      value2 = value2.toString();
      if (value2 === current)
        return current;
    }
    if (multi) {
      let node = current[0];
      if (node && node.nodeType === 3) {
        node.data !== value2 && (node.data = value2);
      } else
        node = document.createTextNode(value2);
      current = cleanChildren(parent, current, marker, node);
    } else {
      if (current !== "" && typeof current === "string") {
        current = parent.firstChild.data = value2;
      } else
        current = parent.textContent = value2;
    }
  } else if (value2 == null || t === "boolean") {
    if (hydrating)
      return current;
    current = cleanChildren(parent, current, marker);
  } else if (t === "function") {
    createRenderEffect(() => {
      let v = value2();
      while (typeof v === "function")
        v = v();
      current = insertExpression(parent, v, current, marker);
    });
    return () => current;
  } else if (Array.isArray(value2)) {
    const array = [];
    const currentArray = current && Array.isArray(current);
    if (normalizeIncomingArray(array, value2, current, unwrapArray)) {
      createRenderEffect(() => current = insertExpression(parent, array, current, marker, true));
      return () => current;
    }
    if (hydrating) {
      if (!array.length)
        return current;
      if (marker === undefined)
        return current = [...parent.childNodes];
      let node = array[0];
      if (node.parentNode !== parent)
        return current;
      const nodes = [node];
      while ((node = node.nextSibling) !== marker)
        nodes.push(node);
      return current = nodes;
    }
    if (array.length === 0) {
      current = cleanChildren(parent, current, marker);
      if (multi)
        return current;
    } else if (currentArray) {
      if (current.length === 0) {
        appendNodes(parent, array, marker);
      } else
        reconcileArrays(parent, current, array);
    } else {
      current && cleanChildren(parent);
      appendNodes(parent, array);
    }
    current = array;
  } else if (value2.nodeType) {
    if (hydrating && value2.parentNode)
      return current = multi ? [value2] : value2;
    if (Array.isArray(current)) {
      if (multi)
        return current = cleanChildren(parent, current, marker, value2);
      cleanChildren(parent, current, null, value2);
    } else if (current == null || current === "" || !parent.firstChild) {
      parent.appendChild(value2);
    } else
      parent.replaceChild(value2, parent.firstChild);
    current = value2;
  } else
    console.warn(`Unrecognized value. Skipped inserting`, value2);
  return current;
}
function normalizeIncomingArray(normalized, array, current, unwrap) {
  let dynamic = false;
  for (let i = 0, len = array.length;i < len; i++) {
    let item = array[i], prev = current && current[normalized.length], t;
    if (item == null || item === true || item === false)
      ;
    else if ((t = typeof item) === "object" && item.nodeType) {
      normalized.push(item);
    } else if (Array.isArray(item)) {
      dynamic = normalizeIncomingArray(normalized, item, prev) || dynamic;
    } else if (t === "function") {
      if (unwrap) {
        while (typeof item === "function")
          item = item();
        dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item], Array.isArray(prev) ? prev : [prev]) || dynamic;
      } else {
        normalized.push(item);
        dynamic = true;
      }
    } else {
      const value2 = String(item);
      if (prev && prev.nodeType === 3 && prev.data === value2)
        normalized.push(prev);
      else
        normalized.push(document.createTextNode(value2));
    }
  }
  return dynamic;
}
function appendNodes(parent, array, marker = null) {
  for (let i = 0, len = array.length;i < len; i++)
    parent.insertBefore(array[i], marker);
}
function cleanChildren(parent, current, marker, replacement) {
  if (marker === undefined)
    return parent.textContent = "";
  const node = replacement || document.createTextNode("");
  if (current.length) {
    let inserted = false;
    for (let i = current.length - 1;i >= 0; i--) {
      const el = current[i];
      if (node !== el) {
        const isParent = el.parentNode === parent;
        if (!inserted && !i)
          isParent ? parent.replaceChild(node, el) : parent.insertBefore(node, marker);
        else
          isParent && el.remove();
      } else
        inserted = true;
    }
  } else
    parent.insertBefore(node, marker);
  return [node];
}
var voidFn = () => {
  return;
};
var RequestContext = Symbol();
var isServer = false;

// ../frontend/transport/http-transport.ts
var API_BASE = "";

class HttpTransport {
  async request(method, payload) {
    const path = `/api/${method}`;
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `请求失败: ${method}`);
    }
    if (data.error && !res.ok) {
      throw new Error(data.error);
    }
    return data;
  }
  subscribeEvents(sessionId, callback) {
    const url = `${API_BASE}/api/events?sessionId=${sessionId}`;
    const eventSource = new EventSource(url);
    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        callback(message);
      } catch (e) {
        console.error("解析 SSE 消息失败:", e);
      }
    };
    return () => {
      eventSource.close();
    };
  }
}
// ../node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value2, kind, f) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value2) : f ? f.value = value2 : state.set(receiver, value2), value2;
}

// ../node_modules/@tauri-apps/api/core.js
var _Channel_onmessage;
var _Channel_nextMessageIndex;
var _Channel_pendingMessages;
var _Channel_messageEndIndex;
var _Resource_rid;
var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
function transformCallback(callback, once = false) {
  return window.__TAURI_INTERNALS__.transformCallback(callback, once);
}

class Channel {
  constructor(onmessage) {
    _Channel_onmessage.set(this, undefined);
    _Channel_nextMessageIndex.set(this, 0);
    _Channel_pendingMessages.set(this, []);
    _Channel_messageEndIndex.set(this, undefined);
    __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {}), "f");
    this.id = transformCallback((rawMessage) => {
      const index = rawMessage.index;
      if ("end" in rawMessage) {
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          this.cleanupCallback();
        } else {
          __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
        }
        return;
      }
      const message = rawMessage.message;
      if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
        __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
        __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
          const message2 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message2);
          delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        }
        if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
          this.cleanupCallback();
        }
      } else {
        __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
      }
    });
  }
  cleanupCallback() {
    window.__TAURI_INTERNALS__.unregisterCallback(this.id);
  }
  set onmessage(handler) {
    __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
  }
  get onmessage() {
    return __classPrivateFieldGet(this, _Channel_onmessage, "f");
  }
  [(_Channel_onmessage = new WeakMap, _Channel_nextMessageIndex = new WeakMap, _Channel_pendingMessages = new WeakMap, _Channel_messageEndIndex = new WeakMap, SERIALIZE_TO_IPC_FN)]() {
    return `__CHANNEL__:${this.id}`;
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
}
async function invoke(cmd, args = {}, options) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}
_Resource_rid = new WeakMap;

// ../node_modules/@tauri-apps/api/event.js
var TauriEvent;
(function(TauriEvent2) {
  TauriEvent2["WINDOW_RESIZED"] = "tauri://resize";
  TauriEvent2["WINDOW_MOVED"] = "tauri://move";
  TauriEvent2["WINDOW_CLOSE_REQUESTED"] = "tauri://close-requested";
  TauriEvent2["WINDOW_DESTROYED"] = "tauri://destroyed";
  TauriEvent2["WINDOW_FOCUS"] = "tauri://focus";
  TauriEvent2["WINDOW_BLUR"] = "tauri://blur";
  TauriEvent2["WINDOW_SCALE_FACTOR_CHANGED"] = "tauri://scale-change";
  TauriEvent2["WINDOW_THEME_CHANGED"] = "tauri://theme-changed";
  TauriEvent2["WINDOW_CREATED"] = "tauri://window-created";
  TauriEvent2["WEBVIEW_CREATED"] = "tauri://webview-created";
  TauriEvent2["DRAG_ENTER"] = "tauri://drag-enter";
  TauriEvent2["DRAG_OVER"] = "tauri://drag-over";
  TauriEvent2["DRAG_DROP"] = "tauri://drag-drop";
  TauriEvent2["DRAG_LEAVE"] = "tauri://drag-leave";
})(TauriEvent || (TauriEvent = {}));
async function _unlisten(event, eventId) {
  window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
  await invoke("plugin:event|unlisten", {
    event,
    eventId
  });
}
async function listen(event, handler, options) {
  var _a;
  const target = typeof (options === null || options === undefined ? undefined : options.target) === "string" ? { kind: "AnyLabel", label: options.target } : (_a = options === null || options === undefined ? undefined : options.target) !== null && _a !== undefined ? _a : { kind: "Any" };
  return invoke("plugin:event|listen", {
    event,
    target,
    handler: transformCallback(handler)
  }).then((eventId) => {
    return async () => _unlisten(event, eventId);
  });
}

// ../frontend/transport/tauri-transport.ts
class TauriTransport {
  async request(method, payload) {
    const result = await invoke("api_request", { method, payload });
    return result;
  }
  subscribeEvents(sessionId, callback) {
    const holder = { unlisten: null, cancelled: false };
    listen("backend-event", (event) => {
      const payload = event.payload;
      if (payload.sessionId !== sessionId)
        return;
      if (payload.error) {
        callback({
          type: "ERROR",
          message: payload.error,
          timestamp: Date.now()
        });
        return;
      }
      if (payload.data)
        callback(payload.data);
    }).then((fn) => {
      holder.unlisten = fn;
      if (holder.cancelled)
        fn();
    });
    invoke("api_request", {
      method: "subscribe-events",
      payload: { sessionId }
    }).catch(() => {});
    return () => {
      holder.cancelled = true;
      invoke("api_request", {
        method: "unsubscribe-events",
        payload: { sessionId }
      }).catch(() => {});
      holder.unlisten?.();
    };
  }
}

// ../frontend/transport/index.ts
var transport = new HttpTransport;
function getTransport() {
  return transport;
}
function setTransport(t) {
  transport = t;
}

// ../node_modules/solid-js/store/dist/dev.js
var $RAW = Symbol("store-raw");
var $NODE = Symbol("store-node");
var $HAS = Symbol("store-has");
var $SELF = Symbol("store-self");
var DevHooks2 = {
  onStoreNodeUpdate: null
};
function wrap$1(value2) {
  let p = value2[$PROXY];
  if (!p) {
    Object.defineProperty(value2, $PROXY, {
      value: p = new Proxy(value2, proxyTraps$1)
    });
    if (!Array.isArray(value2)) {
      const keys = Object.keys(value2), desc = Object.getOwnPropertyDescriptors(value2);
      for (let i = 0, l = keys.length;i < l; i++) {
        const prop = keys[i];
        if (desc[prop].get) {
          Object.defineProperty(value2, prop, {
            enumerable: desc[prop].enumerable,
            get: desc[prop].get.bind(p)
          });
        }
      }
    }
  }
  return p;
}
function isWrappable(obj) {
  let proto;
  return obj != null && typeof obj === "object" && (obj[$PROXY] || !(proto = Object.getPrototypeOf(obj)) || proto === Object.prototype || Array.isArray(obj));
}
function unwrap(item, set = new Set) {
  let result, unwrapped, v, prop;
  if (result = item != null && item[$RAW])
    return result;
  if (!isWrappable(item) || set.has(item))
    return item;
  if (Array.isArray(item)) {
    if (Object.isFrozen(item))
      item = item.slice(0);
    else
      set.add(item);
    for (let i = 0, l = item.length;i < l; i++) {
      v = item[i];
      if ((unwrapped = unwrap(v, set)) !== v)
        item[i] = unwrapped;
    }
  } else {
    if (Object.isFrozen(item))
      item = Object.assign({}, item);
    else
      set.add(item);
    const keys = Object.keys(item), desc = Object.getOwnPropertyDescriptors(item);
    for (let i = 0, l = keys.length;i < l; i++) {
      prop = keys[i];
      if (desc[prop].get)
        continue;
      v = item[prop];
      if ((unwrapped = unwrap(v, set)) !== v)
        item[prop] = unwrapped;
    }
  }
  return item;
}
function getNodes(target, symbol) {
  let nodes = target[symbol];
  if (!nodes)
    Object.defineProperty(target, symbol, {
      value: nodes = Object.create(null)
    });
  return nodes;
}
function getNode(nodes, property, value2) {
  if (nodes[property])
    return nodes[property];
  const [s, set] = createSignal(value2, {
    equals: false,
    internal: true
  });
  s.$ = set;
  return nodes[property] = s;
}
function proxyDescriptor$1(target, property) {
  const desc = Reflect.getOwnPropertyDescriptor(target, property);
  if (!desc || desc.get || !desc.configurable || property === $PROXY || property === $NODE)
    return desc;
  delete desc.value;
  delete desc.writable;
  desc.get = () => target[$PROXY][property];
  return desc;
}
function trackSelf(target) {
  getListener() && getNode(getNodes(target, $NODE), $SELF)();
}
function ownKeys(target) {
  trackSelf(target);
  return Reflect.ownKeys(target);
}
var proxyTraps$1 = {
  get(target, property, receiver) {
    if (property === $RAW)
      return target;
    if (property === $PROXY)
      return receiver;
    if (property === $TRACK) {
      trackSelf(target);
      return receiver;
    }
    const nodes = getNodes(target, $NODE);
    const tracked = nodes[property];
    let value2 = tracked ? tracked() : target[property];
    if (property === $NODE || property === $HAS || property === "__proto__")
      return value2;
    if (!tracked) {
      const desc = Object.getOwnPropertyDescriptor(target, property);
      if (getListener() && (typeof value2 !== "function" || target.hasOwnProperty(property)) && !(desc && desc.get))
        value2 = getNode(nodes, property, value2)();
    }
    return isWrappable(value2) ? wrap$1(value2) : value2;
  },
  has(target, property) {
    if (property === $RAW || property === $PROXY || property === $TRACK || property === $NODE || property === $HAS || property === "__proto__")
      return true;
    getListener() && getNode(getNodes(target, $HAS), property)();
    return property in target;
  },
  set() {
    console.warn("Cannot mutate a Store directly");
    return true;
  },
  deleteProperty() {
    console.warn("Cannot mutate a Store directly");
    return true;
  },
  ownKeys,
  getOwnPropertyDescriptor: proxyDescriptor$1
};
function setProperty(state, property, value2, deleting = false) {
  if (!deleting && state[property] === value2)
    return;
  const prev = state[property], len = state.length;
  DevHooks2.onStoreNodeUpdate && DevHooks2.onStoreNodeUpdate(state, property, value2, prev);
  if (value2 === undefined) {
    delete state[property];
    if (state[$HAS] && state[$HAS][property] && prev !== undefined)
      state[$HAS][property].$();
  } else {
    state[property] = value2;
    if (state[$HAS] && state[$HAS][property] && prev === undefined)
      state[$HAS][property].$();
  }
  let nodes = getNodes(state, $NODE), node;
  if (node = getNode(nodes, property, prev))
    node.$(() => value2);
  if (Array.isArray(state) && state.length !== len) {
    for (let i = state.length;i < len; i++)
      (node = nodes[i]) && node.$();
    (node = getNode(nodes, "length", len)) && node.$(state.length);
  }
  (node = nodes[$SELF]) && node.$();
}
function mergeStoreNode(state, value2) {
  const keys = Object.keys(value2);
  for (let i = 0;i < keys.length; i += 1) {
    const key = keys[i];
    setProperty(state, key, value2[key]);
  }
}
function updateArray(current, next) {
  if (typeof next === "function")
    next = next(current);
  next = unwrap(next);
  if (Array.isArray(next)) {
    if (current === next)
      return;
    let i = 0, len = next.length;
    for (;i < len; i++) {
      const value2 = next[i];
      if (current[i] !== value2)
        setProperty(current, i, value2);
    }
    setProperty(current, "length", len);
  } else
    mergeStoreNode(current, next);
}
function updatePath(current, path, traversed = []) {
  let part, prev = current;
  if (path.length > 1) {
    part = path.shift();
    const partType = typeof part, isArray = Array.isArray(current);
    if (Array.isArray(part)) {
      for (let i = 0;i < part.length; i++) {
        updatePath(current, [part[i]].concat(path), traversed);
      }
      return;
    } else if (isArray && partType === "function") {
      for (let i = 0;i < current.length; i++) {
        if (part(current[i], i))
          updatePath(current, [i].concat(path), traversed);
      }
      return;
    } else if (isArray && partType === "object") {
      const {
        from = 0,
        to = current.length - 1,
        by = 1
      } = part;
      for (let i = from;i <= to; i += by) {
        updatePath(current, [i].concat(path), traversed);
      }
      return;
    } else if (path.length > 1) {
      updatePath(current[part], path, [part].concat(traversed));
      return;
    }
    prev = current[part];
    traversed = [part].concat(traversed);
  }
  let value2 = path[0];
  if (typeof value2 === "function") {
    value2 = value2(prev, traversed);
    if (value2 === prev)
      return;
  }
  if (part === undefined && value2 == undefined)
    return;
  value2 = unwrap(value2);
  if (part === undefined || isWrappable(prev) && isWrappable(value2) && !Array.isArray(value2)) {
    mergeStoreNode(prev, value2);
  } else
    setProperty(current, part, value2);
}
function createStore(...[store, options]) {
  const unwrappedStore = unwrap(store || {});
  const isArray = Array.isArray(unwrappedStore);
  if (typeof unwrappedStore !== "object" && typeof unwrappedStore !== "function")
    throw new Error(`Unexpected type ${typeof unwrappedStore} received when initializing 'createStore'. Expected an object.`);
  const wrappedStore = wrap$1(unwrappedStore);
  DEV.registerGraph({
    value: unwrappedStore,
    name: options && options.name
  });
  function setStore(...args) {
    batch(() => {
      isArray && args.length === 1 ? updateArray(unwrappedStore, args[0]) : updatePath(unwrappedStore, args);
    });
  }
  return [wrappedStore, setStore];
}
var $ROOT = Symbol("store-root");
var producers = new WeakMap;
var setterTraps = {
  get(target, property) {
    if (property === $RAW)
      return target;
    const value2 = target[property];
    let proxy;
    return isWrappable(value2) ? producers.get(value2) || (producers.set(value2, proxy = new Proxy(value2, setterTraps)), proxy) : value2;
  },
  set(target, property, value2) {
    setProperty(target, property, unwrap(value2));
    return true;
  },
  deleteProperty(target, property) {
    setProperty(target, property, undefined, true);
    return true;
  }
};
function produce(fn) {
  return (state) => {
    if (isWrappable(state)) {
      let proxy;
      if (!(proxy = producers.get(state))) {
        producers.set(state, proxy = new Proxy(state, setterTraps));
      }
      fn(proxy);
    }
    return state;
  };
}

// ../node_modules/@solidjs/router/dist/index.js
function createBeforeLeave() {
  let listeners = new Set;
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  let ignore = false;
  function confirm(to, options) {
    if (ignore)
      return !(ignore = false);
    const e = {
      to,
      options,
      defaultPrevented: false,
      preventDefault: () => e.defaultPrevented = true
    };
    for (const l of listeners)
      l.listener({
        ...e,
        from: l.location,
        retry: (force) => {
          force && (ignore = true);
          l.navigate(to, {
            ...options,
            resolve: false
          });
        }
      });
    return !e.defaultPrevented;
  }
  return {
    subscribe,
    confirm
  };
}
var depth;
function saveCurrentDepth() {
  if (!window.history.state || window.history.state._depth == null) {
    window.history.replaceState({
      ...window.history.state,
      _depth: window.history.length - 1
    }, "");
  }
  depth = window.history.state._depth;
}
if (!isServer) {
  saveCurrentDepth();
}
function keepDepth(state) {
  return {
    ...state,
    _depth: window.history.state && window.history.state._depth
  };
}
function notifyIfNotBlocked(notify, block) {
  let ignore = false;
  return () => {
    const prevDepth = depth;
    saveCurrentDepth();
    const delta = prevDepth == null ? null : depth - prevDepth;
    if (ignore) {
      ignore = false;
      return;
    }
    if (delta && block(delta)) {
      ignore = true;
      window.history.go(-delta);
    } else {
      notify();
    }
  };
}
var hasSchemeRegex = /^(?:[a-z0-9]+:)?\/\//i;
var trimPathRegex = /^\/+|(\/)\/+$/g;
var mockBase = "http://sr";
function normalizePath(path, omitSlash = false) {
  const s = path.replace(trimPathRegex, "$1");
  return s ? omitSlash || /^[?#]/.test(s) ? s : "/" + s : "";
}
function resolvePath(base, path, from) {
  if (hasSchemeRegex.test(path)) {
    return;
  }
  const basePath = normalizePath(base);
  const fromPath = from && normalizePath(from);
  let result = "";
  if (!fromPath || path.startsWith("/")) {
    result = basePath;
  } else if (fromPath.toLowerCase().indexOf(basePath.toLowerCase()) !== 0) {
    result = basePath + fromPath;
  } else {
    result = fromPath;
  }
  return (result || "/") + normalizePath(path, !result);
}
function invariant(value2, message) {
  if (value2 == null) {
    throw new Error(message);
  }
  return value2;
}
function joinPaths(from, to) {
  return normalizePath(from).replace(/\/*(\*.*)?$/g, "") + normalizePath(to);
}
function extractSearchParams(url) {
  const params = {};
  url.searchParams.forEach((value2, key) => {
    if (key in params) {
      if (Array.isArray(params[key]))
        params[key].push(value2);
      else
        params[key] = [params[key], value2];
    } else
      params[key] = value2;
  });
  return params;
}
function createMatcher(path, partial, matchFilters) {
  const [pattern, splat] = path.split("/*", 2);
  const segments = pattern.split("/").filter(Boolean);
  const len = segments.length;
  return (location) => {
    const locSegments = location.split("/").filter(Boolean);
    const lenDiff = locSegments.length - len;
    if (lenDiff < 0 || lenDiff > 0 && splat === undefined && !partial) {
      return null;
    }
    const match = {
      path: len ? "" : "/",
      params: {}
    };
    const matchFilter = (s) => matchFilters === undefined ? undefined : matchFilters[s];
    for (let i = 0;i < len; i++) {
      const segment = segments[i];
      const dynamic = segment[0] === ":";
      const locSegment = dynamic ? locSegments[i] : locSegments[i].toLowerCase();
      const key = dynamic ? segment.slice(1) : segment.toLowerCase();
      if (dynamic && matchSegment(locSegment, matchFilter(key))) {
        match.params[key] = locSegment;
      } else if (dynamic || !matchSegment(locSegment, key)) {
        return null;
      }
      match.path += `/${locSegment}`;
    }
    if (splat) {
      const remainder = lenDiff ? locSegments.slice(-lenDiff).join("/") : "";
      if (matchSegment(remainder, matchFilter(splat))) {
        match.params[splat] = remainder;
      } else {
        return null;
      }
    }
    return match;
  };
}
function matchSegment(input, filter) {
  const isEqual = (s) => s === input;
  if (filter === undefined) {
    return true;
  } else if (typeof filter === "string") {
    return isEqual(filter);
  } else if (typeof filter === "function") {
    return filter(input);
  } else if (Array.isArray(filter)) {
    return filter.some(isEqual);
  } else if (filter instanceof RegExp) {
    return filter.test(input);
  }
  return false;
}
function scoreRoute(route) {
  const [pattern, splat] = route.pattern.split("/*", 2);
  const segments = pattern.split("/").filter(Boolean);
  return segments.reduce((score, segment) => score + (segment.startsWith(":") ? 2 : 3), segments.length - (splat === undefined ? 0 : 1));
}
function createMemoObject(fn) {
  const map = new Map;
  const owner = getOwner();
  return new Proxy({}, {
    get(_, property) {
      if (!map.has(property)) {
        runWithOwner(owner, () => map.set(property, createMemo(() => fn()[property])));
      }
      return map.get(property)();
    },
    getOwnPropertyDescriptor() {
      return {
        enumerable: true,
        configurable: true
      };
    },
    ownKeys() {
      return Reflect.ownKeys(fn());
    },
    has(_, property) {
      return property in fn();
    }
  });
}
function expandOptionals(pattern) {
  let match = /(\/?\:[^\/]+)\?/.exec(pattern);
  if (!match)
    return [pattern];
  let prefix = pattern.slice(0, match.index);
  let suffix = pattern.slice(match.index + match[0].length);
  const prefixes = [prefix, prefix += match[1]];
  while (match = /^(\/\:[^\/]+)\?/.exec(suffix)) {
    prefixes.push(prefix += match[1]);
    suffix = suffix.slice(match[0].length);
  }
  return expandOptionals(suffix).reduce((results, expansion) => [...results, ...prefixes.map((p) => p + expansion)], []);
}
var MAX_REDIRECTS = 100;
var RouterContextObj = createContext();
var RouteContextObj = createContext();
var useRouter = () => invariant(useContext(RouterContextObj), "<A> and 'use' router primitives can be only used inside a Route.");
var useRoute = () => useContext(RouteContextObj) || useRouter().base;
var useResolvedPath = (path) => {
  const route = useRoute();
  return createMemo(() => route.resolvePath(path()));
};
var useHref = (to) => {
  const router = useRouter();
  return createMemo(() => {
    const to_ = to();
    return to_ !== undefined ? router.renderPath(to_) : to_;
  });
};
var useNavigate = () => useRouter().navigatorFactory();
var useLocation = () => useRouter().location;
function createRoutes(routeDef, base = "") {
  const {
    component,
    preload,
    load,
    children: children2,
    info
  } = routeDef;
  const isLeaf = !children2 || Array.isArray(children2) && !children2.length;
  const shared = {
    key: routeDef,
    component,
    preload: preload || load,
    info
  };
  return asArray(routeDef.path).reduce((acc, originalPath) => {
    for (const expandedPath of expandOptionals(originalPath)) {
      const path = joinPaths(base, expandedPath);
      let pattern = isLeaf ? path : path.split("/*", 1)[0];
      pattern = pattern.split("/").map((s) => {
        return s.startsWith(":") || s.startsWith("*") ? s : encodeURIComponent(s);
      }).join("/");
      acc.push({
        ...shared,
        originalPath,
        pattern,
        matcher: createMatcher(pattern, !isLeaf, routeDef.matchFilters)
      });
    }
    return acc;
  }, []);
}
function createBranch(routes, index = 0) {
  return {
    routes,
    score: scoreRoute(routes[routes.length - 1]) * 1e4 - index,
    matcher(location) {
      const matches = [];
      for (let i = routes.length - 1;i >= 0; i--) {
        const route = routes[i];
        const match = route.matcher(location);
        if (!match) {
          return null;
        }
        matches.unshift({
          ...match,
          route
        });
      }
      return matches;
    }
  };
}
function asArray(value2) {
  return Array.isArray(value2) ? value2 : [value2];
}
function createBranches(routeDef, base = "", stack = [], branches = []) {
  const routeDefs = asArray(routeDef);
  for (let i = 0, len = routeDefs.length;i < len; i++) {
    const def = routeDefs[i];
    if (def && typeof def === "object") {
      if (!def.hasOwnProperty("path"))
        def.path = "";
      const routes = createRoutes(def, base);
      for (const route of routes) {
        stack.push(route);
        const isEmptyArray = Array.isArray(def.children) && def.children.length === 0;
        if (def.children && !isEmptyArray) {
          createBranches(def.children, route.pattern, stack, branches);
        } else {
          const branch = createBranch([...stack], branches.length);
          branches.push(branch);
        }
        stack.pop();
      }
    }
  }
  return stack.length ? branches : branches.sort((a, b) => b.score - a.score);
}
function getRouteMatches(branches, location) {
  for (let i = 0, len = branches.length;i < len; i++) {
    const match = branches[i].matcher(location);
    if (match) {
      return match;
    }
  }
  return [];
}
function createLocation(path, state, queryWrapper) {
  const origin = new URL(mockBase);
  const url = createMemo((prev) => {
    const path_ = path();
    try {
      return new URL(path_, origin);
    } catch (err) {
      console.error(`Invalid path ${path_}`);
      return prev;
    }
  }, origin, {
    equals: (a, b) => a.href === b.href
  });
  const pathname = createMemo(() => url().pathname);
  const search = createMemo(() => url().search, true);
  const hash = createMemo(() => url().hash);
  const key = () => "";
  const queryFn = on(search, () => extractSearchParams(url()));
  return {
    get pathname() {
      return pathname();
    },
    get search() {
      return search();
    },
    get hash() {
      return hash();
    },
    get state() {
      return state();
    },
    get key() {
      return key();
    },
    query: queryWrapper ? queryWrapper(queryFn) : createMemoObject(queryFn)
  };
}
var intent;
function getIntent() {
  return intent;
}
var inPreloadFn = false;
function getInPreloadFn() {
  return inPreloadFn;
}
function setInPreloadFn(value2) {
  inPreloadFn = value2;
}
function createRouterContext(integration, branches, getContext, options = {}) {
  const {
    signal: [source, setSource],
    utils = {}
  } = integration;
  const parsePath = utils.parsePath || ((p) => p);
  const renderPath = utils.renderPath || ((p) => p);
  const beforeLeave = utils.beforeLeave || createBeforeLeave();
  const basePath = resolvePath("", options.base || "");
  if (basePath === undefined) {
    throw new Error(`${basePath} is not a valid base path`);
  } else if (basePath && !source().value) {
    setSource({
      value: basePath,
      replace: true,
      scroll: false
    });
  }
  const [isRouting, setIsRouting] = createSignal(false);
  let lastTransitionTarget;
  const transition = (newIntent, newTarget) => {
    if (newTarget.value === reference() && newTarget.state === state())
      return;
    if (lastTransitionTarget === undefined)
      setIsRouting(true);
    intent = newIntent;
    lastTransitionTarget = newTarget;
    startTransition(() => {
      if (lastTransitionTarget !== newTarget)
        return;
      setReference(lastTransitionTarget.value);
      setState(lastTransitionTarget.state);
      resetErrorBoundaries();
      if (!isServer)
        submissions[1]((subs) => subs.filter((s) => s.pending));
    }).finally(() => {
      if (lastTransitionTarget !== newTarget)
        return;
      batch(() => {
        intent = undefined;
        if (newIntent === "navigate")
          navigateEnd(lastTransitionTarget);
        setIsRouting(false);
        lastTransitionTarget = undefined;
      });
    });
  };
  const [reference, setReference] = createSignal(source().value);
  const [state, setState] = createSignal(source().state);
  const location = createLocation(reference, state, utils.queryWrapper);
  const referrers = [];
  const submissions = createSignal(isServer ? initFromFlash() : []);
  const matches = createMemo(() => {
    if (typeof options.transformUrl === "function") {
      return getRouteMatches(branches(), options.transformUrl(location.pathname));
    }
    return getRouteMatches(branches(), location.pathname);
  });
  const buildParams = () => {
    const m = matches();
    const params2 = {};
    for (let i = 0;i < m.length; i++) {
      Object.assign(params2, m[i].params);
    }
    return params2;
  };
  const params = utils.paramsWrapper ? utils.paramsWrapper(buildParams, branches) : createMemoObject(buildParams);
  const baseRoute = {
    pattern: basePath,
    path: () => basePath,
    outlet: () => null,
    resolvePath(to) {
      return resolvePath(basePath, to);
    }
  };
  createRenderEffect(on(source, (source2) => transition("native", source2), {
    defer: true
  }));
  return {
    base: baseRoute,
    location,
    params,
    isRouting,
    renderPath,
    parsePath,
    navigatorFactory,
    matches,
    beforeLeave,
    preloadRoute,
    singleFlight: options.singleFlight === undefined ? true : options.singleFlight,
    submissions
  };
  function navigateFromRoute(route, to, options2) {
    untrack(() => {
      if (typeof to === "number") {
        if (!to)
          ;
        else if (utils.go) {
          utils.go(to);
        } else {
          console.warn("Router integration does not support relative routing");
        }
        return;
      }
      const queryOnly = !to || to[0] === "?";
      const {
        replace,
        resolve,
        scroll,
        state: nextState
      } = {
        replace: false,
        resolve: !queryOnly,
        scroll: true,
        ...options2
      };
      const resolvedTo = resolve ? route.resolvePath(to) : resolvePath(queryOnly && location.pathname || "", to);
      if (resolvedTo === undefined) {
        throw new Error(`Path '${to}' is not a routable path`);
      } else if (referrers.length >= MAX_REDIRECTS) {
        throw new Error("Too many redirects");
      }
      const current = reference();
      if (resolvedTo !== current || nextState !== state()) {
        if (isServer) {
          const e = voidFn();
          e && (e.response = {
            status: 302,
            headers: new Headers({
              Location: resolvedTo
            })
          });
          setSource({
            value: resolvedTo,
            replace,
            scroll,
            state: nextState
          });
        } else if (beforeLeave.confirm(resolvedTo, options2)) {
          referrers.push({
            value: current,
            replace,
            scroll,
            state: state()
          });
          transition("navigate", {
            value: resolvedTo,
            state: nextState
          });
        }
      }
    });
  }
  function navigatorFactory(route) {
    route = route || useContext(RouteContextObj) || baseRoute;
    return (to, options2) => navigateFromRoute(route, to, options2);
  }
  function navigateEnd(next) {
    const first = referrers[0];
    if (first) {
      setSource({
        ...next,
        replace: first.replace,
        scroll: first.scroll
      });
      referrers.length = 0;
    }
  }
  function preloadRoute(url, preloadData) {
    const matches2 = getRouteMatches(branches(), url.pathname);
    const prevIntent = intent;
    intent = "preload";
    for (let match in matches2) {
      const {
        route,
        params: params2
      } = matches2[match];
      route.component && route.component.preload && route.component.preload();
      const {
        preload
      } = route;
      inPreloadFn = true;
      preloadData && preload && runWithOwner(getContext(), () => preload({
        params: params2,
        location: {
          pathname: url.pathname,
          search: url.search,
          hash: url.hash,
          query: extractSearchParams(url),
          state: null,
          key: ""
        },
        intent: "preload"
      }));
      inPreloadFn = false;
    }
    intent = prevIntent;
  }
  function initFromFlash() {
    const e = voidFn();
    return e && e.router && e.router.submission ? [e.router.submission] : [];
  }
}
function createRouteContext(router, parent, outlet, match) {
  const {
    base,
    location,
    params
  } = router;
  const {
    pattern,
    component,
    preload
  } = match().route;
  const path = createMemo(() => match().path);
  component && component.preload && component.preload();
  inPreloadFn = true;
  const data = preload ? preload({
    params,
    location,
    intent: intent || "initial"
  }) : undefined;
  inPreloadFn = false;
  const route = {
    parent,
    pattern,
    path,
    outlet: () => component ? createComponent(component, {
      params,
      location,
      data,
      get children() {
        return outlet();
      }
    }) : outlet(),
    resolvePath(to) {
      return resolvePath(base.path(), to, path());
    }
  };
  return route;
}
var createRouterComponent = (router) => (props) => {
  const {
    base
  } = props;
  const routeDefs = children(() => props.children);
  const branches = createMemo(() => createBranches(routeDefs(), props.base || ""));
  let context;
  const routerState = createRouterContext(router, branches, () => context, {
    base,
    singleFlight: props.singleFlight,
    transformUrl: props.transformUrl
  });
  router.create && router.create(routerState);
  return createComponent(RouterContextObj.Provider, {
    value: routerState,
    get children() {
      return createComponent(Root, {
        routerState,
        get root() {
          return props.root;
        },
        get preload() {
          return props.rootPreload || props.rootLoad;
        },
        get children() {
          return [memo(() => (context = getOwner()) && null), createComponent(Routes, {
            routerState,
            get branches() {
              return branches();
            }
          })];
        }
      });
    }
  });
};
function Root(props) {
  const location = props.routerState.location;
  const params = props.routerState.params;
  const data = createMemo(() => props.preload && untrack(() => {
    setInPreloadFn(true);
    props.preload({
      params,
      location,
      intent: getIntent() || "initial"
    });
    setInPreloadFn(false);
  }));
  return createComponent(Show, {
    get when() {
      return props.root;
    },
    keyed: true,
    get fallback() {
      return props.children;
    },
    children: (Root2) => createComponent(Root2, {
      params,
      location,
      get data() {
        return data();
      },
      get children() {
        return props.children;
      }
    })
  });
}
function Routes(props) {
  if (isServer) {
    const e = voidFn();
    if (e && e.router && e.router.dataOnly) {
      dataOnly(e, props.routerState, props.branches);
      return;
    }
    e && ((e.router || (e.router = {})).matches || (e.router.matches = props.routerState.matches().map(({
      route,
      path,
      params
    }) => ({
      path: route.originalPath,
      pattern: route.pattern,
      match: path,
      params,
      info: route.info
    }))));
  }
  const disposers = [];
  let root;
  const routeStates = createMemo(on(props.routerState.matches, (nextMatches, prevMatches, prev) => {
    let equal = prevMatches && nextMatches.length === prevMatches.length;
    const next = [];
    for (let i = 0, len = nextMatches.length;i < len; i++) {
      const prevMatch = prevMatches && prevMatches[i];
      const nextMatch = nextMatches[i];
      if (prev && prevMatch && nextMatch.route.key === prevMatch.route.key) {
        next[i] = prev[i];
      } else {
        equal = false;
        if (disposers[i]) {
          disposers[i]();
        }
        createRoot((dispose2) => {
          disposers[i] = dispose2;
          next[i] = createRouteContext(props.routerState, next[i - 1] || props.routerState.base, createOutlet(() => routeStates()[i + 1]), () => {
            const routeMatches = props.routerState.matches();
            return routeMatches[i] ?? routeMatches[0];
          });
        });
      }
    }
    disposers.splice(nextMatches.length).forEach((dispose2) => dispose2());
    if (prev && equal) {
      return prev;
    }
    root = next[0];
    return next;
  }));
  return createOutlet(() => routeStates() && root)();
}
var createOutlet = (child) => {
  return () => createComponent(Show, {
    get when() {
      return child();
    },
    keyed: true,
    children: (child2) => createComponent(RouteContextObj.Provider, {
      value: child2,
      get children() {
        return child2.outlet();
      }
    })
  });
};
var Route = (props) => {
  const childRoutes = children(() => props.children);
  return mergeProps(props, {
    get children() {
      return childRoutes();
    }
  });
};
function dataOnly(event, routerState, branches) {
  const url = new URL(event.request.url);
  const prevMatches = getRouteMatches(branches, new URL(event.router.previousUrl || event.request.url).pathname);
  const matches = getRouteMatches(branches, url.pathname);
  for (let match = 0;match < matches.length; match++) {
    if (!prevMatches[match] || matches[match].route !== prevMatches[match].route)
      event.router.dataOnly = true;
    const {
      route,
      params
    } = matches[match];
    route.preload && route.preload({
      params,
      location: routerState.location,
      intent: "preload"
    });
  }
}
function intercept([value2, setValue], get, set) {
  return [value2, set ? (v) => setValue(set(v)) : setValue];
}
function createRouter(config) {
  let ignore = false;
  const wrap = (value2) => typeof value2 === "string" ? {
    value: value2
  } : value2;
  const signal = intercept(createSignal(wrap(config.get()), {
    equals: (a, b) => a.value === b.value && a.state === b.state
  }), undefined, (next) => {
    !ignore && config.set(next);
    if (sharedConfig.registry && !sharedConfig.done)
      sharedConfig.done = true;
    return next;
  });
  config.init && onCleanup(config.init((value2 = config.get()) => {
    ignore = true;
    signal[1](wrap(value2));
    ignore = false;
  }));
  return createRouterComponent({
    signal,
    create: config.create,
    utils: config.utils
  });
}
function bindEvent(target, type, handler) {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}
function scrollToHash(hash, fallbackTop) {
  const el = hash && document.getElementById(hash);
  if (el) {
    el.scrollIntoView();
  } else if (fallbackTop) {
    window.scrollTo(0, 0);
  }
}
var LocationHeader = "Location";
var PRELOAD_TIMEOUT = 5000;
var CACHE_TIMEOUT = 180000;
var cacheMap = new Map;
if (!isServer) {
  setInterval(() => {
    const now = Date.now();
    for (let [k, v] of cacheMap.entries()) {
      if (!v[4].count && now - v[0] > CACHE_TIMEOUT) {
        cacheMap.delete(k);
      }
    }
  }, 300000);
}
function getCache() {
  if (!isServer)
    return cacheMap;
  const req = voidFn();
  if (!req)
    throw new Error("Cannot find cache context");
  return (req.router || (req.router = {})).cache || (req.router.cache = new Map);
}
function query(fn, name) {
  if (fn.GET)
    fn = fn.GET;
  const cachedFn = (...args) => {
    const cache = getCache();
    const intent2 = getIntent();
    const inPreloadFn2 = getInPreloadFn();
    const owner = getOwner();
    const navigate = owner ? useNavigate() : undefined;
    const now = Date.now();
    const key = name + hashKey(args);
    let cached = cache.get(key);
    let tracking;
    if (isServer) {
      const e = voidFn();
      if (e) {
        const dataOnly2 = (e.router || (e.router = {})).dataOnly;
        if (dataOnly2) {
          const data = e && (e.router.data || (e.router.data = {}));
          if (data && key in data)
            return data[key];
          if (Array.isArray(dataOnly2) && !matchKey(key, dataOnly2)) {
            data[key] = undefined;
            return Promise.resolve();
          }
        }
      }
    }
    if (getListener() && !isServer) {
      tracking = true;
      onCleanup(() => cached[4].count--);
    }
    if (cached && cached[0] && (isServer || intent2 === "native" || cached[4].count || Date.now() - cached[0] < PRELOAD_TIMEOUT)) {
      if (tracking) {
        cached[4].count++;
        cached[4][0]();
      }
      if (cached[3] === "preload" && intent2 !== "preload") {
        cached[0] = now;
      }
      let res2 = cached[1];
      if (intent2 !== "preload") {
        res2 = "then" in cached[1] ? cached[1].then(handleResponse(false), handleResponse(true)) : handleResponse(false)(cached[1]);
        !isServer && intent2 === "navigate" && startTransition(() => cached[4][1](cached[0]));
      }
      inPreloadFn2 && "then" in res2 && res2.catch(() => {});
      return res2;
    }
    let res;
    if (!isServer && sharedConfig.has && sharedConfig.has(key)) {
      res = sharedConfig.load(key);
      delete globalThis._$HY.r[key];
    } else
      res = fn(...args);
    if (cached) {
      cached[0] = now;
      cached[1] = res;
      cached[3] = intent2;
      !isServer && intent2 === "navigate" && startTransition(() => cached[4][1](cached[0]));
    } else {
      cache.set(key, cached = [now, res, , intent2, createSignal(now)]);
      cached[4].count = 0;
    }
    if (tracking) {
      cached[4].count++;
      cached[4][0]();
    }
    if (isServer) {
      const e = voidFn();
      if (e && e.router.dataOnly)
        return e.router.data[key] = res;
    }
    if (intent2 !== "preload") {
      res = "then" in res ? res.then(handleResponse(false), handleResponse(true)) : handleResponse(false)(res);
    }
    inPreloadFn2 && "then" in res && res.catch(() => {});
    if (isServer && sharedConfig.context && sharedConfig.context.async && !sharedConfig.context.noHydrate) {
      const e = voidFn();
      (!e || !e.serverOnly) && sharedConfig.context.serialize(key, res);
    }
    return res;
    function handleResponse(error) {
      return async (v) => {
        if (v instanceof Response) {
          const e = voidFn();
          if (e) {
            for (const [key2, value2] of v.headers) {
              if (key2 == "set-cookie")
                e.response.headers.append("set-cookie", value2);
              else
                e.response.headers.set(key2, value2);
            }
          }
          const url = v.headers.get(LocationHeader);
          if (url !== null) {
            if (navigate && url.startsWith("/"))
              startTransition(() => {
                navigate(url, {
                  replace: true
                });
              });
            else if (!isServer)
              window.location.href = url;
            else if (e)
              e.response.status = 302;
            return;
          }
          if (v.customBody)
            v = await v.customBody();
        }
        if (error)
          throw v;
        cached[2] = v;
        return v;
      };
    }
  };
  cachedFn.keyFor = (...args) => name + hashKey(args);
  cachedFn.key = name;
  return cachedFn;
}
query.get = (key) => {
  const cached = getCache().get(key);
  return cached[2];
};
query.set = (key, value2) => {
  const cache = getCache();
  const now = Date.now();
  let cached = cache.get(key);
  if (cached) {
    cached[0] = now;
    cached[1] = Promise.resolve(value2);
    cached[2] = value2;
    cached[3] = "preload";
  } else {
    cache.set(key, cached = [now, Promise.resolve(value2), value2, "preload", createSignal(now)]);
    cached[4].count = 0;
  }
};
query.delete = (key) => getCache().delete(key);
query.clear = () => getCache().clear();
function matchKey(key, keys) {
  for (let k of keys) {
    if (k && key.startsWith(k))
      return true;
  }
  return false;
}
function hashKey(args) {
  return JSON.stringify(args, (_, val) => isPlainObject(val) ? Object.keys(val).sort().reduce((result, key) => {
    result[key] = val[key];
    return result;
  }, {}) : val);
}
function isPlainObject(obj) {
  let proto;
  return obj != null && typeof obj === "object" && (!(proto = Object.getPrototypeOf(obj)) || proto === Object.prototype);
}
var actions = /* @__PURE__ */ new Map;
function setupNativeEvents(preload = true, explicitLinks = false, actionBase = "/_server", transformUrl) {
  return (router) => {
    const basePath = router.base.path();
    const navigateFromRoute = router.navigatorFactory(router.base);
    let preloadTimeout;
    let lastElement;
    function isSvg(el) {
      return el.namespaceURI === "http://www.w3.org/2000/svg";
    }
    function handleAnchor(evt) {
      if (evt.defaultPrevented || evt.button !== 0 || evt.metaKey || evt.altKey || evt.ctrlKey || evt.shiftKey)
        return;
      const a = evt.composedPath().find((el) => el instanceof Node && el.nodeName.toUpperCase() === "A");
      if (!a || explicitLinks && !a.hasAttribute("link"))
        return;
      const svg = isSvg(a);
      const href = svg ? a.href.baseVal : a.href;
      const target = svg ? a.target.baseVal : a.target;
      if (target || !href && !a.hasAttribute("state"))
        return;
      const rel = (a.getAttribute("rel") || "").split(/\s+/);
      if (a.hasAttribute("download") || rel && rel.includes("external"))
        return;
      const url = svg ? new URL(href, document.baseURI) : new URL(href);
      if (url.origin !== window.location.origin || basePath && url.pathname && !url.pathname.toLowerCase().startsWith(basePath.toLowerCase()))
        return;
      return [a, url];
    }
    function handleAnchorClick(evt) {
      const res = handleAnchor(evt);
      if (!res)
        return;
      const [a, url] = res;
      const to = router.parsePath(url.pathname + url.search + url.hash);
      const state = a.getAttribute("state");
      evt.preventDefault();
      navigateFromRoute(to, {
        resolve: false,
        replace: a.hasAttribute("replace"),
        scroll: !a.hasAttribute("noscroll"),
        state: state ? JSON.parse(state) : undefined
      });
    }
    function handleAnchorPreload(evt) {
      const res = handleAnchor(evt);
      if (!res)
        return;
      const [a, url] = res;
      transformUrl && (url.pathname = transformUrl(url.pathname));
      router.preloadRoute(url, a.getAttribute("preload") !== "false");
    }
    function handleAnchorMove(evt) {
      clearTimeout(preloadTimeout);
      const res = handleAnchor(evt);
      if (!res)
        return lastElement = null;
      const [a, url] = res;
      if (lastElement === a)
        return;
      transformUrl && (url.pathname = transformUrl(url.pathname));
      preloadTimeout = setTimeout(() => {
        router.preloadRoute(url, a.getAttribute("preload") !== "false");
        lastElement = a;
      }, 20);
    }
    function handleFormSubmit(evt) {
      if (evt.defaultPrevented)
        return;
      let actionRef = evt.submitter && evt.submitter.hasAttribute("formaction") ? evt.submitter.getAttribute("formaction") : evt.target.getAttribute("action");
      if (!actionRef)
        return;
      if (!actionRef.startsWith("https://action/")) {
        const url = new URL(actionRef, mockBase);
        actionRef = router.parsePath(url.pathname + url.search);
        if (!actionRef.startsWith(actionBase))
          return;
      }
      if (evt.target.method.toUpperCase() !== "POST")
        throw new Error("Only POST forms are supported for Actions");
      const handler = actions.get(actionRef);
      if (handler) {
        evt.preventDefault();
        const data = new FormData(evt.target, evt.submitter);
        handler.call({
          r: router,
          f: evt.target
        }, evt.target.enctype === "multipart/form-data" ? data : new URLSearchParams(data));
      }
    }
    delegateEvents(["click", "submit"]);
    document.addEventListener("click", handleAnchorClick);
    if (preload) {
      document.addEventListener("mousemove", handleAnchorMove, {
        passive: true
      });
      document.addEventListener("focusin", handleAnchorPreload, {
        passive: true
      });
      document.addEventListener("touchstart", handleAnchorPreload, {
        passive: true
      });
    }
    document.addEventListener("submit", handleFormSubmit);
    onCleanup(() => {
      document.removeEventListener("click", handleAnchorClick);
      if (preload) {
        document.removeEventListener("mousemove", handleAnchorMove);
        document.removeEventListener("focusin", handleAnchorPreload);
        document.removeEventListener("touchstart", handleAnchorPreload);
      }
      document.removeEventListener("submit", handleFormSubmit);
    });
  };
}
function hashParser(str) {
  const to = str.replace(/^.*?#/, "");
  if (!to.startsWith("/")) {
    const [, path = "/"] = window.location.hash.split("#", 2);
    return `${path}#${to}`;
  }
  return to;
}
function HashRouter(props) {
  const getSource = () => window.location.hash.slice(1);
  const beforeLeave = createBeforeLeave();
  return createRouter({
    get: getSource,
    set({
      value: value2,
      replace,
      scroll,
      state
    }) {
      if (replace) {
        window.history.replaceState(keepDepth(state), "", "#" + value2);
      } else {
        window.history.pushState(state, "", "#" + value2);
      }
      const hashIndex = value2.indexOf("#");
      const hash = hashIndex >= 0 ? value2.slice(hashIndex + 1) : "";
      scrollToHash(hash, scroll);
      saveCurrentDepth();
    },
    init: (notify) => bindEvent(window, "hashchange", notifyIfNotBlocked(notify, (delta) => !beforeLeave.confirm(delta && delta < 0 ? delta : getSource()))),
    create: setupNativeEvents(props.preload, props.explicitLinks, props.actionBase),
    utils: {
      go: (delta) => window.history.go(delta),
      renderPath: (path) => `#${path}`,
      parsePath: hashParser,
      beforeLeave
    }
  })(props);
}
var _tmpl$ = /* @__PURE__ */ template(`<a>`);
function A(props) {
  props = mergeProps({
    inactiveClass: "inactive",
    activeClass: "active"
  }, props);
  const [, rest] = splitProps(props, ["href", "state", "class", "activeClass", "inactiveClass", "end"]);
  const to = useResolvedPath(() => props.href);
  const href = useHref(to);
  const location = useLocation();
  const isActive = createMemo(() => {
    const to_ = to();
    if (to_ === undefined)
      return [false, false];
    const path = normalizePath(to_.split(/[?#]/, 1)[0]).toLowerCase();
    const loc = decodeURI(normalizePath(location.pathname).toLowerCase());
    return [props.end ? path === loc : loc.startsWith(path + "/") || loc === path, path === loc];
  });
  return (() => {
    var _el$ = _tmpl$();
    spread(_el$, mergeProps(rest, {
      get href() {
        return href() || props.href;
      },
      get state() {
        return JSON.stringify(props.state);
      },
      get classList() {
        return {
          ...props.class && {
            [props.class]: true
          },
          [props.inactiveClass]: !isActive()[0],
          [props.activeClass]: isActive()[0],
          ...rest.classList
        };
      },
      link: "",
      get ["aria-current"]() {
        return isActive()[1] ? "page" : undefined;
      }
    }), false, false);
    return _el$;
  })();
}

// ../frontend/login.tsx
function ChooseDatabase() {
  return createComponent(A, {
    href: "/postgres",
    children: "postgres"
  });
}

// ../frontend/app.tsx
var _tmpl$2 = /* @__PURE__ */ template(`<main>`);
function App() {
  const columnNames = [{
    key: "name",
    label: "姓名"
  }, {
    key: "age",
    label: "年龄"
  }, {
    key: "role",
    label: "角色"
  }];
  const datas = [{
    name: "Alice",
    age: 28,
    role: "Designer"
  }, {
    name: "Bob",
    age: 34,
    role: "Engineer"
  }, {
    name: "Carol",
    age: 31,
    role: "Product"
  }];
  return (() => {
    var _el$ = _tmpl$2();
    insert(_el$, createComponent(ChooseDatabase, {}));
    return _el$;
  })();
}

// ../frontend/session.ts
function generateSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
function getSessionId() {
  let sessionId = sessionStorage.getItem("db-session-id");
  if (!sessionId) {
    sessionId = generateSessionId();
    sessionStorage.setItem("db-session-id", sessionId);
  }
  return sessionId;
}

// ../frontend/crypto.ts
function pemToBinary(pem) {
  const lines = pem.split(`
`).filter((l) => l && !l.includes("-----"));
  const b64 = lines.join("");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0;i < bin.length; i++)
    bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function encryptWithPublicKey(pemPublicKey, plaintext) {
  const key = await crypto.subtle.importKey("spki", pemToBinary(pemPublicKey), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const data = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, data);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(cipher)));
  return b64;
}

// ../frontend/api.ts
var api = () => getTransport();
async function connectPostgres(sessionId, params) {
  const transport2 = api();
  const keyRes = await transport2.request("get-public-key", { sessionId: "" });
  const publicKey = keyRes.publicKey;
  const passwordEncrypted = await encryptWithPublicKey(publicKey, params.password ?? "");
  const payload = {
    ...params,
    password: undefined,
    passwordEncrypted,
    sessionId
  };
  return transport2.request("connect-postgres", payload);
}
async function queryStream(sessionId, query2, batchSize = 100) {
  return api().request("postgres/query-stream", { query: query2, sessionId, batchSize });
}
async function queryStreamMore(sessionId, batchSize = 100) {
  return api().request("postgres/query-stream-more", { sessionId, batchSize });
}
async function cancelQuery(sessionId) {
  return api().request("postgres/cancel-query", { sessionId });
}
async function saveChanges(sessionId, sql) {
  return api().request("postgres/save-changes", { sql, sessionId });
}
async function queryReadonly(sessionId, query2, limit = 1000) {
  return api().request("postgres/query-readonly", { sessionId, query: query2, limit });
}
async function getSchemas(sessionId) {
  return api().request("postgres/schemas", { sessionId });
}
async function getTables(sessionId, schema) {
  return api().request("postgres/tables", { sessionId, schema });
}
async function getColumns(sessionId, schema, table) {
  return api().request("postgres/columns", { sessionId, schema, table });
}
async function getIndexes(sessionId, schema, table) {
  return api().request("postgres/indexes", { sessionId, schema, table });
}
async function getForeignKeys(sessionId, schema, table) {
  return api().request("postgres/foreign-keys", { sessionId, schema, table });
}
function subscribeEvents(sessionId, callback) {
  return api().subscribeEvents(sessionId, callback);
}

// ../frontend/postgres.tsx
var _tmpl$3 = /* @__PURE__ */ template(`<table><thead><tr><th>字段</th><th>说明</th><th>示例</th></tr></thead><tbody>`);
var _tmpl$22 = /* @__PURE__ */ template(`<button>连接`);
var _tmpl$32 = /* @__PURE__ */ template(`<tr><td></td><td></td><td><input placeholder=请输入值>`);
var fields = [{
  key: "host",
  label: "host",
  desc: "数据库主机名或 IP",
  example: "localhost"
}, {
  key: "port",
  label: "port",
  desc: "数据库端口",
  example: "5432"
}, {
  key: "database",
  label: "database",
  desc: "数据库名称",
  example: "mydb"
}, {
  key: "username",
  label: "username",
  desc: "数据库用户",
  example: "postgres"
}, {
  key: "password",
  label: "password",
  desc: "数据库密码",
  example: "secret"
}];
var initForm = () => fields.reduce((acc, f) => {
  acc[f.key] = f.example ?? "";
  return acc;
}, {});
function Postgres() {
  const navagate = useNavigate();
  const [form, setForm] = createSignal(initForm());
  const onChange = (key, value2) => {
    setForm((prev) => ({
      ...prev,
      [key]: value2
    }));
  };
  const connect = async () => {
    console.log("connect");
    const sessionId = getSessionId();
    const {
      sucess,
      error
    } = await connectPostgres(sessionId, form());
    if (sucess) {
      navagate("/postgres/query-interface");
    }
  };
  return [(() => {
    var _el$ = _tmpl$3(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling;
    insert(_el$3, createComponent(For, {
      each: fields,
      children: (field) => (() => {
        var _el$5 = _tmpl$32(), _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling, _el$8 = _el$7.nextSibling, _el$9 = _el$8.firstChild;
        insert(_el$6, () => field.label);
        insert(_el$7, () => field.desc);
        _el$9.$$input = (e) => onChange(field.key, e.currentTarget.value);
        createRenderEffect(() => setAttribute(_el$9, "aria-label", `${field.label} 示例输入`));
        createRenderEffect(() => _el$9.value = form()[field.key]);
        return _el$5;
      })()
    }));
    return _el$;
  })(), (() => {
    var _el$4 = _tmpl$22();
    _el$4.$$click = connect;
    return _el$4;
  })()];
}
delegateEvents(["click", "input"]);

// ../frontend/editable-cell.tsx
var _tmpl$4 = /* @__PURE__ */ template(`<input type=text style="width:100%;padding:2px 4px;border:2px solid #2563eb;border-radius:2px;font-size:inherit;font-family:inherit;box-sizing:border-box;outline:none;margin:-4px -6px;min-width:calc(100% + 12px)">`);
var _tmpl$23 = /* @__PURE__ */ template(`<td style="padding:8px 12px;border:1px solid #e5e7eb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">`);
var _tmpl$33 = /* @__PURE__ */ template(`<span>`);
function EditableCell(props) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal("");
  let inputRef;
  createEffect(() => {
    if (isEditing()) {
      inputRef?.focus();
    }
  });
  function startEditing() {
    if (!props.isEditable)
      return;
    setEditValue(String(props.value ?? ""));
    setIsEditing(true);
  }
  function saveValue() {
    if (!isEditing())
      return;
    setIsEditing(false);
    props.onSave?.(editValue());
  }
  function cancelEditing() {
    setIsEditing(false);
  }
  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveValue();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing();
    }
  }
  const align = props.align || "left";
  return (() => {
    var _el$ = _tmpl$23();
    _el$.$$dblclick = startEditing;
    setStyleProperty(_el$, "text-align", align);
    insert(_el$, createComponent(Show, {
      get when() {
        return isEditing();
      },
      get fallback() {
        return (() => {
          var _el$3 = _tmpl$33();
          insert(_el$3, () => props.value);
          createRenderEffect(() => setAttribute(_el$3, "title", props.isEditable ? "双击编辑" : ""));
          return _el$3;
        })();
      },
      get children() {
        var _el$2 = _tmpl$4();
        _el$2.addEventListener("blur", saveValue);
        _el$2.$$keydown = handleKeyDown;
        _el$2.$$input = (e) => setEditValue(e.currentTarget.value);
        use((el) => inputRef = el, _el$2);
        setStyleProperty(_el$2, "text-align", align);
        createRenderEffect(() => _el$2.value = editValue());
        return _el$2;
      }
    }));
    createRenderEffect((_p$) => {
      var _v$ = props.isEditable ? "pointer" : "default", _v$2 = props.isModified ? "#fef3c7" : "transparent";
      _v$ !== _p$.e && setStyleProperty(_el$, "cursor", _p$.e = _v$);
      _v$2 !== _p$.t && setStyleProperty(_el$, "background-color", _p$.t = _v$2);
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$;
  })();
}
delegateEvents(["dblclick", "input", "keydown"]);

// ../frontend/sidebar.tsx
var _tmpl$5 = /* @__PURE__ */ template(`<span style=margin-right:6px;font-size:14px>`);
var _tmpl$24 = /* @__PURE__ */ template(`<span style="font-size:10px;color:#6e7681;background-color:#21262d;padding:1px 6px;border-radius:10px;margin-left:4px">`);
var _tmpl$34 = /* @__PURE__ */ template(`<div style=overflow:hidden>`);
var _tmpl$42 = /* @__PURE__ */ template(`<div><div style="display:flex;align-items:center;padding:4px 8px;cursor:pointer;border-radius:4px;margin:1px 4px;font-size:13px;font-family:'JetBrains Mono', 'Fira Code', 'Consolas', monospace;transition:background-color 0.15s ease"><span style="width:16px;height:16px;display:flex;align-items:center;justify-content:center;margin-right:4px;color:#6e7681;font-size:10px;transition:transform 0.2s ease"></span><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap>`);
var _tmpl$52 = /* @__PURE__ */ template(`<div style="width:280px;height:100%;background-color:#0d1117;border-right:1px solid #21262d;display:flex;flex-direction:column;user-select:none"><div style="padding:12px 16px;border-bottom:1px solid #21262d;display:flex;align-items:center;gap:8px"><span style=font-size:14px>\uD83D\uDDC4️</span><span style=color:#c9d1d9;font-weight:600;font-size:14px;letter-spacing:0.5px>Database Navigator</span><button title=刷新 style=margin-left:auto;background:none;border:none;color:#6e7681;cursor:pointer;padding:4px;border-radius:4px;font-size:14px>\uD83D\uDD04</button></div><div style="padding:8px 12px;border-bottom:1px solid #21262d"><input type=text placeholder="\uD83D\uDD0D 搜索表、视图..."style="width:100%;padding:8px 12px;background-color:#161b22;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;font-size:12px;outline:none;box-sizing:border-box"></div><div style="flex:1;overflow-y:auto;overflow-x:hidden;padding:8px 0"></div><div style="padding:8px 16px;border-top:1px solid #21262d;font-size:11px;color:#6e7681;display:flex;justify-content:space-between"><span>Schemas: </span><span>\uD83D\uDCA1 双击表查询`);
var _tmpl$6 = /* @__PURE__ */ template(`<div style=padding:20px;text-align:center;color:#6e7681;font-size:13px>`);
var _tmpl$7 = /* @__PURE__ */ template(`<div style="padding:8px 16px;color:#c9d1d9;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px"><span>▶️</span> SELECT *`);
var _tmpl$8 = /* @__PURE__ */ template(`<div style="padding:8px 16px;color:#c9d1d9;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px"><span>\uD83D\uDD1D</span> SELECT TOP 100`);
var _tmpl$9 = /* @__PURE__ */ template(`<div style="padding:8px 16px;color:#c9d1d9;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px"><span>#️⃣</span> COUNT(*)`);
var _tmpl$0 = /* @__PURE__ */ template(`<div style="height:1px;background-color:#30363d;margin:4px 0">`);
var _tmpl$1 = /* @__PURE__ */ template(`<div style="padding:8px 16px;color:#c9d1d9;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px"><span>\uD83D\uDD04</span> 刷新`);
var _tmpl$10 = /* @__PURE__ */ template(`<div style="position:fixed;background-color:#161b22;border:1px solid #30363d;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.4);z-index:1000;min-width:180px;padding:4px 0">`);
function NodeIcon(props) {
  const icons = {
    connection: "\uD83D\uDD0C",
    schema: "\uD83D\uDCC1",
    tables: "\uD83D\uDCCB",
    views: "\uD83D\uDC41️",
    table: "\uD83D\uDCCA",
    view: "\uD83D\uDC53",
    column: "\uD83D\uDCCE",
    indexes: "\uD83D\uDD11",
    index: "\uD83C\uDFF7️"
  };
  return (() => {
    var _el$ = _tmpl$5();
    insert(_el$, () => icons[props.type]);
    return _el$;
  })();
}
function Sidebar(props) {
  const [state, setState] = createStore({
    nodes: [],
    expandedIds: new Set,
    loadingIds: new Set,
    loadedIds: new Set,
    selectedId: null
  });
  const [searchTerm, setSearchTerm] = createSignal("");
  const [contextMenu, setContextMenu] = createSignal(null);
  onMount(() => {
    loadSchemas();
  });
  function findNodePath(nodes, nodeId, path = []) {
    for (let i = 0;i < nodes.length; i++) {
      if (nodes[i].id === nodeId) {
        return [...path, i];
      }
      if (nodes[i].children.length > 0) {
        const found = findNodePath(nodes[i].children, nodeId, [...path, i]);
        if (found)
          return found;
      }
    }
    return null;
  }
  function updateNodeChildren(nodeId, newChildren) {
    setState(produce((s) => {
      const path = findNodePath(s.nodes, nodeId);
      if (!path)
        return;
      let current = s.nodes;
      for (let i = 0;i < path.length - 1; i++) {
        current = current[path[i]].children;
      }
      current[path[path.length - 1]].children = newChildren;
    }));
  }
  async function loadSchemas() {
    const sessionId = getSessionId();
    try {
      const data = await getSchemas(sessionId);
      if (data.schemas) {
        const schemaNodes = data.schemas.map((schema) => ({
          id: `schema:${schema}`,
          name: schema,
          type: "schema",
          schema,
          children: [{
            id: `tables:${schema}`,
            name: "Tables",
            type: "tables",
            schema,
            children: []
          }, {
            id: `views:${schema}`,
            name: "Views",
            type: "views",
            schema,
            children: []
          }]
        }));
        setState("nodes", schemaNodes);
        setState("loadedIds", new Set);
        setState("expandedIds", new Set);
      }
    } catch (e) {
      console.error("加载 schemas 失败:", e);
    }
  }
  async function loadTables(schema) {
    const sessionId = getSessionId();
    try {
      const data = await getTables(sessionId, schema);
      const tablesId = `tables:${schema}`;
      const viewsId = `views:${schema}`;
      const tableChildren = (data.tables || []).map((t) => ({
        id: `table:${schema}.${t}`,
        name: t,
        type: "table",
        schema,
        table: t,
        children: [{
          id: `columns:${schema}.${t}`,
          name: "Columns",
          type: "tables",
          schema,
          table: t,
          children: []
        }, {
          id: `indexes:${schema}.${t}`,
          name: "Indexes",
          type: "indexes",
          schema,
          table: t,
          children: []
        }]
      }));
      updateNodeChildren(tablesId, tableChildren);
      const viewChildren = (data.views || []).map((v) => ({
        id: `view:${schema}.${v}`,
        name: v,
        type: "view",
        schema,
        table: v,
        children: [{
          id: `columns:${schema}.${v}`,
          name: "Columns",
          type: "tables",
          schema,
          table: v,
          children: []
        }]
      }));
      updateNodeChildren(viewsId, viewChildren);
    } catch (e) {
      console.error("加载表失败:", e);
    }
  }
  async function loadColumns(schema, table) {
    const sessionId = getSessionId();
    try {
      const data = await getColumns(sessionId, schema, table);
      const columnsId = `columns:${schema}.${table}`;
      const columnChildren = (data.columns || []).map((col) => ({
        id: `column:${schema}.${table}.${col.column_name}`,
        name: `${col.column_name} : ${col.data_type}${col.is_nullable === "NO" ? " NOT NULL" : ""}`,
        type: "column",
        schema,
        table,
        children: [],
        meta: col
      }));
      updateNodeChildren(columnsId, columnChildren);
    } catch (e) {
      console.error("加载列失败:", e);
    }
  }
  async function loadIndexes(schema, table) {
    const sessionId = getSessionId();
    try {
      const data = await getIndexes(sessionId, schema, table);
      const indexesId = `indexes:${schema}.${table}`;
      const indexChildren = (data.indexes || []).map((idx) => ({
        id: `index:${schema}.${table}.${idx.indexname}`,
        name: idx.indexname,
        type: "index",
        schema,
        table,
        children: [],
        meta: idx
      }));
      updateNodeChildren(indexesId, indexChildren);
    } catch (e) {
      console.error("加载索引失败:", e);
    }
  }
  function toggleNode(node) {
    const isExpanded = state.expandedIds.has(node.id);
    if (!isExpanded) {
      setState("expandedIds", (prev) => new Set(prev).add(node.id));
      if (state.loadedIds.has(node.id))
        return;
      if (node.type === "schema" && node.schema) {
        setState("loadingIds", (prev) => new Set(prev).add(node.id));
        loadTables(node.schema).finally(() => {
          setState("loadingIds", (prev) => {
            const s = new Set(prev);
            s.delete(node.id);
            return s;
          });
          setState("loadedIds", (prev) => new Set(prev).add(node.id));
        });
      } else if ((node.type === "table" || node.type === "view") && node.schema && node.table) {
        setState("loadingIds", (prev) => new Set(prev).add(node.id));
        Promise.all([loadColumns(node.schema, node.table), node.type === "table" ? loadIndexes(node.schema, node.table) : Promise.resolve()]).finally(() => {
          setState("loadingIds", (prev) => {
            const s = new Set(prev);
            s.delete(node.id);
            return s;
          });
          setState("loadedIds", (prev) => new Set(prev).add(node.id));
        });
      }
    } else {
      setState("expandedIds", (prev) => {
        const s = new Set(prev);
        s.delete(node.id);
        return s;
      });
    }
  }
  function handleNodeClick(node, e) {
    e.stopPropagation();
    setState("selectedId", node.id);
    const canExpand = node.type === "schema" || node.type === "table" || node.type === "view" || node.type === "tables" || node.type === "views" || node.type === "indexes";
    if (canExpand) {
      toggleNode(node);
    }
    if (e.detail === 2 && (node.type === "table" || node.type === "view") && node.schema && node.table) {
      const sql = `SELECT * FROM ${node.schema}.${node.table}`;
      props.onQueryRequest?.(sql);
    }
  }
  function handleContextMenu(node, e) {
    e.preventDefault();
    setState("selectedId", node.id);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node
    });
  }
  function closeContextMenu() {
    setContextMenu(null);
  }
  function handleMenuAction(action) {
    const menu = contextMenu();
    if (!menu)
      return;
    const {
      node
    } = menu;
    switch (action) {
      case "select":
        if (node.schema && node.table) {
          props.onQueryRequest?.(`SELECT * FROM ${node.schema}.${node.table}`);
        }
        break;
      case "selectTop100":
        if (node.schema && node.table) {
          props.onQueryRequest?.(`SELECT * FROM ${node.schema}.${node.table} LIMIT 100`);
        }
        break;
      case "count":
        if (node.schema && node.table) {
          props.onQueryRequest?.(`SELECT COUNT(*) FROM ${node.schema}.${node.table}`);
        }
        break;
      case "refresh":
        if (node.type === "schema" && node.schema) {
          setState("loadedIds", (prev) => {
            const s = new Set(prev);
            s.delete(node.id);
            return s;
          });
          loadTables(node.schema);
        }
        break;
    }
    closeContextMenu();
  }
  function filterNodes(nodes, term) {
    if (!term)
      return nodes;
    return nodes.map((node) => {
      if (node.name.toLowerCase().includes(term.toLowerCase())) {
        return node;
      }
      if (node.children.length > 0) {
        const filtered = filterNodes(node.children, term);
        if (filtered.length > 0) {
          return {
            ...node,
            children: filtered
          };
        }
      }
      return null;
    }).filter((n) => n !== null);
  }
  function renderNode(node, depth2 = 0) {
    const isExpanded = () => state.expandedIds.has(node.id);
    const isLoading = () => state.loadingIds.has(node.id);
    const isSelected = () => state.selectedId === node.id;
    const hasChildren = () => node.children.length > 0;
    const canExpand = node.type === "schema" || node.type === "table" || node.type === "view" || node.type === "tables" || node.type === "views" || node.type === "indexes";
    return (() => {
      var _el$2 = _tmpl$42(), _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling;
      _el$3.addEventListener("mouseleave", (e) => !isSelected() && (e.currentTarget.style.backgroundColor = "transparent"));
      _el$3.addEventListener("mouseenter", (e) => !isSelected() && (e.currentTarget.style.backgroundColor = "#1c2e4a"));
      _el$3.$$contextmenu = (e) => handleContextMenu(node, e);
      _el$3.$$click = (e) => handleNodeClick(node, e);
      setStyleProperty(_el$3, "padding-left", `${depth2 * 16 + 8}px`);
      insert(_el$4, () => canExpand ? isLoading() ? "⏳" : "▶" : "");
      insert(_el$3, createComponent(NodeIcon, {
        get type() {
          return node.type;
        }
      }), _el$5);
      insert(_el$5, () => node.name);
      insert(_el$3, createComponent(Show, {
        get when() {
          return memo(() => !!hasChildren())() && isExpanded();
        },
        get children() {
          var _el$6 = _tmpl$24();
          insert(_el$6, () => node.children.length);
          return _el$6;
        }
      }), null);
      insert(_el$2, createComponent(Show, {
        get when() {
          return memo(() => !!isExpanded())() && hasChildren();
        },
        get children() {
          var _el$7 = _tmpl$34();
          insert(_el$7, createComponent(For, {
            get each() {
              return node.children;
            },
            children: (child) => renderNode(child, depth2 + 1)
          }));
          return _el$7;
        }
      }), null);
      createRenderEffect((_p$) => {
        var _v$ = isSelected() ? "#2d4a7c" : "transparent", _v$2 = isSelected() ? "#fff" : "#c9d1d9", _v$3 = isExpanded() ? "rotate(90deg)" : "rotate(0deg)";
        _v$ !== _p$.e && setStyleProperty(_el$3, "background-color", _p$.e = _v$);
        _v$2 !== _p$.t && setStyleProperty(_el$3, "color", _p$.t = _v$2);
        _v$3 !== _p$.a && setStyleProperty(_el$4, "transform", _p$.a = _v$3);
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined
      });
      return _el$2;
    })();
  }
  const filteredTree = () => filterNodes(state.nodes, searchTerm());
  return (() => {
    var _el$8 = _tmpl$52(), _el$9 = _el$8.firstChild, _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling, _el$10 = _el$1.nextSibling, _el$11 = _el$9.nextSibling, _el$12 = _el$11.firstChild, _el$13 = _el$11.nextSibling, _el$14 = _el$13.nextSibling, _el$15 = _el$14.firstChild, _el$16 = _el$15.firstChild;
    _el$8.$$click = closeContextMenu;
    _el$10.addEventListener("mouseleave", (e) => e.currentTarget.style.color = "#6e7681");
    _el$10.addEventListener("mouseenter", (e) => e.currentTarget.style.color = "#c9d1d9");
    _el$10.$$click = loadSchemas;
    _el$12.addEventListener("blur", (e) => e.currentTarget.style.borderColor = "#30363d");
    _el$12.addEventListener("focus", (e) => e.currentTarget.style.borderColor = "#58a6ff");
    _el$12.$$input = (e) => setSearchTerm(e.currentTarget.value);
    insert(_el$13, createComponent(Show, {
      get when() {
        return filteredTree().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$17 = _tmpl$6();
          insert(_el$17, () => searchTerm() ? "未找到匹配项" : "暂无数据，请先连接数据库");
          return _el$17;
        })();
      },
      get children() {
        return createComponent(For, {
          get each() {
            return filteredTree();
          },
          children: (node) => renderNode(node, 0)
        });
      }
    }));
    insert(_el$8, createComponent(Show, {
      get when() {
        return contextMenu();
      },
      children: (menu) => (() => {
        var _el$18 = _tmpl$10();
        _el$18.$$click = (e) => e.stopPropagation();
        insert(_el$18, createComponent(Show, {
          get when() {
            return menu().node.type === "table" || menu().node.type === "view";
          },
          get children() {
            return [(() => {
              var _el$19 = _tmpl$7();
              _el$19.addEventListener("mouseleave", (e) => e.currentTarget.style.backgroundColor = "transparent");
              _el$19.addEventListener("mouseenter", (e) => e.currentTarget.style.backgroundColor = "#21262d");
              _el$19.$$click = () => handleMenuAction("select");
              return _el$19;
            })(), (() => {
              var _el$20 = _tmpl$8();
              _el$20.addEventListener("mouseleave", (e) => e.currentTarget.style.backgroundColor = "transparent");
              _el$20.addEventListener("mouseenter", (e) => e.currentTarget.style.backgroundColor = "#21262d");
              _el$20.$$click = () => handleMenuAction("selectTop100");
              return _el$20;
            })(), (() => {
              var _el$21 = _tmpl$9();
              _el$21.addEventListener("mouseleave", (e) => e.currentTarget.style.backgroundColor = "transparent");
              _el$21.addEventListener("mouseenter", (e) => e.currentTarget.style.backgroundColor = "#21262d");
              _el$21.$$click = () => handleMenuAction("count");
              return _el$21;
            })(), _tmpl$0()];
          }
        }), null);
        insert(_el$18, createComponent(Show, {
          get when() {
            return menu().node.type === "schema";
          },
          get children() {
            var _el$23 = _tmpl$1();
            _el$23.addEventListener("mouseleave", (e) => e.currentTarget.style.backgroundColor = "transparent");
            _el$23.addEventListener("mouseenter", (e) => e.currentTarget.style.backgroundColor = "#21262d");
            _el$23.$$click = () => handleMenuAction("refresh");
            return _el$23;
          }
        }), null);
        createRenderEffect((_p$) => {
          var _v$4 = `${menu().x}px`, _v$5 = `${menu().y}px`;
          _v$4 !== _p$.e && setStyleProperty(_el$18, "left", _p$.e = _v$4);
          _v$5 !== _p$.t && setStyleProperty(_el$18, "top", _p$.t = _v$5);
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$18;
      })()
    }), _el$14);
    insert(_el$15, () => state.nodes.length, null);
    createRenderEffect(() => _el$12.value = searchTerm());
    return _el$8;
  })();
}
delegateEvents(["click", "contextmenu", "input"]);

// ../frontend/sql-to-visual.ts
var import_pgsql_ast_parser = __toESM(require_pgsql_ast_parser(), 1);
var AST_JOIN_TO_OUR = {
  "INNER JOIN": "INNER",
  "LEFT JOIN": "LEFT",
  "RIGHT JOIN": "RIGHT",
  "FULL JOIN": "FULL",
  "CROSS JOIN": "CROSS"
};
function getSchemaAndName(q) {
  const name = q.name ?? q.name;
  const schema = q.schema;
  if (schema) {
    return { schema, name };
  }
  return { schema: "public", name };
}
function getAliasFromAst(q) {
  const alias = q.alias;
  if (alias)
    return alias.toLowerCase();
  const name = q.name ?? q.name;
  return (name || "t").toLowerCase().charAt(0);
}
function ensureUniqueAliases(tables) {
  const used = new Set;
  for (const t of tables) {
    let alias = t.alias.toLowerCase();
    const base = alias;
    let n = 1;
    while (used.has(alias)) {
      alias = base + String(n);
      n++;
    }
    used.add(alias);
    t.alias = alias;
  }
}
function collectFromTables(from) {
  const result = [];
  if (!from || !Array.isArray(from))
    return result;
  for (let i = 0;i < from.length; i++) {
    const item = from[i];
    if (!item)
      continue;
    if (item.type === "table") {
      const name = item.name;
      if (!name)
        continue;
      const { schema, name: tableName } = getSchemaAndName(name);
      const alias = getAliasFromAst(name);
      const joinType = item.join ? AST_JOIN_TO_OUR[item.join.type] ?? "INNER" : undefined;
      result.push({ schema, name: tableName, alias, joinType });
    }
  }
  ensureUniqueAliases(result);
  return result;
}
function exprToSqlLikeString(expr) {
  if (!expr)
    return "";
  switch (expr.type) {
    case "ref": {
      const r = expr;
      const t = r.table?.name;
      const n = r.name;
      return t ? `${t}.${n}` : String(n);
    }
    case "string":
      return `'${expr.value.replace(/'/g, "''")}'`;
    case "integer":
    case "numeric":
      return String(expr.value);
    case "boolean":
      return expr.value ? "true" : "false";
    case "null":
      return "NULL";
    case "binary": {
      const b = expr;
      const left = exprToSqlLikeString(b.left);
      const right = exprToSqlLikeString(b.right);
      const op = b.op;
      return `${left} ${op} ${right}`;
    }
    case "unary": {
      const u = expr;
      return `${u.op} ${exprToSqlLikeString(u.operand)}`;
    }
    case "call": {
      const c = expr;
      const fn = c.function?.name ?? "?";
      const args = (c.args || []).map(exprToSqlLikeString).join(", ");
      return `${fn}(${args})`;
    }
    default:
      return String(expr.type);
  }
}
function collectJoinOnConditions(expr) {
  const conditions = [];
  if (!expr)
    return conditions;
  function extractRef(e) {
    if (e.type === "ref") {
      const r = e;
      const alias = r.table?.name ?? "";
      const col = r.name === "*" ? "" : r.name;
      return { alias: alias.toLowerCase(), column: col };
    }
    return null;
  }
  function collect(e) {
    if (e.type === "binary") {
      const b = e;
      if (b.op === "AND") {
        collect(b.left);
        collect(b.right);
        return;
      }
      if (b.op === "=" || b.op === "!=" || b.op === ">" || b.op === "<" || b.op === ">=" || b.op === "<=") {
        const left = extractRef(b.left);
        const right = extractRef(b.right);
        if (left && right && left.column && right.column) {
          conditions.push({
            leftAlias: left.alias,
            leftColumn: left.column,
            rightAlias: right.alias,
            rightColumn: right.column,
            operator: b.op
          });
        }
      }
    }
  }
  collect(expr);
  return conditions;
}
function collectSelectedColumns(columns) {
  const result = [];
  if (!columns || !Array.isArray(columns))
    return result;
  for (const col of columns) {
    const expr = col.expr;
    const alias = col.alias?.name;
    if (expr.type === "ref") {
      const r = expr;
      const tableAlias = (r.table?.name ?? "").toLowerCase();
      const columnName = r.name === "*" ? "" : r.name;
      if (columnName) {
        result.push({ tableAlias, columnName, alias });
      }
      continue;
    }
    if (expr.type === "call") {
      const c = expr;
      const fn = (c.function?.name ?? "").toUpperCase();
      const agg = ["COUNT", "SUM", "AVG", "MAX", "MIN"].includes(fn) ? fn : undefined;
      const inner = c.args?.[0];
      let tableAlias = "";
      let columnName = "";
      if (inner?.type === "ref") {
        const r = inner;
        tableAlias = (r.table?.name ?? "").toLowerCase();
        columnName = r.name === "*" ? "*" : r.name;
      }
      result.push({
        tableAlias,
        columnName: columnName || fn,
        alias,
        aggregation: agg ?? "",
        expression: exprToSqlLikeString(expr)
      });
      continue;
    }
    result.push({
      tableAlias: "",
      columnName: "",
      alias,
      expression: exprToSqlLikeString(expr)
    });
  }
  return result;
}
function collectWhereConditions(expr) {
  const result = [];
  if (!expr)
    return result;
  const opMap = (op) => {
    const m = {
      "=": "=",
      "!=": "!=",
      ">": ">",
      "<": "<",
      ">=": ">=",
      "<=": "<=",
      LIKE: "LIKE",
      "NOT LIKE": "LIKE",
      IN: "IN",
      "NOT IN": "IN",
      "IS NULL": "IS NULL",
      "IS NOT NULL": "IS NOT NULL",
      BETWEEN: "BETWEEN",
      "NOT BETWEEN": "BETWEEN"
    };
    return m[op] ?? "=";
  };
  function collect(e, logicalOp) {
    if (e.type === "binary") {
      const b = e;
      if (b.op === "AND" || b.op === "OR") {
        collect(b.left, b.op);
        collect(b.right, b.op);
        return;
      }
      const left = exprToSqlLikeString(b.left);
      const right = exprToSqlLikeString(b.right);
      result.push({
        leftOperand: left,
        operator: opMap(b.op),
        rightOperand: right,
        logicalOperator: logicalOp
      });
      return;
    }
    if (e.type === "unary") {
      const u = e;
      if (u.op === "IS NULL" || u.op === "IS NOT NULL") {
        result.push({
          leftOperand: exprToSqlLikeString(u.operand),
          operator: u.op,
          rightOperand: "",
          logicalOperator: "AND"
        });
      }
    }
  }
  collect(expr, "AND");
  return result;
}
function collectOrderBy(orderBy) {
  const result = [];
  if (!orderBy || !Array.isArray(orderBy))
    return result;
  for (const o of orderBy) {
    result.push({
      column: exprToSqlLikeString(o.by),
      direction: o.order === "DESC" ? "DESC" : "ASC"
    });
  }
  return result;
}
function getLimit(limitStmt) {
  if (!limitStmt?.limit)
    return;
  const e = limitStmt.limit;
  if (e?.type === "integer")
    return e.value;
  return;
}
function parseSqlToVisualDescriptor(sql) {
  const empty = {
    tables: [],
    selectedColumns: [],
    joinConditions: [],
    whereConditions: [],
    sortColumns: [],
    distinct: false
  };
  const trimmed = sql.trim();
  if (!trimmed)
    return empty;
  try {
    const stmt = import_pgsql_ast_parser.parseFirst(trimmed);
    if (!stmt || stmt.type !== "select") {
      return { ...empty, error: "仅支持 SELECT 语句" };
    }
    const select = stmt;
    const from = select.from;
    const fromArray = Array.isArray(from) ? from : from ? [from] : [];
    const tables = collectFromTables(fromArray);
    const joinConditions = [];
    for (let i = 1;i < fromArray.length; i++) {
      const item = fromArray[i];
      if (item?.type === "table" && item.join?.on) {
        joinConditions.push(...collectJoinOnConditions(item.join.on));
      }
    }
    const selectedColumns = collectSelectedColumns(select.columns);
    const whereConditions = collectWhereConditions(select.where);
    const sortColumns = collectOrderBy(select.orderBy);
    const limit = getLimit(select.limit);
    const distinct = select.distinct === "distinct";
    return {
      tables,
      selectedColumns,
      joinConditions,
      whereConditions,
      sortColumns,
      distinct,
      limit,
      bestEffortHint: true
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ...empty, error: `SQL 解析失败: ${message}` };
  }
}

// ../frontend/visual-query-builder.tsx
var _tmpl$11 = /* @__PURE__ */ template(`<div class=canvas-table style=position:absolute;width:200px;background-color:#1e293b;border-radius:8px;cursor:move;user-select:none;pointer-events:auto><div class=table-header style="padding:8px 10px;border-radius:7px 7px 0 0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;font-weight:600;font-size:12px;color:#e2e8f0"><div style=display:flex;align-items:center;flex-wrap:wrap;gap:4px;min-width:0;flex:1><span style="color:#0f172a;padding:2px 5px;border-radius:3px;font-size:9px;font-weight:700;flex-shrink:0"></span><span><span style=color:#94a3b8;margin-left:3px;font-weight:normal;font-size:11px>(<!>)</span></span></div><button style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:2px 4px;border-radius:4px;flex-shrink:0">✕</button></div><div style="padding:4px 0">`);
var _tmpl$25 = /* @__PURE__ */ template(`<span style="color:#0f172a;padding:2px 5px;border-radius:3px;font-size:9px;font-weight:600;flex-shrink:0"> JOIN`);
var _tmpl$35 = /* @__PURE__ */ template(`<div class=column-item style="padding:6px 12px;font-size:12px;cursor:grab;display:flex;align-items:center;gap:6px;transition:background-color 0.15s"><span style="width:16px;height:16px;display:flex;align-items:center;justify-content:center;border-radius:3px;border:1px solid #475569;font-size:10px">✓</span><span style=flex:1></span><span style=color:#64748b;font-size:10px></span><span title="拖拽到其他表的列创建 JOIN"style=color:#64748b;font-size:10px;opacity:0.5>\uD83D\uDD17`);
var _tmpl$43 = /* @__PURE__ */ template(`<button style="padding:8px 16px;background-color:#475569;color:#fff;border:none;border-radius:6px;cursor:pointer">关闭`);
var _tmpl$53 = /* @__PURE__ */ template(`<div style="padding:8px 16px;background-color:rgba(248, 113, 113, 0.15);color:#f87171;font-size:13px;border-bottom:1px solid #334155"><button type=button style="margin-left:12px;padding:2px 8px;background:transparent;color:#f87171;border:1px solid currentColor;border-radius:4px;cursor:pointer">关闭`);
var _tmpl$62 = /* @__PURE__ */ template(`<div style="padding:8px 16px;background-color:rgba(245, 158, 11, 0.15);color:#f59e0b;font-size:13px;border-bottom:1px solid #334155;display:flex;align-items:center;justify-content:space-between"><span>我们已经尽力解析并生成可视化图，请核对后使用。</span><button type=button style="padding:2px 8px;background:transparent;color:#f59e0b;border:1px solid currentColor;border-radius:4px;cursor:pointer;flex-shrink:0">知道了`);
var _tmpl$72 = /* @__PURE__ */ template(`<div style=color:#f87171;font-size:12px;margin-top:8px>`);
var _tmpl$82 = /* @__PURE__ */ template(`<div style=position:fixed;inset:0;background-color:rgba(0,0,0,0.6);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px><div style="width:100%;max-width:560px;background-color:#1e293b;border-radius:12px;padding:20px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5)"><div style=font-size:16px;font-weight:600;margin-bottom:12px;color:#e2e8f0>\uD83D\uDCE5 从 SQL 生成可视化图</div><p style=font-size:12px;color:#94a3b8;margin-bottom:12px>粘贴一条 SELECT 语句，将自动解析 FROM、JOIN、WHERE、ORDER BY、LIMIT 等并生成画布。</p><textarea placeholder="例如：
SELECT a.id, a.name, b.id FROM student a LEFT JOIN student b ON a.id = b.id"style="width:100%;height:140px;box-sizing:border-box;padding:12px;font-size:13px;font-family:'JetBrains Mono', monospace;background-color:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:8px;resize:vertical"></textarea><div style=display:flex;justify-content:flex-end;gap:8px;margin-top:16px><button style="padding:8px 16px;background-color:#475569;color:#fff;border:none;border-radius:6px">取消</button><button style="padding:8px 16px;background-color:#10b981;color:#fff;border:none;border-radius:6px">`);
var _tmpl$92 = /* @__PURE__ */ template(`<div style="position:absolute;top:50%;left:50%;transform:translate(-50%, -50%);text-align:center;color:#64748b;z-index:5"><div style=font-size:48px;margin-bottom:16px>\uD83D\uDCE5</div><div style=font-size:14px>从左侧拖拽表到这里开始构建查询`);
var _tmpl$02 = /* @__PURE__ */ template(`<div style=padding:20px;text-align:center;color:#64748b;background-color:#1e293b;border-radius:6px>点击表中的列来选择`);
var _tmpl$12 = /* @__PURE__ */ template(`<div style=font-size:12px><div style=display:flex;justify-content:space-between;align-items:center;margin-bottom:12px><span style=color:#94a3b8;font-weight:600>选中的列</span><span style=color:#64748b> 列`);
var _tmpl$102 = /* @__PURE__ */ template(`<div style=font-size:12px><button style=width:100%;padding:8px;background-color:#334155;color:#e2e8f0;border:none;border-radius:6px;cursor:pointer;margin-bottom:12px;display:flex;align-items:center;justify-content:center;gap:6px><span>+</span> 添加条件`);
var _tmpl$112 = /* @__PURE__ */ template(`<div style=padding:20px;text-align:center;color:#64748b;background-color:#1e293b;border-radius:6px><div style=margin-bottom:8px>添加更多表来配置 JOIN</div><div style=font-size:11px>\uD83D\uDCA1 拖拽列到另一个表的列来创建 ON 条件`);
var _tmpl$122 = /* @__PURE__ */ template(`<div style=margin-top:16px;padding:10px;background-color:#0f172a;border-radius:6px><div style=color:#64748b;font-size:11px;margin-bottom:8px>所有 ON 条件 (<!>)`);
var _tmpl$13 = /* @__PURE__ */ template(`<div style=font-size:12px>`);
var _tmpl$14 = /* @__PURE__ */ template(`<div style=font-size:12px><button style=width:100%;padding:8px;background-color:#334155;color:#e2e8f0;border:none;border-radius:6px;cursor:pointer;margin-bottom:12px;display:flex;align-items:center;justify-content:center;gap:6px><span>+</span> 添加排序`);
var _tmpl$15 = /* @__PURE__ */ template(`<div style=font-size:12px><div style=padding:12px;background-color:#1e293b;border-radius:6px;margin-bottom:12px><label style=display:flex;align-items:center;gap:8px;color:#cbd5e1;cursor:pointer><input type=checkbox style=accent-color:#3b82f6>SELECT DISTINCT</label></div><div style=padding:12px;background-color:#1e293b;border-radius:6px><div style=color:#94a3b8;margin-bottom:8px>LIMIT</div><input type=number placeholder=无限制 style="width:100%;padding:8px;background-color:#0f172a;border:1px solid #334155;border-radius:4px;color:#e2e8f0;font-size:12px;box-sizing:border-box">`);
var _tmpl$16 = /* @__PURE__ */ template(`<div style="display:flex;flex-direction:column;height:100%;background-color:#0f172a;color:#e2e8f0;font-family:'JetBrains Mono', 'Fira Code', monospace"><div style="padding:12px 16px;border-bottom:1px solid #334155;display:flex;align-items:center;gap:12px;background-color:#1e293b"><span style=font-size:16px;font-weight:600>\uD83D\uDD27 Visual Query Builder</span><div style=flex:1></div><button style="padding:8px 16px;background-color:#334155;color:#e2e8f0;border:none;border-radius:6px;cursor:pointer;font-size:13px">\uD83D\uDCE5 从 SQL 导入</button><button style="padding:8px 20px;color:#fff;border:none;border-radius:6px;font-weight:500;display:flex;align-items:center;gap:6px"><span>▶</span> 执行查询</button></div><div style=flex:1;display:flex;overflow:hidden><div style="width:220px;border-right:1px solid #334155;display:flex;flex-direction:column;background-color:#0f172a"><div style="padding:12px;border-bottom:1px solid #334155;font-size:13px;font-weight:600;color:#94a3b8">\uD83D\uDCCB 可用表 </div><div style=flex:1;overflow-y:auto;padding:8px></div></div><div style=flex:1;display:flex;flex-direction:column;overflow:hidden><div style="padding:6px 12px;background-color:#1e293b;border-bottom:1px solid #334155;display:flex;align-items:center;gap:8px;font-size:12px"><span style=color:#64748b>缩放:</span><button style="padding:4px 10px;background-color:#334155;color:#e2e8f0;border:none;border-radius:4px;cursor:pointer">−</button><span style=color:#94a3b8;min-width:50px;text-align:center>%</span><button style="padding:4px 10px;background-color:#334155;color:#e2e8f0;border:none;border-radius:4px;cursor:pointer">+</button><button style="padding:4px 10px;background-color:#334155;color:#e2e8f0;border:none;border-radius:4px;cursor:pointer">重置</button><button style="padding:4px 10px;background-color:#334155;color:#e2e8f0;border:none;border-radius:4px;cursor:pointer">适应内容</button><span style=color:#64748b;margin-left:auto;font-size:11px>\uD83D\uDCA1 滚轮缩放 | 拖拽空白区域平移</span></div><div style=flex:1;position:relative;overflow:hidden;background-color:#0f172a;min-height:300px;user-select:none><div style="position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none"><svg style=position:absolute;top:0;left:0;width:10000px;height:10000px;pointer-events:none;z-index:0;overflow:visible><defs><marker id=arrow-inner markerWidth=10 markerHeight=10 refX=8 refY=3 orient=auto markerUnits=strokeWidth><path d="M0,0 L0,6 L9,3 z"fill=#3b82f6></path></marker><marker id=arrow-left markerWidth=10 markerHeight=10 refX=8 refY=3 orient=auto markerUnits=strokeWidth><path d="M0,0 L0,6 L9,3 z"fill=#22c55e></path></marker><marker id=arrow-right markerWidth=10 markerHeight=10 refX=8 refY=3 orient=auto markerUnits=strokeWidth><path d="M0,0 L0,6 L9,3 z"fill=#f59e0b></path></marker><marker id=arrow-full markerWidth=10 markerHeight=10 refX=8 refY=3 orient=auto markerUnits=strokeWidth><path d="M0,0 L0,6 L9,3 z"fill=#a855f7></path></marker><marker id=arrow-cross markerWidth=10 markerHeight=10 refX=8 refY=3 orient=auto markerUnits=strokeWidth><path d="M0,0 L0,6 L9,3 z"fill=#ef4444></path></marker></defs></svg></div></div><div style="height:150px;border-top:1px solid #334155;background-color:#1e293b;display:flex;flex-direction:column"><div style="padding:8px 12px;border-bottom:1px solid #334155;font-size:12px;font-weight:600;color:#94a3b8;display:flex;align-items:center;gap:8px">\uD83D\uDCDD 生成的 SQL<button style="margin-left:auto;padding:4px 12px;background-color:#334155;color:#94a3b8;border:none;border-radius:4px;font-size:11px">\uD83D\uDCCB 复制</button></div><pre style=flex:1;margin:0;padding:12px;overflow-y:auto;font-size:12px;color:#10b981;white-space:pre-wrap;word-break:break-all></pre></div></div><div style="width:320px;border-left:1px solid #334155;display:flex;flex-direction:column;background-color:#0f172a"><div style="display:flex;border-bottom:1px solid #334155"></div><div style=flex:1;overflow-y:auto;padding:12px>`);
var _tmpl$17 = /* @__PURE__ */ template(`<div style=padding-left:20px>`);
var _tmpl$18 = /* @__PURE__ */ template(`<div style=margin-bottom:4px><div style="padding:6px 8px;cursor:pointer;display:flex;align-items:center;gap:6px;border-radius:4px;font-size:12px;color:#94a3b8"><span style="transition:transform 0.2s">▶</span>\uD83D\uDCC1 <span style=color:#64748b;font-size:10px>(<!>)`);
var _tmpl$19 = /* @__PURE__ */ template(`<div style="padding:5px 8px;cursor:grab;font-size:12px;color:#cbd5e1;border-radius:4px;display:flex;align-items:center;gap:6px">\uD83D\uDCCA `);
var _tmpl$20 = /* @__PURE__ */ template(`<svg><g style=cursor:pointer;pointer-events:auto><line stroke=transparent stroke-width=12 style=pointer-events:stroke></line><line stroke-width=2 style=pointer-events:none></line><circle r=4 style=pointer-events:none></circle><g style=cursor:pointer;pointer-events:auto><rect width=50 height=18 rx=4 fill=#0f172a stroke-width=1></rect><text font-size=10 font-weight=600 text-anchor=middle></svg>`, false, true, false);
var _tmpl$21 = /* @__PURE__ */ template(`<button style="flex:1;padding:10px 8px;border:none;cursor:pointer;font-size:11px;font-weight:500;transition:all 0.15s"> `);
var _tmpl$222 = /* @__PURE__ */ template(`<div style="padding:10px;border-radius:6px;margin-bottom:8px;cursor:grab;transition:all 0.15s ease"><div style=display:flex;justify-content:space-between;align-items:center;margin-bottom:8px><span style=color:#64748b;cursor:grab;margin-right:8px>⋮⋮</span><span style=color:#cbd5e1;flex:1>.</span><button style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:2px 6px">✕</button></div><div style=display:flex;gap:8px;flex-wrap:wrap><input type=text placeholder=别名 style="flex:1;min-width:80px;padding:4px 8px;background-color:#0f172a;border:1px solid #334155;border-radius:4px;color:#e2e8f0;font-size:11px"><select style="padding:4px 8px;background-color:#0f172a;border:1px solid #334155;border-radius:4px;color:#e2e8f0;font-size:11px"><option value>无聚合</option><option value=COUNT>COUNT</option><option value=SUM>SUM</option><option value=AVG>AVG</option><option value=MAX>MAX</option><option value=MIN>MIN</option></select></div><label style=display:flex;align-items:center;gap:6px;margin-top:8px;color:#94a3b8;font-size:11px;cursor:pointer><input type=checkbox style=accent-color:#3b82f6>GROUP BY 此列`);
var _tmpl$232 = /* @__PURE__ */ template(`<select style="padding:4px 8px;background-color:#0f172a;border:1px solid #334155;border-radius:4px;color:#e2e8f0;font-size:11px"><option value=AND>AND</option><option value=OR>OR`);
var _tmpl$242 = /* @__PURE__ */ template(`<input type=text placeholder=值 style="flex:1;min-width:80px;padding:4px 8px;background-color:#0f172a;border:1px solid #334155;border-radius:4px;color:#e2e8f0;font-size:11px">`);
var _tmpl$252 = /* @__PURE__ */ template(`<div style="padding:10px;border-radius:6px;margin-bottom:8px;cursor:grab;transition:all 0.15s ease"><div style=display:flex;align-items:center;gap:8px><span style=color:#64748b;cursor:grab>⋮⋮</span></div><div style=display:flex;gap:6px;align-items:center;flex-wrap:wrap><select style="flex:1;min-width:100px;padding:4px 8px;background-color:#0f172a;border:1px solid #334155;border-radius:4px;color:#e2e8f0;font-size:11px"><option value>选择列</option></select><select style="padding:4px 8px;background-color:#0f172a;border:1px solid #334155;border-radius:4px;color:#e2e8f0;font-size:11px"><option value="=">=</option><option value="!=">!=</option><option value=">">&gt;</option><option value="<">&lt;</option><option value=">=">&gt;=</option><option value="<=">&lt;=</option><option value=LIKE>LIKE</option><option value=IN>IN</option><option value="IS NULL">IS NULL</option><option value="IS NOT NULL">IS NOT NULL</option></select><button style="padding:4px 8px;background:none;border:none;color:#ef4444;cursor:pointer">✕`);
var _tmpl$26 = /* @__PURE__ */ template(`<option>`);
var _tmpl$27 = /* @__PURE__ */ template(`<div style=color:#94a3b8;font-size:11px;margin-bottom:6px>ON 条件:`);
var _tmpl$28 = /* @__PURE__ */ template(`<div style=color:#64748b;font-size:11px;padding:8px;background-color:#0f172a;border-radius:4px;text-align:center>无 ON 条件（CROSS JOIN）`);
var _tmpl$29 = /* @__PURE__ */ template(`<div style="padding:10px;border-radius:6px;margin-bottom:8px;cursor:grab;transition:all 0.15s ease"><div style=display:flex;align-items:center;gap:8px;margin-bottom:8px><span style=color:#64748b;cursor:grab>⋮⋮</span><span style="background-color:#3b82f6;color:#0f172a;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700">#</span><span style=color:#cbd5e1;font-weight:600> (<!>)</span><select style="margin-left:auto;padding:4px 8px;background-color:#0f172a;border:1px solid #334155;border-radius:4px;font-size:11px;font-weight:600"><option value=INNER>INNER JOIN</option><option value=LEFT>LEFT JOIN</option><option value=RIGHT>RIGHT JOIN</option><option value=FULL>FULL JOIN</option><option value=CROSS>CROSS JOIN`);
var _tmpl$30 = /* @__PURE__ */ template(`<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;padding:6px 8px;background-color:#0f172a;border-radius:4px"><span style=color:#94a3b8;font-size:11px;flex:1> <!> </span><button title=删除此条件 style="padding:2px 6px;background:none;border:none;color:#ef4444;cursor:pointer;font-size:12px">✕`);
var _tmpl$31 = /* @__PURE__ */ template(`<div style=display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:11px;color:#94a3b8><span style=flex:1> <!> </span><button style="padding:2px 6px;background:none;border:none;color:#ef4444;cursor:pointer">✕`);
var _tmpl$322 = /* @__PURE__ */ template(`<div style="padding:10px;border-radius:6px;margin-bottom:8px;display:flex;gap:8px;align-items:center;cursor:grab;transition:all 0.15s ease"><span style=color:#64748b;cursor:grab>⋮⋮</span><select style="flex:1;padding:6px 8px;background-color:#0f172a;border:1px solid #334155;border-radius:4px;color:#e2e8f0;font-size:11px"><option value>选择列</option></select><select style="padding:6px 8px;background-color:#0f172a;border:1px solid #334155;border-radius:4px;color:#e2e8f0;font-size:11px"><option value=ASC>升序 ↑</option><option value=DESC>降序 ↓</option></select><button style="padding:4px 8px;background:none;border:none;color:#ef4444;cursor:pointer">✕`);
var _tmpl$332 = /* @__PURE__ */ template(`<div style=position:fixed;top:0;left:0;right:0;bottom:0;z-index:999>`);
var _tmpl$342 = /* @__PURE__ */ template(`<div style=height:1px;background-color:#475569>`);
var _tmpl$352 = /* @__PURE__ */ template(`<div style="padding:8px 14px;color:#64748b;font-size:11px">JOIN 类型`);
var _tmpl$36 = /* @__PURE__ */ template(`<div style="position:fixed;background-color:#1e293b;border:1px solid #475569;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.4);z-index:1000;min-width:160px;overflow:hidden"><div style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;background-color:transparent"><span>\uD83D\uDC51</span><span></span></div><div style=height:1px;background-color:#475569></div><div style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;color:#ef4444;font-size:13px;background-color:transparent"><span>\uD83D\uDDD1️</span><span>移除表`);
var _tmpl$37 = /* @__PURE__ */ template(`<span style=margin-left:auto>✓`);
var _tmpl$38 = /* @__PURE__ */ template(`<div style="padding:8px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:12px"><span style=width:8px;height:8px;border-radius:50%></span><span>`);
var _tmpl$39 = /* @__PURE__ */ template(`<div style="position:fixed;background-color:#1e293b;border:1px solid #475569;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.4);z-index:1000;min-width:180px;overflow:hidden"><div style="padding:8px 14px;color:#94a3b8;font-size:11px;border-bottom:1px solid #334155;background-color:#0f172a"> = </div><div style="padding:8px 14px;color:#64748b;font-size:11px;border-bottom:1px solid #334155"> 的 JOIN 类型</div><div style=height:1px;background-color:#475569></div><div style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;color:#ef4444;font-size:13px;background-color:transparent"><span>\uD83D\uDDD1️</span><span>删除连接`);
var _tmpl$40 = /* @__PURE__ */ template(`<div style="padding:8px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px"><span style=width:8px;height:8px;border-radius:50%></span><span>`);
function generateId() {
  return Math.random().toString(36).substring(2, 11);
}
function VisualQueryBuilder(props) {
  const [availableTables, setAvailableTables] = createStore([]);
  const [loadingTables, setLoadingTables] = createSignal(false);
  const [expandedSchemas, setExpandedSchemas] = createSignal(new Set);
  const [tableColumns, setTableColumns] = createStore({});
  const [tableForeignKeys, setTableForeignKeys] = createStore({});
  const [queryState, setQueryState] = createStore({
    tables: [],
    selectedColumns: [],
    whereConditions: [],
    joinConditions: [],
    sortColumns: [],
    distinct: false
  });
  const [activeTab, setActiveTab] = createSignal("columns");
  const [draggedTable, setDraggedTable] = createSignal(null);
  const [canvasRef, setCanvasRef] = createSignal(null);
  const [draggingTableId, setDraggingTableId] = createSignal(null);
  const [dragOffset, setDragOffset] = createSignal({
    x: 0,
    y: 0
  });
  const [selectedTableId, setSelectedTableId] = createSignal(null);
  const [joinLineStart, setJoinLineStart] = createSignal(null);
  const [tableContextMenu, setTableContextMenu] = createSignal(null);
  const [joinContextMenu, setJoinContextMenu] = createSignal(null);
  const [scale, setScale] = createSignal(1);
  const [panOffset, setPanOffset] = createSignal({
    x: 0,
    y: 0
  });
  const [isPanning, setIsPanning] = createSignal(false);
  const [panStart, setPanStart] = createSignal({
    x: 0,
    y: 0
  });
  const [dragSortItem, setDragSortItem] = createSignal(null);
  const [dragOverItem, setDragOverItem] = createSignal(null);
  const [showImportSql, setShowImportSql] = createSignal(false);
  const [importSqlText, setImportSqlText] = createSignal("");
  const [importSqlError, setImportSqlError] = createSignal(null);
  const [applyingSql, setApplyingSql] = createSignal(false);
  const [initialSqlApplied, setInitialSqlApplied] = createSignal(false);
  const [showBestEffortHint, setShowBestEffortHint] = createSignal(false);
  async function loadAvailableTables() {
    setLoadingTables(true);
    try {
      const sessionId = getSessionId();
      const schemasData = await getSchemas(sessionId);
      if (schemasData.schemas) {
        const schemaList = [];
        for (const schema of schemasData.schemas) {
          const tablesData = await getTables(sessionId, schema);
          schemaList.push({
            schema,
            tables: [...tablesData.tables || [], ...tablesData.views || []]
          });
        }
        setAvailableTables(schemaList);
      }
    } catch (e) {
      console.error("加载表列表失败:", e);
    } finally {
      setLoadingTables(false);
    }
  }
  async function loadTableColumns(schema, table) {
    const key = `${schema}.${table}`;
    if (tableColumns[key]) {
      return tableColumns[key];
    }
    try {
      const sessionId = getSessionId();
      const data = await getColumns(sessionId, schema, table);
      const columns = (data.columns || []).map((col) => ({
        name: col.column_name,
        dataType: col.data_type,
        isNullable: col.is_nullable === "YES",
        isPrimaryKey: false
      }));
      setTableColumns(key, columns);
      return columns;
    } catch (e) {
      console.error("加载列信息失败:", e);
      return [];
    }
  }
  async function loadTableForeignKeys(schema, table) {
    const key = `${schema}.${table}`;
    if (tableForeignKeys[key]) {
      return tableForeignKeys[key];
    }
    try {
      const sessionId = getSessionId();
      const data = await getForeignKeys(sessionId, schema, table);
      const fkInfo = {
        outgoing: data.outgoing || [],
        incoming: data.incoming || []
      };
      setTableForeignKeys(key, fkInfo);
      return fkInfo;
    } catch (e) {
      console.error("加载外键信息失败:", e);
      return {
        outgoing: [],
        incoming: []
      };
    }
  }
  async function applyParsedDescriptor(descriptor) {
    if (descriptor.error || descriptor.tables.length === 0) {
      setImportSqlError(descriptor.error ?? "未解析到任何表");
      return;
    }
    setApplyingSql(true);
    setImportSqlError(null);
    try {
      const aliasToId = new Map;
      const tables = [];
      const TABLE_SPACING = 280;
      const START_Y = 80;
      for (let i = 0;i < descriptor.tables.length; i++) {
        const t = descriptor.tables[i];
        const tableId = generateId();
        aliasToId.set(t.alias.toLowerCase(), tableId);
        let columns = [];
        try {
          columns = await loadTableColumns(t.schema, t.name);
        } catch {}
        tables.push({
          id: tableId,
          schema: t.schema,
          name: t.name,
          alias: t.alias,
          columns,
          position: {
            x: i * TABLE_SPACING,
            y: START_Y
          },
          selectedColumns: new Set,
          joinType: t.joinType
        });
      }
      const primaryTableId = tables[0]?.id;
      const joinConditions = [];
      for (const jc of descriptor.joinConditions) {
        const leftId = aliasToId.get(jc.leftAlias.toLowerCase());
        const rightId = aliasToId.get(jc.rightAlias.toLowerCase());
        if (leftId && rightId) {
          const leftTable = tables.find((t) => t.id === leftId);
          const rightTable = tables.find((t) => t.id === rightId);
          joinConditions.push({
            id: generateId(),
            leftTableId: leftId,
            leftColumn: `${jc.leftAlias}.${jc.leftColumn}`,
            rightTableId: rightId,
            rightColumn: `${jc.rightAlias}.${jc.rightColumn}`,
            operator: jc.operator
          });
        }
      }
      const selectedColumns = [];
      for (const sc of descriptor.selectedColumns) {
        const tableId = sc.tableAlias ? aliasToId.get(sc.tableAlias.toLowerCase()) : undefined;
        const table = tableId ? tables.find((t) => t.id === tableId) : undefined;
        const columnName = sc.columnName || (sc.expression ? "expr" : "");
        if (table && columnName === "*") {
          for (const col of table.columns) {
            selectedColumns.push({
              id: generateId(),
              tableId: table.id,
              columnName: col.name,
              alias: "",
              aggregation: sc.aggregation ?? "",
              isGroupBy: false
            });
          }
        } else if (table && (table.columns.some((c) => c.name === columnName) || sc.expression)) {
          selectedColumns.push({
            id: generateId(),
            tableId: table.id,
            columnName: columnName || (table.columns[0]?.name ?? ""),
            alias: sc.alias ?? "",
            expression: sc.expression,
            aggregation: sc.aggregation ?? "",
            isGroupBy: false
          });
        } else if (table && !columnName && sc.expression) {
          selectedColumns.push({
            id: generateId(),
            tableId: table.id,
            columnName: table.columns[0]?.name ?? "",
            alias: sc.alias ?? "",
            expression: sc.expression,
            aggregation: sc.aggregation ?? "",
            isGroupBy: false
          });
        }
      }
      const whereConditions = descriptor.whereConditions.map((w) => ({
        id: generateId(),
        leftOperand: w.leftOperand,
        operator: w.operator,
        rightOperand: w.rightOperand,
        logicalOperator: w.logicalOperator
      }));
      const sortColumns = descriptor.sortColumns.map((s) => ({
        id: generateId(),
        column: s.column,
        direction: s.direction
      }));
      setQueryState(produce((draft) => {
        draft.tables = tables;
        draft.selectedColumns = selectedColumns;
        draft.whereConditions = whereConditions;
        draft.joinConditions = joinConditions;
        draft.sortColumns = sortColumns;
        draft.distinct = descriptor.distinct;
        draft.limit = descriptor.limit;
        draft.primaryTableId = primaryTableId;
      }));
      if (descriptor.bestEffortHint) {
        setShowBestEffortHint(true);
      }
      setShowImportSql(false);
      setImportSqlText("");
    } catch (e) {
      setImportSqlError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingSql(false);
    }
  }
  function applySqlFromText(sql) {
    const descriptor = parseSqlToVisualDescriptor(sql.trim());
    applyParsedDescriptor(descriptor);
  }
  onMount(() => {
    loadAvailableTables();
  });
  createEffect(() => {
    const sql = props.initialSql?.trim();
    if (!sql || initialSqlApplied())
      return;
    setInitialSqlApplied(true);
    const descriptor = parseSqlToVisualDescriptor(sql);
    if (descriptor.error) {
      setImportSqlError(descriptor.error);
      return;
    }
    if (descriptor.tables.length === 0) {
      setImportSqlError("未解析到任何表，请确保 SQL 包含 FROM 子句");
      return;
    }
    applyParsedDescriptor(descriptor);
  });
  function toggleSchema(schema) {
    setExpandedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(schema)) {
        next.delete(schema);
      } else {
        next.add(schema);
      }
      return next;
    });
  }
  function handleTableDragStart(e, schema, table) {
    setDraggedTable({
      schema,
      name: table
    });
    e.dataTransfer?.setData("text/plain", JSON.stringify({
      schema,
      table
    }));
  }
  function handleCanvasDrop(e) {
    e.preventDefault();
    const draggedData = draggedTable();
    if (!draggedData)
      return;
    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    addTableToCanvas(draggedData.schema, draggedData.name, canvasPos.x, canvasPos.y);
    setDraggedTable(null);
  }
  async function addTableToCanvas(schema, name, x, y) {
    const columns = await loadTableColumns(schema, name);
    const foreignKeys = await loadTableForeignKeys(schema, name);
    const tableId = generateId();
    const base = name.charAt(0).toLowerCase();
    const existingAliases = new Set(queryState.tables.map((t) => t.alias));
    let alias = base;
    if (existingAliases.has(alias)) {
      let i = 2;
      while (existingAliases.has(`${base}${i}`))
        i++;
      alias = `${base}${i}`;
    }
    const existingTables = [...queryState.tables];
    const isFirstTable = existingTables.length === 0;
    const newTable = {
      id: tableId,
      schema,
      name,
      alias: alias.toLowerCase(),
      columns,
      position: {
        x,
        y
      },
      selectedColumns: new Set,
      joinType: isFirstTable ? undefined : "INNER"
    };
    setQueryState("tables", (prev) => [...prev, newTable]);
    if (isFirstTable) {
      setQueryState("primaryTableId", tableId);
    }
    if (existingTables.length > 0) {
      const autoConditions = [];
      for (const fk of foreignKeys.outgoing) {
        const targetTable = existingTables.find((t) => t.schema === fk.target_schema && t.name === fk.target_table);
        if (targetTable) {
          const existingCondition = queryState.joinConditions.find((c) => c.leftTableId === tableId && c.rightTableId === targetTable.id && c.leftColumn.endsWith(`.${fk.source_column}`) && c.rightColumn.endsWith(`.${fk.target_column}`) || c.leftTableId === targetTable.id && c.rightTableId === tableId && c.leftColumn.endsWith(`.${fk.target_column}`) && c.rightColumn.endsWith(`.${fk.source_column}`));
          if (!existingCondition) {
            autoConditions.push({
              id: generateId(),
              leftTableId: tableId,
              leftColumn: `${newTable.alias}.${fk.source_column}`,
              rightTableId: targetTable.id,
              rightColumn: `${targetTable.alias}.${fk.target_column}`,
              operator: "="
            });
          }
        }
      }
      for (const fk of foreignKeys.incoming) {
        const sourceTable = existingTables.find((t) => t.schema === fk.source_schema && t.name === fk.source_table);
        if (sourceTable) {
          const existingCondition = queryState.joinConditions.find((c) => c.leftTableId === tableId && c.rightTableId === sourceTable.id || c.leftTableId === sourceTable.id && c.rightTableId === tableId) || autoConditions.find((c) => c.leftTableId === tableId && c.rightTableId === sourceTable.id || c.leftTableId === sourceTable.id && c.rightTableId === tableId);
          if (!existingCondition) {
            autoConditions.push({
              id: generateId(),
              leftTableId: sourceTable.id,
              leftColumn: `${sourceTable.alias}.${fk.source_column}`,
              rightTableId: tableId,
              rightColumn: `${newTable.alias}.${fk.target_column}`,
              operator: "="
            });
          }
        }
      }
      if (autoConditions.length > 0) {
        setQueryState("joinConditions", (prev) => [...prev, ...autoConditions]);
        console.log(`自动创建了 ${autoConditions.length} 个基于外键的 JOIN 条件`);
      }
    }
  }
  function removeTableFromCanvas(tableId) {
    setQueryState(produce((state) => {
      state.tables = state.tables.filter((t) => t.id !== tableId);
      state.selectedColumns = state.selectedColumns.filter((c) => c.tableId !== tableId);
      state.joinConditions = state.joinConditions.filter((c) => c.leftTableId !== tableId && c.rightTableId !== tableId);
      if (state.primaryTableId === tableId) {
        state.primaryTableId = state.tables.length > 0 ? state.tables[0].id : undefined;
      }
    }));
  }
  function setPrimaryTable(tableId) {
    setQueryState("primaryTableId", tableId);
    setTableContextMenu(null);
  }
  function closeTableContextMenu() {
    setTableContextMenu(null);
  }
  function toggleColumnSelection(tableId, columnName) {
    const table = queryState.tables.find((t) => t.id === tableId);
    if (!table)
      return;
    const existingColumn = queryState.selectedColumns.find((c) => c.tableId === tableId && c.columnName === columnName);
    if (existingColumn) {
      setQueryState("selectedColumns", (prev) => prev.filter((c) => c.id !== existingColumn.id));
    } else {
      const newColumn = {
        id: generateId(),
        tableId,
        columnName,
        alias: "",
        aggregation: "",
        isGroupBy: false
      };
      setQueryState("selectedColumns", (prev) => [...prev, newColumn]);
    }
  }
  function updateSelectedColumn(columnId, updates) {
    setQueryState("selectedColumns", (col) => col.id === columnId, updates);
  }
  function addWhereCondition() {
    const newCondition = {
      id: generateId(),
      leftOperand: "",
      operator: "=",
      rightOperand: "",
      logicalOperator: "AND"
    };
    setQueryState("whereConditions", (prev) => [...prev, newCondition]);
  }
  function updateWhereCondition(conditionId, updates) {
    setQueryState("whereConditions", (cond) => cond.id === conditionId, updates);
  }
  function removeWhereCondition(conditionId) {
    setQueryState("whereConditions", (prev) => prev.filter((c) => c.id !== conditionId));
  }
  function updateTableJoinType(tableId, joinType) {
    setQueryState("tables", (t) => t.id === tableId, "joinType", joinType);
  }
  function updateJoinCondition(conditionId, updates) {
    setQueryState("joinConditions", (c) => c.id === conditionId, updates);
  }
  function addSortColumn() {
    const newSort = {
      id: generateId(),
      column: "",
      direction: "ASC"
    };
    setQueryState("sortColumns", (prev) => [...prev, newSort]);
  }
  function updateSortColumn(sortId, updates) {
    setQueryState("sortColumns", (sort) => sort.id === sortId, updates);
  }
  function removeSortColumn(sortId) {
    setQueryState("sortColumns", (prev) => prev.filter((s) => s.id !== sortId));
  }
  function removeJoinCondition(conditionId) {
    setQueryState("joinConditions", (prev) => prev.filter((c) => c.id !== conditionId));
  }
  function reorderArray(items, fromId, toId) {
    const fromIndex = items.findIndex((item) => item.id === fromId);
    const toIndex = items.findIndex((item) => item.id === toId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex)
      return items;
    const newItems = [...items];
    const [removed] = newItems.splice(fromIndex, 1);
    newItems.splice(toIndex, 0, removed);
    return newItems;
  }
  function reorderSelectedColumns(fromId, toId) {
    setQueryState("selectedColumns", (prev) => reorderArray(prev, fromId, toId));
  }
  function reorderWhereConditions(fromId, toId) {
    setQueryState("whereConditions", (prev) => reorderArray(prev, fromId, toId));
  }
  function reorderSortColumns(fromId, toId) {
    setQueryState("sortColumns", (prev) => reorderArray(prev, fromId, toId));
  }
  function reorderTables(fromId, toId) {
    setQueryState("tables", (prev) => reorderArray(prev, fromId, toId));
  }
  function handleSortDragStart(type, id, e) {
    setDragSortItem({
      type,
      id
    });
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    }
  }
  function handleSortDragOver(id, e) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    setDragOverItem(id);
  }
  function handleSortDragLeave() {
    setDragOverItem(null);
  }
  function handleSortDrop(toId, e) {
    e.preventDefault();
    const dragItem = dragSortItem();
    if (!dragItem)
      return;
    const fromId = dragItem.id;
    switch (dragItem.type) {
      case "column":
        reorderSelectedColumns(fromId, toId);
        break;
      case "where":
        reorderWhereConditions(fromId, toId);
        break;
      case "sort":
        reorderSortColumns(fromId, toId);
        break;
      case "table":
        reorderTables(fromId, toId);
        break;
    }
    setDragSortItem(null);
    setDragOverItem(null);
  }
  function handleSortDragEnd() {
    setDragSortItem(null);
    setDragOverItem(null);
  }
  function handleColumnDragStart(tableId, columnName) {
    const table = queryState.tables.find((t) => t.id === tableId);
    if (table) {
      setJoinLineStart({
        tableId,
        column: `${table.alias}.${columnName}`
      });
    }
  }
  function handleColumnDragEnd(targetTableId, targetColumnName) {
    const start = joinLineStart();
    if (!start || start.tableId === targetTableId) {
      setJoinLineStart(null);
      return;
    }
    const sourceTable = queryState.tables.find((t) => t.id === start.tableId);
    const targetTable = queryState.tables.find((t) => t.id === targetTableId);
    if (!sourceTable || !targetTable) {
      setJoinLineStart(null);
      return;
    }
    const newCondition = {
      id: generateId(),
      leftTableId: start.tableId,
      leftColumn: start.column,
      rightTableId: targetTableId,
      rightColumn: `${targetTable.alias}.${targetColumnName}`,
      operator: "="
    };
    setQueryState("joinConditions", (prev) => [...prev, newCondition]);
    if (!targetTable.joinType) {
      updateTableJoinType(targetTableId, "INNER");
    }
    setJoinLineStart(null);
  }
  function cancelJoinDrag() {
    setJoinLineStart(null);
  }
  function screenToCanvas(screenX, screenY) {
    const canvas = canvasRef();
    if (!canvas)
      return {
        x: 0,
        y: 0
      };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (screenX - rect.left - panOffset().x) / scale(),
      y: (screenY - rect.top - panOffset().y) / scale()
    };
  }
  function handleTableMouseDown(e, tableId) {
    if (e.target.closest(".column-item"))
      return;
    e.preventDefault();
    e.stopPropagation();
    setDraggingTableId(tableId);
    setSelectedTableId(tableId);
    const table = queryState.tables.find((t) => t.id === tableId);
    if (table) {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      setDragOffset({
        x: canvasPos.x - table.position.x,
        y: canvasPos.y - table.position.y
      });
    }
  }
  function handleCanvasMouseDown(e) {
    setTableContextMenu(null);
    setJoinContextMenu(null);
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({
        x: e.clientX - panOffset().x,
        y: e.clientY - panOffset().y
      });
      return;
    }
    const target = e.target;
    const isCanvas = target === canvasRef();
    const isTransformLayer = target.parentElement === canvasRef();
    const isClickOnTable = target.closest(".canvas-table");
    if (e.button === 0 && (isCanvas || isTransformLayer) && !isClickOnTable) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({
        x: e.clientX - panOffset().x,
        y: e.clientY - panOffset().y
      });
    }
  }
  function handleCanvasMouseMove(e) {
    if (isPanning()) {
      setPanOffset({
        x: e.clientX - panStart().x,
        y: e.clientY - panStart().y
      });
      return;
    }
    const tableId = draggingTableId();
    if (!tableId)
      return;
    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    setQueryState("tables", (t) => t.id === tableId, "position", {
      x: canvasPos.x - dragOffset().x,
      y: canvasPos.y - dragOffset().y
    });
  }
  function handleCanvasMouseUp() {
    setDraggingTableId(null);
    setIsPanning(false);
  }
  function handleCanvasWheel(e) {
    e.preventDefault();
    const canvas = canvasRef();
    if (!canvas)
      return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(Math.max(scale() * delta, 0.1), 3);
    const scaleRatio = newScale / scale();
    const newPanX = mouseX - (mouseX - panOffset().x) * scaleRatio;
    const newPanY = mouseY - (mouseY - panOffset().y) * scaleRatio;
    setScale(newScale);
    setPanOffset({
      x: newPanX,
      y: newPanY
    });
  }
  function resetView() {
    setScale(1);
    setPanOffset({
      x: 0,
      y: 0
    });
  }
  function fitToContent() {
    if (queryState.tables.length === 0) {
      resetView();
      return;
    }
    const canvas = canvasRef();
    if (!canvas)
      return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const table of queryState.tables) {
      minX = Math.min(minX, table.position.x);
      minY = Math.min(minY, table.position.y);
      maxX = Math.max(maxX, table.position.x + 200);
      maxY = Math.max(maxY, table.position.y + 250);
    }
    const contentWidth = maxX - minX + 100;
    const contentHeight = maxY - minY + 100;
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    const newScale = Math.min(canvasWidth / contentWidth, canvasHeight / contentHeight, 1);
    const newPanX = (canvasWidth - contentWidth * newScale) / 2 - minX * newScale + 50;
    const newPanY = (canvasHeight - contentHeight * newScale) / 2 - minY * newScale + 50;
    setScale(newScale);
    setPanOffset({
      x: newPanX,
      y: newPanY
    });
  }
  const generatedSql = createMemo(() => {
    const {
      tables,
      selectedColumns,
      whereConditions,
      joinConditions,
      sortColumns,
      distinct,
      limit
    } = queryState;
    if (tables.length === 0)
      return "";
    const primaryTableIdToUse = queryState.primaryTableId || tables[0]?.id;
    const primaryTable = tables.find((t) => t.id === primaryTableIdToUse) || tables[0];
    if (!primaryTable)
      return "";
    const adjacency = new Map;
    for (const t of tables) {
      adjacency.set(t.id, new Set);
    }
    for (const cond of joinConditions) {
      adjacency.get(cond.leftTableId)?.add(cond.rightTableId);
      adjacency.get(cond.rightTableId)?.add(cond.leftTableId);
    }
    const visited = new Set;
    const connectedTables = [];
    const queue = [primaryTable.id];
    visited.add(primaryTable.id);
    while (queue.length > 0) {
      const currentId = queue.shift();
      const neighbors = adjacency.get(currentId) || new Set;
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          const table = tables.find((t) => t.id === neighborId);
          if (table) {
            connectedTables.push(table);
            queue.push(neighborId);
          }
        }
      }
    }
    let selectClause = "SELECT";
    if (distinct)
      selectClause += " DISTINCT";
    const validSelectedColumns = selectedColumns.filter((col) => visited.has(col.tableId));
    if (validSelectedColumns.length === 0) {
      selectClause += " *";
    } else {
      const columnExpressions = validSelectedColumns.map((col) => {
        const table = tables.find((t) => t.id === col.tableId);
        if (!table)
          return "";
        let expr = col.expression || `${table.alias}.${col.columnName}`;
        if (col.aggregation) {
          expr = `${col.aggregation}(${expr})`;
        }
        if (col.alias) {
          expr += ` AS ${col.alias}`;
        }
        return expr;
      }).filter(Boolean);
      selectClause += `
  ` + columnExpressions.join(`,
  `);
    }
    let fromClause = `FROM ${primaryTable.schema}.${primaryTable.name} ${primaryTable.alias}`;
    const appearedTables = new Set([primaryTable.id]);
    for (const table of tables) {
      if (table.id === primaryTable.id)
        continue;
      if (!visited.has(table.id))
        continue;
      const tempAppearedTables = new Set(appearedTables);
      tempAppearedTables.add(table.id);
      const tableConditions = joinConditions.filter((c) => {
        const involvesCurrentTable = c.leftTableId === table.id || c.rightTableId === table.id;
        if (!involvesCurrentTable)
          return false;
        return tempAppearedTables.has(c.leftTableId) && tempAppearedTables.has(c.rightTableId);
      });
      if (tableConditions.length === 0)
        continue;
      const joinType = table.joinType || "INNER";
      const joinKeyword = joinType === "INNER" ? "JOIN" : `${joinType} JOIN`;
      fromClause += `
${joinKeyword} ${table.schema}.${table.name} ${table.alias}`;
      appearedTables.add(table.id);
      const conditionStrs = tableConditions.map((c) => `${c.leftColumn} ${c.operator} ${c.rightColumn}`);
      fromClause += ` ON ${conditionStrs.join(" AND ")}`;
    }
    let whereClause = "";
    if (whereConditions.length > 0) {
      const conditions = whereConditions.map((cond, index) => {
        let expr = "";
        if (index > 0) {
          expr = `${cond.logicalOperator} `;
        }
        if (cond.operator === "IS NULL" || cond.operator === "IS NOT NULL") {
          expr += `${cond.leftOperand} ${cond.operator}`;
        } else {
          expr += `${cond.leftOperand} ${cond.operator} ${cond.rightOperand}`;
        }
        return expr;
      });
      whereClause = `WHERE ${conditions.join(`
  `)}`;
    }
    let groupByClause = "";
    const groupByColumns = validSelectedColumns.filter((c) => c.isGroupBy);
    if (groupByColumns.length > 0) {
      const groupExprs = groupByColumns.map((col) => {
        const table = tables.find((t) => t.id === col.tableId);
        return table ? `${table.alias}.${col.columnName}` : "";
      }).filter(Boolean);
      groupByClause = `GROUP BY ${groupExprs.join(", ")}`;
    }
    let orderByClause = "";
    if (sortColumns.length > 0) {
      const sortExprs = sortColumns.filter((s) => s.column).map((s) => `${s.column} ${s.direction}`);
      if (sortExprs.length > 0) {
        orderByClause = `ORDER BY ${sortExprs.join(", ")}`;
      }
    }
    let limitClause = "";
    if (limit && limit > 0) {
      limitClause = `LIMIT ${limit}`;
    }
    const parts = [selectClause, fromClause, whereClause, groupByClause, orderByClause, limitClause].filter(Boolean);
    return parts.join(`
`);
  });
  const allAvailableColumns = createMemo(() => {
    const columns = [];
    for (const table of queryState.tables) {
      for (const col of table.columns) {
        columns.push({
          label: `${table.alias}.${col.name}`,
          value: `${table.alias}.${col.name}`
        });
      }
    }
    return columns;
  });
  function executeQuery() {
    const sql = generatedSql();
    if (sql && props.onExecuteQuery) {
      props.onExecuteQuery(sql);
    }
  }
  const joinLines = createMemo(() => {
    const lines = [];
    const FALLBACK_TABLE_WIDTH = 200;
    const FALLBACK_HEADER_HEIGHT = 40;
    const FALLBACK_COLUMN_HEIGHT = 28;
    const getTableOrderIndex = (tableId) => {
      const primaryId = queryState.primaryTableId || queryState.tables[0]?.id;
      if (tableId === primaryId)
        return -1;
      return queryState.tables.findIndex((t) => t.id === tableId);
    };
    for (const cond of queryState.joinConditions) {
      const table1 = queryState.tables.find((t) => t.id === cond.leftTableId);
      const table2 = queryState.tables.find((t) => t.id === cond.rightTableId);
      if (table1 && table2) {
        let measureColumnCenter = function(tableObj, colName) {
          const canvas = canvasRef();
          if (!canvas)
            return null;
          const tableEl = canvas.querySelector(`.canvas-table[data-table-id="${tableObj.id}"]`);
          if (!tableEl)
            return null;
          const colEl = tableEl.querySelector(`.column-item[data-column-name="${colName}"]`);
          if (!colEl)
            return null;
          const offsetTop = colEl.offsetTop;
          const height = colEl.offsetHeight || FALLBACK_COLUMN_HEIGHT;
          return tableObj.position.y + offsetTop + height / 2;
        };
        const order1 = getTableOrderIndex(table1.id);
        const order2 = getTableOrderIndex(table2.id);
        const sourceTable = order1 < order2 ? table1 : table2;
        const targetTable = order1 < order2 ? table2 : table1;
        const sourceColumn = order1 < order2 ? cond.leftColumn : cond.rightColumn;
        const targetColumn = order1 < order2 ? cond.rightColumn : cond.leftColumn;
        const sourceColParts = sourceColumn.split(".");
        const targetColParts = targetColumn.split(".");
        const sourceColName = sourceColParts[sourceColParts.length - 1];
        const targetColName = targetColParts[targetColParts.length - 1];
        const measuredSourceY = measureColumnCenter(sourceTable, sourceColName);
        const measuredTargetY = measureColumnCenter(targetTable, targetColName);
        const sourceY = measuredSourceY != null ? measuredSourceY : sourceTable.position.y + FALLBACK_HEADER_HEIGHT + (sourceTable.columns.findIndex((c) => c.name === sourceColName) >= 0 ? sourceTable.columns.findIndex((c) => c.name === sourceColName) : 0) * FALLBACK_COLUMN_HEIGHT + FALLBACK_COLUMN_HEIGHT / 2;
        const targetY = measuredTargetY != null ? measuredTargetY : targetTable.position.y + FALLBACK_HEADER_HEIGHT + (targetTable.columns.findIndex((c) => c.name === targetColName) >= 0 ? targetTable.columns.findIndex((c) => c.name === targetColName) : 0) * FALLBACK_COLUMN_HEIGHT + FALLBACK_COLUMN_HEIGHT / 2;
        const canvasEl = canvasRef();
        let sourceTableWidth = FALLBACK_TABLE_WIDTH;
        let targetTableWidth = FALLBACK_TABLE_WIDTH;
        if (canvasEl) {
          const sourceEl = canvasEl.querySelector(`.canvas-table[data-table-id="${sourceTable.id}"]`);
          const targetEl = canvasEl.querySelector(`.canvas-table[data-table-id="${targetTable.id}"]`);
          if (sourceEl && sourceEl.offsetWidth)
            sourceTableWidth = sourceEl.offsetWidth;
          if (targetEl && targetEl.offsetWidth)
            targetTableWidth = targetEl.offsetWidth;
        }
        const sourceCenterX = sourceTable.position.x + sourceTableWidth / 2;
        const targetCenterX = targetTable.position.x + targetTableWidth / 2;
        let sourceX, targetX;
        if (sourceCenterX < targetCenterX) {
          sourceX = sourceTable.position.x + sourceTableWidth;
          targetX = targetTable.position.x;
        } else {
          sourceX = sourceTable.position.x;
          targetX = targetTable.position.x + targetTableWidth;
        }
        lines.push({
          x1: sourceX,
          y1: sourceY,
          x2: targetX,
          y2: targetY,
          condition: cond,
          sourceTable,
          targetTable,
          sourceColumnName: sourceColName,
          targetColumnName: targetColName
        });
      }
    }
    return lines;
  });
  function closeJoinContextMenu() {
    setJoinContextMenu(null);
  }
  function getTableJoinOrder(tableId) {
    const primaryId = queryState.primaryTableId || queryState.tables[0]?.id;
    if (tableId === primaryId)
      return 0;
    let order = 0;
    for (const t of queryState.tables) {
      if (t.id === primaryId)
        continue;
      order++;
      if (t.id === tableId)
        return order;
    }
    return -1;
  }
  function getTablesBefore(tableId) {
    const primaryId = queryState.primaryTableId || queryState.tables[0]?.id;
    const beforeTables = new Set;
    beforeTables.add(primaryId);
    for (const t of queryState.tables) {
      if (t.id === primaryId)
        continue;
      if (t.id === tableId) {
        beforeTables.add(t.id);
        break;
      }
      beforeTables.add(t.id);
    }
    return beforeTables;
  }
  function renderCanvasTable(table) {
    const isSelected = () => selectedTableId() === table.id;
    const isPrimaryTable = () => {
      const primaryId = queryState.primaryTableId || queryState.tables[0]?.id;
      return table.id === primaryId;
    };
    const joinOrder = () => getTableJoinOrder(table.id);
    return (() => {
      var _el$ = _tmpl$11(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling, _el$6 = _el$5.firstChild, _el$7 = _el$6.firstChild, _el$9 = _el$7.nextSibling, _el$8 = _el$9.nextSibling, _el$0 = _el$3.nextSibling, _el$1 = _el$2.nextSibling;
      _el$.$$contextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setJoinContextMenu(null);
        setTableContextMenu({
          x: e.clientX,
          y: e.clientY,
          tableId: table.id
        });
      };
      _el$.$$mousedown = (e) => handleTableMouseDown(e, table.id);
      insert(_el$4, (() => {
        var _c$ = memo(() => !!isPrimaryTable());
        return () => _c$() ? "FROM" : `#${joinOrder()}`;
      })());
      insert(_el$3, createComponent(Show, {
        get when() {
          return !isPrimaryTable();
        },
        get children() {
          return (() => {
            const joinColors = {
              INNER: "#3b82f6",
              LEFT: "#22c55e",
              RIGHT: "#f59e0b",
              FULL: "#a855f7",
              CROSS: "#ef4444"
            };
            const currentJoinType = () => table.joinType || "INNER";
            return (() => {
              var _el$10 = _tmpl$25(), _el$11 = _el$10.firstChild;
              insert(_el$10, currentJoinType, _el$11);
              createRenderEffect((_$p) => setStyleProperty(_el$10, "background-color", joinColors[currentJoinType()]));
              return _el$10;
            })();
          })();
        }
      }), _el$5);
      insert(_el$5, () => table.name, _el$6);
      insert(_el$6, () => table.alias, _el$9);
      _el$0.addEventListener("mouseleave", (e) => e.currentTarget.style.color = "#94a3b8");
      _el$0.addEventListener("mouseenter", (e) => e.currentTarget.style.color = "#ef4444");
      _el$0.$$click = (e) => {
        e.stopPropagation();
        removeTableFromCanvas(table.id);
      };
      insert(_el$1, createComponent(For, {
        get each() {
          return table.columns;
        },
        children: (col) => {
          const isColumnSelected = () => queryState.selectedColumns.some((c) => c.tableId === table.id && c.columnName === col.name);
          const isJoinSource = () => {
            const start = joinLineStart();
            return start && start.tableId === table.id && start.column === `${table.alias}.${col.name}`;
          };
          const isJoinTarget = () => {
            const start = joinLineStart();
            return start && start.tableId !== table.id;
          };
          return (() => {
            var _el$12 = _tmpl$35(), _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling, _el$15 = _el$14.nextSibling, _el$16 = _el$15.nextSibling;
            _el$12.addEventListener("mouseleave", (e) => {
              if (!isColumnSelected() && !isJoinSource())
                e.currentTarget.style.backgroundColor = "transparent";
            });
            _el$12.addEventListener("mouseenter", (e) => {
              if (!isColumnSelected() && !isJoinSource())
                e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)";
            });
            _el$12.$$click = (e) => {
              e.stopPropagation();
              toggleColumnSelection(table.id, col.name);
            };
            _el$12.addEventListener("drop", (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (isJoinTarget()) {
                handleColumnDragEnd(table.id, col.name);
              }
              e.currentTarget.style.backgroundColor = isColumnSelected() ? "rgba(59, 130, 246, 0.1)" : "transparent";
            });
            _el$12.addEventListener("dragleave", (e) => {
              e.currentTarget.style.backgroundColor = isColumnSelected() ? "rgba(59, 130, 246, 0.1)" : "transparent";
            });
            _el$12.addEventListener("dragover", (e) => {
              if (isJoinTarget()) {
                e.preventDefault();
                e.currentTarget.style.backgroundColor = "rgba(34, 197, 94, 0.3)";
              }
            });
            _el$12.addEventListener("dragend", () => cancelJoinDrag());
            _el$12.addEventListener("dragstart", (e) => {
              e.stopPropagation();
              handleColumnDragStart(table.id, col.name);
              e.dataTransfer?.setData("text/plain", `${table.alias}.${col.name}`);
            });
            setAttribute(_el$12, "draggable", true);
            insert(_el$14, () => col.name);
            insert(_el$15, () => col.dataType);
            createRenderEffect((_p$) => {
              var _v$0 = col.name, _v$1 = isJoinSource() ? "#22c55e" : isColumnSelected() ? "#3b82f6" : "#cbd5e1", _v$10 = isJoinSource() ? "rgba(34, 197, 94, 0.2)" : isColumnSelected() ? "rgba(59, 130, 246, 0.1)" : "transparent", _v$11 = isJoinTarget() ? "1px dashed #22c55e" : "1px solid transparent", _v$12 = isColumnSelected() ? "#3b82f6" : "transparent", _v$13 = isColumnSelected() ? "#fff" : "transparent";
              _v$0 !== _p$.e && setAttribute(_el$12, "data-column-name", _p$.e = _v$0);
              _v$1 !== _p$.t && setStyleProperty(_el$12, "color", _p$.t = _v$1);
              _v$10 !== _p$.a && setStyleProperty(_el$12, "background-color", _p$.a = _v$10);
              _v$11 !== _p$.o && setStyleProperty(_el$12, "border", _p$.o = _v$11);
              _v$12 !== _p$.i && setStyleProperty(_el$13, "background-color", _p$.i = _v$12);
              _v$13 !== _p$.n && setStyleProperty(_el$13, "color", _p$.n = _v$13);
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined,
              o: undefined,
              i: undefined,
              n: undefined
            });
            return _el$12;
          })();
        }
      }));
      createRenderEffect((_p$) => {
        var _v$ = table.id, _v$2 = `${table.position.x}px`, _v$3 = `${table.position.y}px`, _v$4 = isPrimaryTable() ? "2px solid #f59e0b" : isSelected() ? "2px solid #3b82f6" : "1px solid #475569", _v$5 = isPrimaryTable() ? "0 4px 12px rgba(245,158,11,0.3)" : "0 4px 12px rgba(0,0,0,0.3)", _v$6 = isSelected() ? 10 : 1, _v$7 = isPrimaryTable() ? "#78350f" : "#334155", _v$8 = isPrimaryTable() ? "#f59e0b" : "#3b82f6", _v$9 = `${table.schema}.${table.name}`;
        _v$ !== _p$.e && setAttribute(_el$, "data-table-id", _p$.e = _v$);
        _v$2 !== _p$.t && setStyleProperty(_el$, "left", _p$.t = _v$2);
        _v$3 !== _p$.a && setStyleProperty(_el$, "top", _p$.a = _v$3);
        _v$4 !== _p$.o && setStyleProperty(_el$, "border", _p$.o = _v$4);
        _v$5 !== _p$.i && setStyleProperty(_el$, "box-shadow", _p$.i = _v$5);
        _v$6 !== _p$.n && setStyleProperty(_el$, "z-index", _p$.n = _v$6);
        _v$7 !== _p$.s && setStyleProperty(_el$2, "background-color", _p$.s = _v$7);
        _v$8 !== _p$.h && setStyleProperty(_el$4, "background-color", _p$.h = _v$8);
        _v$9 !== _p$.r && setAttribute(_el$5, "title", _p$.r = _v$9);
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined,
        n: undefined,
        s: undefined,
        h: undefined,
        r: undefined
      });
      return _el$;
    })();
  }
  return (() => {
    var _el$17 = _tmpl$16(), _el$18 = _el$17.firstChild, _el$19 = _el$18.firstChild, _el$20 = _el$19.nextSibling, _el$21 = _el$20.nextSibling, _el$22 = _el$21.nextSibling, _el$38 = _el$18.nextSibling, _el$39 = _el$38.firstChild, _el$40 = _el$39.firstChild, _el$41 = _el$40.firstChild, _el$42 = _el$40.nextSibling, _el$43 = _el$39.nextSibling, _el$44 = _el$43.firstChild, _el$45 = _el$44.firstChild, _el$46 = _el$45.nextSibling, _el$47 = _el$46.nextSibling, _el$48 = _el$47.firstChild, _el$49 = _el$47.nextSibling, _el$50 = _el$49.nextSibling, _el$51 = _el$50.nextSibling, _el$52 = _el$51.nextSibling, _el$53 = _el$44.nextSibling, _el$54 = _el$53.firstChild, _el$55 = _el$54.firstChild, _el$56 = _el$55.firstChild, _el$60 = _el$53.nextSibling, _el$61 = _el$60.firstChild, _el$62 = _el$61.firstChild, _el$63 = _el$62.nextSibling, _el$64 = _el$61.nextSibling, _el$65 = _el$43.nextSibling, _el$66 = _el$65.firstChild, _el$67 = _el$66.nextSibling;
    _el$21.$$click = () => {
      setImportSqlError(null);
      setImportSqlText("");
      setShowImportSql(true);
    };
    _el$22.$$click = executeQuery;
    insert(_el$18, createComponent(Show, {
      get when() {
        return props.onClose;
      },
      get children() {
        var _el$23 = _tmpl$43();
        addEventListener(_el$23, "click", props.onClose, true);
        return _el$23;
      }
    }), null);
    insert(_el$17, createComponent(Show, {
      get when() {
        return importSqlError();
      },
      get children() {
        var _el$24 = _tmpl$53(), _el$25 = _el$24.firstChild;
        insert(_el$24, importSqlError, _el$25);
        _el$25.$$click = () => setImportSqlError(null);
        return _el$24;
      }
    }), _el$38);
    insert(_el$17, createComponent(Show, {
      get when() {
        return showBestEffortHint();
      },
      get children() {
        var _el$26 = _tmpl$62(), _el$27 = _el$26.firstChild, _el$28 = _el$27.nextSibling;
        _el$28.$$click = () => setShowBestEffortHint(false);
        return _el$26;
      }
    }), _el$38);
    insert(_el$17, createComponent(Show, {
      get when() {
        return showImportSql();
      },
      get children() {
        var _el$29 = _tmpl$82(), _el$30 = _el$29.firstChild, _el$31 = _el$30.firstChild, _el$32 = _el$31.nextSibling, _el$33 = _el$32.nextSibling, _el$35 = _el$33.nextSibling, _el$36 = _el$35.firstChild, _el$37 = _el$36.nextSibling;
        _el$29.$$click = (e) => e.target === e.currentTarget && !applyingSql() && setShowImportSql(false);
        _el$30.$$click = (e) => e.stopPropagation();
        _el$33.$$input = (e) => {
          setImportSqlText(e.currentTarget.value);
          setImportSqlError(null);
        };
        insert(_el$30, createComponent(Show, {
          get when() {
            return importSqlError();
          },
          get children() {
            var _el$34 = _tmpl$72();
            insert(_el$34, importSqlError);
            return _el$34;
          }
        }), _el$35);
        _el$36.$$click = () => setShowImportSql(false);
        _el$37.$$click = () => applySqlFromText(importSqlText());
        insert(_el$37, () => applyingSql() ? "解析中..." : "确认导入");
        createRenderEffect((_p$) => {
          var _v$14 = applyingSql(), _v$15 = applyingSql() ? "not-allowed" : "pointer", _v$16 = applyingSql() || !importSqlText().trim(), _v$17 = applyingSql() || !importSqlText().trim() ? "not-allowed" : "pointer";
          _v$14 !== _p$.e && (_el$36.disabled = _p$.e = _v$14);
          _v$15 !== _p$.t && setStyleProperty(_el$36, "cursor", _p$.t = _v$15);
          _v$16 !== _p$.a && (_el$37.disabled = _p$.a = _v$16);
          _v$17 !== _p$.o && setStyleProperty(_el$37, "cursor", _p$.o = _v$17);
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined
        });
        createRenderEffect(() => _el$33.value = importSqlText());
        return _el$29;
      }
    }), _el$38);
    insert(_el$40, () => loadingTables() && "(加载中...)", null);
    insert(_el$42, createComponent(For, {
      each: availableTables,
      children: (schemaItem) => (() => {
        var _el$94 = _tmpl$18(), _el$95 = _el$94.firstChild, _el$96 = _el$95.firstChild, _el$97 = _el$96.nextSibling, _el$98 = _el$97.nextSibling, _el$99 = _el$98.firstChild, _el$101 = _el$99.nextSibling, _el$100 = _el$101.nextSibling;
        _el$95.addEventListener("mouseleave", (e) => e.currentTarget.style.backgroundColor = "transparent");
        _el$95.addEventListener("mouseenter", (e) => e.currentTarget.style.backgroundColor = "#1e293b");
        _el$95.$$click = () => toggleSchema(schemaItem.schema);
        insert(_el$95, () => schemaItem.schema, _el$98);
        insert(_el$98, () => schemaItem.tables.length, _el$101);
        insert(_el$94, createComponent(Show, {
          get when() {
            return expandedSchemas().has(schemaItem.schema);
          },
          get children() {
            var _el$102 = _tmpl$17();
            insert(_el$102, createComponent(For, {
              get each() {
                return schemaItem.tables;
              },
              children: (tableName) => (() => {
                var _el$103 = _tmpl$19(), _el$104 = _el$103.firstChild;
                _el$103.addEventListener("mouseleave", (e) => e.currentTarget.style.backgroundColor = "transparent");
                _el$103.addEventListener("mouseenter", (e) => e.currentTarget.style.backgroundColor = "#1e293b");
                _el$103.addEventListener("dragstart", (e) => handleTableDragStart(e, schemaItem.schema, tableName));
                setAttribute(_el$103, "draggable", true);
                insert(_el$103, tableName, null);
                return _el$103;
              })()
            }));
            return _el$102;
          }
        }), null);
        createRenderEffect((_$p) => setStyleProperty(_el$96, "transform", expandedSchemas().has(schemaItem.schema) ? "rotate(90deg)" : "rotate(0deg)"));
        return _el$94;
      })()
    }));
    _el$46.$$click = () => setScale((s) => Math.max(0.1, s - 0.1));
    insert(_el$47, () => Math.round(scale() * 100), _el$48);
    _el$49.$$click = () => setScale((s) => Math.min(3, s + 0.1));
    _el$50.$$click = resetView;
    _el$51.$$click = fitToContent;
    _el$53.addEventListener("wheel", handleCanvasWheel);
    _el$53.addEventListener("mouseleave", handleCanvasMouseUp);
    _el$53.$$mouseup = handleCanvasMouseUp;
    _el$53.$$mousemove = handleCanvasMouseMove;
    _el$53.$$mousedown = handleCanvasMouseDown;
    _el$53.addEventListener("dragover", (e) => e.preventDefault());
    _el$53.addEventListener("drop", handleCanvasDrop);
    use(setCanvasRef, _el$53);
    insert(_el$55, createComponent(For, {
      get each() {
        return joinLines();
      },
      children: (line) => {
        const joinColors = {
          INNER: "#3b82f6",
          LEFT: "#22c55e",
          RIGHT: "#f59e0b",
          FULL: "#a855f7",
          CROSS: "#ef4444"
        };
        const getTargetTableJoinType = () => {
          const targetTable = queryState.tables.find((t) => t.id === line.targetTable.id);
          return targetTable?.joinType || "INNER";
        };
        const lineColor = () => joinColors[getTargetTableJoinType()] || "#3b82f6";
        const arrowId = () => `arrow-${getTargetTableJoinType().toLowerCase()}`;
        const midX = () => (line.x1 + line.x2) / 2;
        const midY = () => (line.y1 + line.y2) / 2;
        return (() => {
          var _el$105 = _tmpl$20(), _el$106 = _el$105.firstChild, _el$107 = _el$106.nextSibling, _el$108 = _el$107.nextSibling, _el$109 = _el$108.nextSibling, _el$110 = _el$109.firstChild, _el$111 = _el$110.nextSibling;
          _el$106.$$contextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            setTableContextMenu(null);
            setJoinContextMenu({
              x: e.clientX,
              y: e.clientY,
              joinId: line.condition.id
            });
          };
          _el$109.$$contextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            setTableContextMenu(null);
            setJoinContextMenu({
              x: e.clientX,
              y: e.clientY,
              joinId: line.condition.id
            });
          };
          insert(_el$111, getTargetTableJoinType);
          createRenderEffect((_p$) => {
            var { x1: _v$28, y1: _v$29, x2: _v$30, y2: _v$31, x1: _v$32, y1: _v$33, x2: _v$34, y2: _v$35 } = line, _v$36 = lineColor(), _v$37 = `url(#${arrowId()})`, _v$38 = line.x1, _v$39 = line.y1, _v$40 = lineColor(), _v$41 = midX() - 25, _v$42 = midY() - 9, _v$43 = lineColor(), _v$44 = midX(), _v$45 = midY() + 4, _v$46 = lineColor();
            _v$28 !== _p$.e && setAttribute(_el$106, "x1", _p$.e = _v$28);
            _v$29 !== _p$.t && setAttribute(_el$106, "y1", _p$.t = _v$29);
            _v$30 !== _p$.a && setAttribute(_el$106, "x2", _p$.a = _v$30);
            _v$31 !== _p$.o && setAttribute(_el$106, "y2", _p$.o = _v$31);
            _v$32 !== _p$.i && setAttribute(_el$107, "x1", _p$.i = _v$32);
            _v$33 !== _p$.n && setAttribute(_el$107, "y1", _p$.n = _v$33);
            _v$34 !== _p$.s && setAttribute(_el$107, "x2", _p$.s = _v$34);
            _v$35 !== _p$.h && setAttribute(_el$107, "y2", _p$.h = _v$35);
            _v$36 !== _p$.r && setAttribute(_el$107, "stroke", _p$.r = _v$36);
            _v$37 !== _p$.d && setAttribute(_el$107, "marker-end", _p$.d = _v$37);
            _v$38 !== _p$.l && setAttribute(_el$108, "cx", _p$.l = _v$38);
            _v$39 !== _p$.u && setAttribute(_el$108, "cy", _p$.u = _v$39);
            _v$40 !== _p$.c && setAttribute(_el$108, "fill", _p$.c = _v$40);
            _v$41 !== _p$.w && setAttribute(_el$110, "x", _p$.w = _v$41);
            _v$42 !== _p$.m && setAttribute(_el$110, "y", _p$.m = _v$42);
            _v$43 !== _p$.f && setAttribute(_el$110, "stroke", _p$.f = _v$43);
            _v$44 !== _p$.y && setAttribute(_el$111, "x", _p$.y = _v$44);
            _v$45 !== _p$.g && setAttribute(_el$111, "y", _p$.g = _v$45);
            _v$46 !== _p$.p && setAttribute(_el$111, "fill", _p$.p = _v$46);
            return _p$;
          }, {
            e: undefined,
            t: undefined,
            a: undefined,
            o: undefined,
            i: undefined,
            n: undefined,
            s: undefined,
            h: undefined,
            r: undefined,
            d: undefined,
            l: undefined,
            u: undefined,
            c: undefined,
            w: undefined,
            m: undefined,
            f: undefined,
            y: undefined,
            g: undefined,
            p: undefined
          });
          return _el$105;
        })();
      }
    }), null);
    insert(_el$54, createComponent(For, {
      get each() {
        return queryState.tables;
      },
      children: (table) => renderCanvasTable(table)
    }), null);
    insert(_el$53, createComponent(Show, {
      get when() {
        return queryState.tables.length === 0;
      },
      get children() {
        var _el$57 = _tmpl$92(), _el$58 = _el$57.firstChild, _el$59 = _el$58.nextSibling;
        return _el$57;
      }
    }), null);
    _el$63.$$click = () => navigator.clipboard.writeText(generatedSql());
    insert(_el$64, () => generatedSql() || "-- 暂无 SQL，请添加表并选择列");
    insert(_el$66, createComponent(For, {
      each: [{
        key: "columns",
        label: "列",
        icon: "\uD83D\uDCCE"
      }, {
        key: "where",
        label: "WHERE",
        icon: "\uD83D\uDD0D"
      }, {
        key: "joins",
        label: "JOIN",
        icon: "\uD83D\uDD17"
      }, {
        key: "sorting",
        label: "排序",
        icon: "↕️"
      }, {
        key: "misc",
        label: "其他",
        icon: "⚙️"
      }],
      children: (tab) => (() => {
        var _el$112 = _tmpl$21(), _el$113 = _el$112.firstChild;
        _el$112.$$click = () => setActiveTab(tab.key);
        insert(_el$112, () => tab.icon, _el$113);
        insert(_el$112, () => tab.label, null);
        createRenderEffect((_p$) => {
          var _v$47 = activeTab() === tab.key ? "#1e293b" : "transparent", _v$48 = activeTab() === tab.key ? "#3b82f6" : "#94a3b8", _v$49 = activeTab() === tab.key ? "2px solid #3b82f6" : "2px solid transparent";
          _v$47 !== _p$.e && setStyleProperty(_el$112, "background", _p$.e = _v$47);
          _v$48 !== _p$.t && setStyleProperty(_el$112, "color", _p$.t = _v$48);
          _v$49 !== _p$.a && setStyleProperty(_el$112, "border-bottom", _p$.a = _v$49);
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$112;
      })()
    }));
    insert(_el$67, createComponent(Show, {
      get when() {
        return activeTab() === "columns";
      },
      get children() {
        var _el$68 = _tmpl$12(), _el$69 = _el$68.firstChild, _el$70 = _el$69.firstChild, _el$71 = _el$70.nextSibling, _el$72 = _el$71.firstChild;
        insert(_el$71, () => queryState.selectedColumns.length, _el$72);
        insert(_el$68, createComponent(Show, {
          get when() {
            return queryState.selectedColumns.length === 0;
          },
          get children() {
            return _tmpl$02();
          }
        }), null);
        insert(_el$68, createComponent(For, {
          get each() {
            return queryState.selectedColumns;
          },
          children: (col) => {
            const table = queryState.tables.find((t) => t.id === col.tableId);
            const isDragOver = () => dragOverItem() === col.id && dragSortItem()?.type === "column";
            return (() => {
              var _el$114 = _tmpl$222(), _el$115 = _el$114.firstChild, _el$116 = _el$115.firstChild, _el$117 = _el$116.nextSibling, _el$118 = _el$117.firstChild, _el$119 = _el$117.nextSibling, _el$120 = _el$115.nextSibling, _el$121 = _el$120.firstChild, _el$122 = _el$121.nextSibling, _el$123 = _el$120.nextSibling, _el$124 = _el$123.firstChild;
              _el$114.addEventListener("dragend", handleSortDragEnd);
              _el$114.addEventListener("drop", (e) => handleSortDrop(col.id, e));
              _el$114.addEventListener("dragleave", handleSortDragLeave);
              _el$114.addEventListener("dragover", (e) => handleSortDragOver(col.id, e));
              _el$114.addEventListener("dragstart", (e) => handleSortDragStart("column", col.id, e));
              setAttribute(_el$114, "draggable", true);
              insert(_el$117, () => table?.alias, _el$118);
              insert(_el$117, () => col.columnName, null);
              _el$119.$$click = () => setQueryState("selectedColumns", (prev) => prev.filter((c) => c.id !== col.id));
              _el$121.$$input = (e) => updateSelectedColumn(col.id, {
                alias: e.currentTarget.value
              });
              _el$122.addEventListener("change", (e) => updateSelectedColumn(col.id, {
                aggregation: e.currentTarget.value
              }));
              _el$124.addEventListener("change", (e) => updateSelectedColumn(col.id, {
                isGroupBy: e.currentTarget.checked
              }));
              createRenderEffect((_p$) => {
                var _v$50 = isDragOver() ? "#334155" : "#1e293b", _v$51 = isDragOver() ? "2px dashed #3b82f6" : "2px solid transparent";
                _v$50 !== _p$.e && setStyleProperty(_el$114, "background-color", _p$.e = _v$50);
                _v$51 !== _p$.t && setStyleProperty(_el$114, "border", _p$.t = _v$51);
                return _p$;
              }, {
                e: undefined,
                t: undefined
              });
              createRenderEffect(() => _el$121.value = col.alias);
              createRenderEffect(() => _el$122.value = col.aggregation || "");
              createRenderEffect(() => _el$124.checked = col.isGroupBy);
              return _el$114;
            })();
          }
        }), null);
        return _el$68;
      }
    }), null);
    insert(_el$67, createComponent(Show, {
      get when() {
        return activeTab() === "where";
      },
      get children() {
        var _el$74 = _tmpl$102(), _el$75 = _el$74.firstChild;
        _el$75.$$click = addWhereCondition;
        insert(_el$74, createComponent(For, {
          get each() {
            return queryState.whereConditions;
          },
          children: (cond, index) => {
            const isDragOver = () => dragOverItem() === cond.id && dragSortItem()?.type === "where";
            return (() => {
              var _el$125 = _tmpl$252(), _el$126 = _el$125.firstChild, _el$127 = _el$126.firstChild, _el$129 = _el$126.nextSibling, _el$130 = _el$129.firstChild, _el$131 = _el$130.firstChild, _el$132 = _el$130.nextSibling, _el$134 = _el$132.nextSibling;
              _el$125.addEventListener("dragend", handleSortDragEnd);
              _el$125.addEventListener("drop", (e) => handleSortDrop(cond.id, e));
              _el$125.addEventListener("dragleave", handleSortDragLeave);
              _el$125.addEventListener("dragover", (e) => handleSortDragOver(cond.id, e));
              _el$125.addEventListener("dragstart", (e) => handleSortDragStart("where", cond.id, e));
              setAttribute(_el$125, "draggable", true);
              insert(_el$126, createComponent(Show, {
                get when() {
                  return index() > 0;
                },
                get children() {
                  var _el$128 = _tmpl$232();
                  _el$128.addEventListener("change", (e) => updateWhereCondition(cond.id, {
                    logicalOperator: e.currentTarget.value
                  }));
                  createRenderEffect(() => _el$128.value = cond.logicalOperator);
                  return _el$128;
                }
              }), null);
              _el$130.addEventListener("change", (e) => updateWhereCondition(cond.id, {
                leftOperand: e.currentTarget.value
              }));
              insert(_el$130, createComponent(For, {
                get each() {
                  return allAvailableColumns();
                },
                children: (col) => (() => {
                  var _el$135 = _tmpl$26();
                  insert(_el$135, () => col.label);
                  createRenderEffect(() => _el$135.value = col.value);
                  return _el$135;
                })()
              }), null);
              _el$132.addEventListener("change", (e) => updateWhereCondition(cond.id, {
                operator: e.currentTarget.value
              }));
              insert(_el$129, createComponent(Show, {
                get when() {
                  return memo(() => cond.operator !== "IS NULL")() && cond.operator !== "IS NOT NULL";
                },
                get children() {
                  var _el$133 = _tmpl$242();
                  _el$133.$$input = (e) => updateWhereCondition(cond.id, {
                    rightOperand: e.currentTarget.value
                  });
                  createRenderEffect(() => _el$133.value = cond.rightOperand);
                  return _el$133;
                }
              }), _el$134);
              _el$134.$$click = () => removeWhereCondition(cond.id);
              createRenderEffect((_p$) => {
                var _v$52 = isDragOver() ? "#334155" : "#1e293b", _v$53 = isDragOver() ? "2px dashed #3b82f6" : "2px solid transparent", _v$54 = index() > 0 ? "8px" : "0";
                _v$52 !== _p$.e && setStyleProperty(_el$125, "background-color", _p$.e = _v$52);
                _v$53 !== _p$.t && setStyleProperty(_el$125, "border", _p$.t = _v$53);
                _v$54 !== _p$.a && setStyleProperty(_el$126, "margin-bottom", _p$.a = _v$54);
                return _p$;
              }, {
                e: undefined,
                t: undefined,
                a: undefined
              });
              createRenderEffect(() => _el$130.value = cond.leftOperand);
              createRenderEffect(() => _el$132.value = cond.operator);
              return _el$125;
            })();
          }
        }), null);
        return _el$74;
      }
    }), null);
    insert(_el$67, createComponent(Show, {
      get when() {
        return activeTab() === "joins";
      },
      get children() {
        var _el$76 = _tmpl$13();
        insert(_el$76, createComponent(Show, {
          get when() {
            return queryState.tables.length <= 1;
          },
          get children() {
            var _el$77 = _tmpl$112(), _el$78 = _el$77.firstChild, _el$79 = _el$78.nextSibling;
            return _el$77;
          }
        }), null);
        insert(_el$76, createComponent(For, {
          get each() {
            return queryState.tables.filter((t) => {
              const primaryId = queryState.primaryTableId || queryState.tables[0]?.id;
              return t.id !== primaryId;
            });
          },
          children: (table) => {
            const joinColors = {
              INNER: "#3b82f6",
              LEFT: "#22c55e",
              RIGHT: "#f59e0b",
              FULL: "#a855f7",
              CROSS: "#ef4444"
            };
            const currentJoinType = table.joinType || "INNER";
            const tableOrder = getTableJoinOrder(table.id);
            const tablesBeforeOrCurrent = () => getTablesBefore(table.id);
            const tableConditions = () => queryState.joinConditions.filter((c) => {
              const involvesCurrentTable = c.leftTableId === table.id || c.rightTableId === table.id;
              if (!involvesCurrentTable)
                return false;
              const beforeSet = tablesBeforeOrCurrent();
              return beforeSet.has(c.leftTableId) && beforeSet.has(c.rightTableId);
            });
            const isDragOver = () => dragOverItem() === table.id && dragSortItem()?.type === "table";
            return (() => {
              var _el$136 = _tmpl$29(), _el$137 = _el$136.firstChild, _el$138 = _el$137.firstChild, _el$139 = _el$138.nextSibling, _el$140 = _el$139.firstChild, _el$141 = _el$139.nextSibling, _el$142 = _el$141.firstChild, _el$144 = _el$142.nextSibling, _el$143 = _el$144.nextSibling, _el$145 = _el$141.nextSibling;
              _el$136.addEventListener("dragend", handleSortDragEnd);
              _el$136.addEventListener("drop", (e) => handleSortDrop(table.id, e));
              _el$136.addEventListener("dragleave", handleSortDragLeave);
              _el$136.addEventListener("dragover", (e) => handleSortDragOver(table.id, e));
              _el$136.addEventListener("dragstart", (e) => handleSortDragStart("table", table.id, e));
              setAttribute(_el$136, "draggable", true);
              insert(_el$139, tableOrder, null);
              insert(_el$141, () => table.name, _el$142);
              insert(_el$141, () => table.alias, _el$144);
              _el$145.addEventListener("change", (e) => updateTableJoinType(table.id, e.currentTarget.value));
              _el$145.value = currentJoinType;
              insert(_el$136, createComponent(Show, {
                get when() {
                  return tableConditions().length > 0;
                },
                get children() {
                  return [_tmpl$27(), createComponent(For, {
                    get each() {
                      return tableConditions();
                    },
                    children: (cond) => {
                      const leftTable = queryState.tables.find((t) => t.id === cond.leftTableId);
                      const rightTable = queryState.tables.find((t) => t.id === cond.rightTableId);
                      return (() => {
                        var _el$148 = _tmpl$30(), _el$149 = _el$148.firstChild, _el$150 = _el$149.firstChild, _el$152 = _el$150.nextSibling, _el$151 = _el$152.nextSibling, _el$153 = _el$149.nextSibling;
                        insert(_el$149, () => cond.leftColumn, _el$150);
                        insert(_el$149, () => cond.operator, _el$152);
                        insert(_el$149, () => cond.rightColumn, null);
                        _el$153.$$click = () => removeJoinCondition(cond.id);
                        return _el$148;
                      })();
                    }
                  })];
                }
              }), null);
              insert(_el$136, createComponent(Show, {
                get when() {
                  return tableConditions().length === 0;
                },
                get children() {
                  return _tmpl$28();
                }
              }), null);
              createRenderEffect((_p$) => {
                var _v$55 = isDragOver() ? "#334155" : "#1e293b", _v$56 = `3px solid ${joinColors[currentJoinType]}`, _v$57 = isDragOver() ? "2px dashed #3b82f6" : "2px solid transparent", _v$58 = joinColors[currentJoinType];
                _v$55 !== _p$.e && setStyleProperty(_el$136, "background-color", _p$.e = _v$55);
                _v$56 !== _p$.t && setStyleProperty(_el$136, "border-left", _p$.t = _v$56);
                _v$57 !== _p$.a && setStyleProperty(_el$136, "border", _p$.a = _v$57);
                _v$58 !== _p$.o && setStyleProperty(_el$145, "color", _p$.o = _v$58);
                return _p$;
              }, {
                e: undefined,
                t: undefined,
                a: undefined,
                o: undefined
              });
              return _el$136;
            })();
          }
        }), null);
        insert(_el$76, createComponent(Show, {
          get when() {
            return queryState.joinConditions.length > 0;
          },
          get children() {
            var _el$80 = _tmpl$122(), _el$81 = _el$80.firstChild, _el$82 = _el$81.firstChild, _el$84 = _el$82.nextSibling, _el$83 = _el$84.nextSibling;
            insert(_el$81, () => queryState.joinConditions.length, _el$84);
            insert(_el$80, createComponent(For, {
              get each() {
                return queryState.joinConditions;
              },
              children: (cond) => (() => {
                var _el$154 = _tmpl$31(), _el$155 = _el$154.firstChild, _el$156 = _el$155.firstChild, _el$158 = _el$156.nextSibling, _el$157 = _el$158.nextSibling, _el$159 = _el$155.nextSibling;
                insert(_el$155, () => cond.leftColumn, _el$156);
                insert(_el$155, () => cond.operator, _el$158);
                insert(_el$155, () => cond.rightColumn, null);
                _el$159.$$click = () => removeJoinCondition(cond.id);
                return _el$154;
              })()
            }), null);
            return _el$80;
          }
        }), null);
        return _el$76;
      }
    }), null);
    insert(_el$67, createComponent(Show, {
      get when() {
        return activeTab() === "sorting";
      },
      get children() {
        var _el$85 = _tmpl$14(), _el$86 = _el$85.firstChild;
        _el$86.$$click = addSortColumn;
        insert(_el$85, createComponent(For, {
          get each() {
            return queryState.sortColumns;
          },
          children: (sort) => {
            const isDragOver = () => dragOverItem() === sort.id && dragSortItem()?.type === "sort";
            return (() => {
              var _el$160 = _tmpl$322(), _el$161 = _el$160.firstChild, _el$162 = _el$161.nextSibling, _el$163 = _el$162.firstChild, _el$164 = _el$162.nextSibling, _el$165 = _el$164.nextSibling;
              _el$160.addEventListener("dragend", handleSortDragEnd);
              _el$160.addEventListener("drop", (e) => handleSortDrop(sort.id, e));
              _el$160.addEventListener("dragleave", handleSortDragLeave);
              _el$160.addEventListener("dragover", (e) => handleSortDragOver(sort.id, e));
              _el$160.addEventListener("dragstart", (e) => handleSortDragStart("sort", sort.id, e));
              setAttribute(_el$160, "draggable", true);
              _el$162.addEventListener("change", (e) => updateSortColumn(sort.id, {
                column: e.currentTarget.value
              }));
              insert(_el$162, createComponent(For, {
                get each() {
                  return allAvailableColumns();
                },
                children: (col) => (() => {
                  var _el$166 = _tmpl$26();
                  insert(_el$166, () => col.label);
                  createRenderEffect(() => _el$166.value = col.value);
                  return _el$166;
                })()
              }), null);
              _el$164.addEventListener("change", (e) => updateSortColumn(sort.id, {
                direction: e.currentTarget.value
              }));
              _el$165.$$click = () => removeSortColumn(sort.id);
              createRenderEffect((_p$) => {
                var _v$59 = isDragOver() ? "#334155" : "#1e293b", _v$60 = isDragOver() ? "2px dashed #3b82f6" : "2px solid transparent";
                _v$59 !== _p$.e && setStyleProperty(_el$160, "background-color", _p$.e = _v$59);
                _v$60 !== _p$.t && setStyleProperty(_el$160, "border", _p$.t = _v$60);
                return _p$;
              }, {
                e: undefined,
                t: undefined
              });
              createRenderEffect(() => _el$162.value = sort.column);
              createRenderEffect(() => _el$164.value = sort.direction);
              return _el$160;
            })();
          }
        }), null);
        return _el$85;
      }
    }), null);
    insert(_el$67, createComponent(Show, {
      get when() {
        return activeTab() === "misc";
      },
      get children() {
        var _el$87 = _tmpl$15(), _el$88 = _el$87.firstChild, _el$89 = _el$88.firstChild, _el$90 = _el$89.firstChild, _el$91 = _el$88.nextSibling, _el$92 = _el$91.firstChild, _el$93 = _el$92.nextSibling;
        _el$90.addEventListener("change", (e) => setQueryState("distinct", e.currentTarget.checked));
        _el$93.$$input = (e) => {
          const value2 = parseInt(e.currentTarget.value);
          setQueryState("limit", isNaN(value2) ? undefined : value2);
        };
        createRenderEffect(() => _el$90.checked = queryState.distinct);
        createRenderEffect(() => _el$93.value = queryState.limit || "");
        return _el$87;
      }
    }), null);
    insert(_el$17, createComponent(Show, {
      get when() {
        return tableContextMenu();
      },
      children: (menu) => {
        const table = queryState.tables.find((t) => t.id === menu().tableId);
        if (!table)
          return null;
        const isPrimary = queryState.primaryTableId === table.id || !queryState.primaryTableId && queryState.tables[0]?.id === table.id;
        const currentJoinType = table.joinType || "INNER";
        const joinTypes = [{
          type: "INNER",
          label: "INNER JOIN",
          color: "#3b82f6"
        }, {
          type: "LEFT",
          label: "LEFT JOIN",
          color: "#22c55e"
        }, {
          type: "RIGHT",
          label: "RIGHT JOIN",
          color: "#f59e0b"
        }, {
          type: "FULL",
          label: "FULL JOIN",
          color: "#a855f7"
        }, {
          type: "CROSS",
          label: "CROSS JOIN",
          color: "#ef4444"
        }];
        return [(() => {
          var _el$167 = _tmpl$332();
          _el$167.$$contextmenu = (e) => {
            e.preventDefault();
            closeTableContextMenu();
          };
          _el$167.$$click = closeTableContextMenu;
          return _el$167;
        })(), (() => {
          var _el$168 = _tmpl$36(), _el$169 = _el$168.firstChild, _el$170 = _el$169.firstChild, _el$171 = _el$170.nextSibling, _el$174 = _el$169.nextSibling, _el$175 = _el$174.nextSibling;
          _el$169.addEventListener("mouseleave", (e) => e.currentTarget.style.backgroundColor = "transparent");
          _el$169.addEventListener("mouseenter", (e) => e.currentTarget.style.backgroundColor = "#334155");
          _el$169.$$click = () => setPrimaryTable(menu().tableId);
          setStyleProperty(_el$169, "color", isPrimary ? "#f59e0b" : "#e2e8f0");
          insert(_el$171, isPrimary ? "已是主表" : "设为主表");
          insert(_el$168, createComponent(Show, {
            when: !isPrimary,
            get children() {
              return [_tmpl$342(), _tmpl$352(), createComponent(For, {
                each: joinTypes,
                children: (jt) => (() => {
                  var _el$176 = _tmpl$38(), _el$177 = _el$176.firstChild, _el$178 = _el$177.nextSibling;
                  _el$176.addEventListener("mouseleave", (e) => e.currentTarget.style.backgroundColor = currentJoinType === jt.type ? "rgba(59, 130, 246, 0.1)" : "transparent");
                  _el$176.addEventListener("mouseenter", (e) => e.currentTarget.style.backgroundColor = "#334155");
                  _el$176.$$click = () => {
                    updateTableJoinType(menu().tableId, jt.type);
                    closeTableContextMenu();
                  };
                  insert(_el$178, () => jt.label);
                  insert(_el$176, createComponent(Show, {
                    get when() {
                      return currentJoinType === jt.type;
                    },
                    get children() {
                      return _tmpl$37();
                    }
                  }), null);
                  createRenderEffect((_p$) => {
                    var _v$63 = currentJoinType === jt.type ? jt.color : "#e2e8f0", _v$64 = currentJoinType === jt.type ? "rgba(59, 130, 246, 0.1)" : "transparent", _v$65 = currentJoinType === jt.type ? "600" : "normal", _v$66 = jt.color;
                    _v$63 !== _p$.e && setStyleProperty(_el$176, "color", _p$.e = _v$63);
                    _v$64 !== _p$.t && setStyleProperty(_el$176, "background-color", _p$.t = _v$64);
                    _v$65 !== _p$.a && setStyleProperty(_el$176, "font-weight", _p$.a = _v$65);
                    _v$66 !== _p$.o && setStyleProperty(_el$177, "background-color", _p$.o = _v$66);
                    return _p$;
                  }, {
                    e: undefined,
                    t: undefined,
                    a: undefined,
                    o: undefined
                  });
                  return _el$176;
                })()
              })];
            }
          }), _el$174);
          _el$175.addEventListener("mouseleave", (e) => e.currentTarget.style.backgroundColor = "transparent");
          _el$175.addEventListener("mouseenter", (e) => e.currentTarget.style.backgroundColor = "#334155");
          _el$175.$$click = () => {
            removeTableFromCanvas(menu().tableId);
            closeTableContextMenu();
          };
          createRenderEffect((_p$) => {
            var _v$61 = `${menu().x}px`, _v$62 = `${menu().y}px`;
            _v$61 !== _p$.e && setStyleProperty(_el$168, "left", _p$.e = _v$61);
            _v$62 !== _p$.t && setStyleProperty(_el$168, "top", _p$.t = _v$62);
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$168;
        })()];
      }
    }), null);
    insert(_el$17, createComponent(Show, {
      get when() {
        return joinContextMenu();
      },
      children: (menu) => {
        const condition = queryState.joinConditions.find((c) => c.id === menu().joinId);
        if (!condition)
          return null;
        const table1 = queryState.tables.find((t) => t.id === condition.leftTableId);
        const table2 = queryState.tables.find((t) => t.id === condition.rightTableId);
        if (!table1 || !table2)
          return null;
        const getTableOrderIndex = (tableId) => {
          const primaryId = queryState.primaryTableId || queryState.tables[0]?.id;
          if (tableId === primaryId)
            return -1;
          return queryState.tables.findIndex((t) => t.id === tableId);
        };
        const order1 = getTableOrderIndex(table1.id);
        const order2 = getTableOrderIndex(table2.id);
        const targetTable = order1 < order2 ? table2 : table1;
        const sourceTable = order1 < order2 ? table1 : table2;
        const currentJoinType = targetTable.joinType || "INNER";
        const joinTypes = [{
          type: "INNER",
          label: "INNER JOIN",
          color: "#3b82f6"
        }, {
          type: "LEFT",
          label: "LEFT JOIN",
          color: "#22c55e"
        }, {
          type: "RIGHT",
          label: "RIGHT JOIN",
          color: "#f59e0b"
        }, {
          type: "FULL",
          label: "FULL JOIN",
          color: "#a855f7"
        }, {
          type: "CROSS",
          label: "CROSS JOIN",
          color: "#ef4444"
        }];
        return [(() => {
          var _el$180 = _tmpl$332();
          _el$180.$$contextmenu = (e) => {
            e.preventDefault();
            closeJoinContextMenu();
          };
          _el$180.$$click = closeJoinContextMenu;
          return _el$180;
        })(), (() => {
          var _el$181 = _tmpl$39(), _el$182 = _el$181.firstChild, _el$183 = _el$182.firstChild, _el$184 = _el$182.nextSibling, _el$185 = _el$184.firstChild, _el$186 = _el$184.nextSibling, _el$187 = _el$186.nextSibling;
          insert(_el$182, () => condition.leftColumn, _el$183);
          insert(_el$182, () => condition.rightColumn, null);
          insert(_el$184, () => targetTable.name, _el$185);
          insert(_el$181, createComponent(For, {
            each: joinTypes,
            children: (jt) => (() => {
              var _el$188 = _tmpl$40(), _el$189 = _el$188.firstChild, _el$190 = _el$189.nextSibling;
              _el$188.addEventListener("mouseleave", (e) => e.currentTarget.style.backgroundColor = currentJoinType === jt.type ? "rgba(59, 130, 246, 0.1)" : "transparent");
              _el$188.addEventListener("mouseenter", (e) => e.currentTarget.style.backgroundColor = "#334155");
              _el$188.$$click = () => {
                updateTableJoinType(targetTable.id, jt.type);
                closeJoinContextMenu();
              };
              insert(_el$190, () => jt.label);
              insert(_el$188, createComponent(Show, {
                get when() {
                  return currentJoinType === jt.type;
                },
                get children() {
                  return _tmpl$37();
                }
              }), null);
              createRenderEffect((_p$) => {
                var _v$69 = currentJoinType === jt.type ? jt.color : "#e2e8f0", _v$70 = currentJoinType === jt.type ? "rgba(59, 130, 246, 0.1)" : "transparent", _v$71 = currentJoinType === jt.type ? "600" : "normal", _v$72 = jt.color;
                _v$69 !== _p$.e && setStyleProperty(_el$188, "color", _p$.e = _v$69);
                _v$70 !== _p$.t && setStyleProperty(_el$188, "background-color", _p$.t = _v$70);
                _v$71 !== _p$.a && setStyleProperty(_el$188, "font-weight", _p$.a = _v$71);
                _v$72 !== _p$.o && setStyleProperty(_el$189, "background-color", _p$.o = _v$72);
                return _p$;
              }, {
                e: undefined,
                t: undefined,
                a: undefined,
                o: undefined
              });
              return _el$188;
            })()
          }), _el$186);
          _el$187.addEventListener("mouseleave", (e) => e.currentTarget.style.backgroundColor = "transparent");
          _el$187.addEventListener("mouseenter", (e) => e.currentTarget.style.backgroundColor = "#334155");
          _el$187.$$click = () => {
            removeJoinCondition(menu().joinId);
            closeJoinContextMenu();
          };
          createRenderEffect((_p$) => {
            var _v$67 = `${menu().x}px`, _v$68 = `${menu().y}px`;
            _v$67 !== _p$.e && setStyleProperty(_el$181, "left", _p$.e = _v$67);
            _v$68 !== _p$.t && setStyleProperty(_el$181, "top", _p$.t = _v$68);
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$181;
        })()];
      }
    }), null);
    createRenderEffect((_p$) => {
      var _v$18 = queryState.tables.length === 0, _v$19 = queryState.tables.length > 0 ? "#10b981" : "#475569", _v$20 = queryState.tables.length > 0 ? "pointer" : "not-allowed", _v$21 = `radial-gradient(circle, #334155 ${1 * scale()}px, transparent ${1 * scale()}px)`, _v$22 = `${20 * scale()}px ${20 * scale()}px`, _v$23 = `${panOffset().x}px ${panOffset().y}px`, _v$24 = isPanning() ? "grabbing" : draggingTableId() ? "move" : "default", _v$25 = `translate(${panOffset().x}px, ${panOffset().y}px) scale(${scale()})`, _v$26 = !generatedSql(), _v$27 = generatedSql() ? "pointer" : "not-allowed";
      _v$18 !== _p$.e && (_el$22.disabled = _p$.e = _v$18);
      _v$19 !== _p$.t && setStyleProperty(_el$22, "background-color", _p$.t = _v$19);
      _v$20 !== _p$.a && setStyleProperty(_el$22, "cursor", _p$.a = _v$20);
      _v$21 !== _p$.o && setStyleProperty(_el$53, "background-image", _p$.o = _v$21);
      _v$22 !== _p$.i && setStyleProperty(_el$53, "background-size", _p$.i = _v$22);
      _v$23 !== _p$.n && setStyleProperty(_el$53, "background-position", _p$.n = _v$23);
      _v$24 !== _p$.s && setStyleProperty(_el$53, "cursor", _p$.s = _v$24);
      _v$25 !== _p$.h && setStyleProperty(_el$54, "transform", _p$.h = _v$25);
      _v$26 !== _p$.r && (_el$63.disabled = _p$.r = _v$26);
      _v$27 !== _p$.d && setStyleProperty(_el$63, "cursor", _p$.d = _v$27);
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined,
      r: undefined,
      d: undefined
    });
    return _el$17;
  })();
}
delegateEvents(["mousedown", "contextmenu", "click", "input", "mousemove", "mouseup"]);

// ../frontend/query-interface.tsx
var _tmpl$41 = /* @__PURE__ */ template(`<div style=padding:16px;text-align:center>查询中...`);
var _tmpl$210 = /* @__PURE__ */ template(`<div style=color:red;padding:16px>`);
var _tmpl$310 = /* @__PURE__ */ template(`<span style=margin-left:8px;color:#3b82f6>(滚动加载更多)`);
var _tmpl$44 = /* @__PURE__ */ template(`<span style=margin-left:8px;color:#f59e0b>加载中...`);
var _tmpl$54 = /* @__PURE__ */ template(`<span style=margin-left:12px;color:#10b981>耗时 `);
var _tmpl$63 = /* @__PURE__ */ template(`<div style=color:#9ca3af;font-size:13px>暂无修改`);
var _tmpl$73 = /* @__PURE__ */ template(`<div style="margin-bottom:12px;padding:12px;background-color:#fef3c7;border-radius:4px;border:1px solid #f59e0b;flex-shrink:0"><div style=font-weight:bold;margin-bottom:8px;color:#92400e>待执行的 UPDATE SQL:</div><div style=max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:6px>`);
var _tmpl$83 = /* @__PURE__ */ template(`<div style=display:flex;flex-direction:column;height:100%><div style=margin-bottom:12px;color:#6b7280;font-size:14px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0><span>查询结果：<!> <!> 行，<!> 列</span><div style=display:flex;align-items:center;gap:12px><span> 个待保存的修改</span><button style="padding:6px 16px;font-size:14px;background-color:#6b7280;color:#fff;border:none;border-radius:4px;cursor:pointer"></button><button style="padding:6px 16px;font-size:14px;color:#fff;border:none;border-radius:4px"></button></div></div><div id=table-container style="flex:1;overflow:auto;position:relative;border:1px solid #d1d5db;background-color:#fff"><div style=width:100%;position:absolute;top:0;left:0;pointer-events:none></div><div style=position:sticky;top:0;left:0;width:max-content;z-index:10><table style=border-collapse:collapse;min-width:100%;table-layout:fixed><colgroup></colgroup><thead style=position:sticky;top:0;z-index:20;background-color:#f3f4f6><tr></tr></thead><tbody><tr><td style=padding:0;border:none></td></tr><tr><td style=padding:0;border:none></td></tr></tbody></table><div style=position:absolute;right:-4px;top:0;bottom:0;width:8px;cursor:ew-resize;background-color:transparent;z-index:20>`);
var _tmpl$93 = /* @__PURE__ */ template(`<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background-color:#fffbeb;border-radius:4px;border:1px solid #fcd34d"><span style=flex:1;font-family:monospace;font-size:13px;word-break:break-all>. <!>;</span><button title=删除此修改并还原值 style="padding:2px 8px;font-size:12px;background-color:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;flex-shrink:0">删除`);
var _tmpl$03 = /* @__PURE__ */ template(`<col>`);
var _tmpl$110 = /* @__PURE__ */ template(`<th scope=col style="padding:8px 12px;text-align:center;font-weight:600;border:1px solid #d1d5db;position:relative;user-select:none;height:40px;box-sizing:border-box"><div style=position:absolute;right:-3px;top:0;bottom:0;width:6px;cursor:col-resize;background-color:transparent;z-index:10>`);
var _tmpl$103 = /* @__PURE__ */ template(`<tr style=height:40px;box-sizing:border-box>`);
var _tmpl$113 = /* @__PURE__ */ template(`<button style="padding:10px 24px;font-size:14px;font-weight:500;background-color:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px"><span>⏹</span> 中断`);
var _tmpl$123 = /* @__PURE__ */ template(`<div style="position:fixed;top:0;left:0;right:0;bottom:0;background-color:rgba(0, 0, 0, 0.5);z-index:100;display:flex;justify-content:center;align-items:center;padding:20px"><div style="width:100%;height:100%;max-width:1600px;max-height:900px;border-radius:12px;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0, 0, 0, 0.5)">`);
var _tmpl$132 = /* @__PURE__ */ template(`<span style="color:#64748b;font-size:12px;background-color:#475569;padding:1px 6px;border-radius:10px">`);
var _tmpl$142 = /* @__PURE__ */ template(`<div style=color:#64748b;font-size:13px>暂无消息`);
var _tmpl$152 = /* @__PURE__ */ template(`<div style=margin-top:8px;max-height:180px;overflow-y:auto><div style=display:flex;flex-direction:column;gap:4px>`);
var _tmpl$162 = /* @__PURE__ */ template(`<div style=display:flex;height:100vh;overflow:hidden;background-color:#f0f2f5><div style=flex:1;display:flex;flex-direction:column;padding:20px;overflow:hidden;box-sizing:border-box><div style=flex-shrink:0;margin-bottom:16px;display:flex;flex-direction:column><textarea placeholder="在这里输入SQL语句，例如：SELECT * FROM your_table;"style="height:120px;width:100%;font-size:14px;font-family:'JetBrains Mono', 'Fira Code', 'Consolas', monospace;border-radius:8px;padding:12px;border:1px solid #d1d5db;resize:vertical;box-sizing:border-box;background-color:#1e293b;color:#e2e8f0;line-height:1.5"></textarea><div style=display:flex;gap:8px;align-items:center;margin-top:8px><button style="padding:10px 24px;font-size:14px;font-weight:500;color:#fff;border:none;border-radius:6px;display:flex;align-items:center;gap:6px;transition:background-color 0.2s ease"><span>▶</span> 执行</button><button style="padding:10px 24px;font-size:14px;font-weight:500;color:#fff;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:background-color 0.2s ease"><span>\uD83D\uDD27</span> </button><span style="margin-left:auto;color:#6b7280;font-size:12px;font-family:'JetBrains Mono', monospace">Ctrl+Enter 执行</span></div></div><div style="flex:1;min-height:200px;background-color:#fff;padding:16px;border-radius:8px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 1px 3px rgba(0,0,0,0.1)"></div><div style=margin-top:16px;background-color:#1e293b;border-radius:8px;padding:12px;flex-shrink:0><div style=display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none><div style=display:flex;align-items:center;gap:8px><span style="color:#94a3b8;font-size:12px;transition:transform 0.2s">▼</span><span style=color:#94a3b8;font-size:13px;font-weight:600>数据库消息</span><span style=width:8px;height:8px;border-radius:50%></span></div><button style="padding:2px 8px;font-size:12px;background-color:#475569;color:#e2e8f0;border:none;border-radius:4px;cursor:pointer">清除`);
var _tmpl$172 = /* @__PURE__ */ template(`<div style="font-family:monospace;font-size:13px;padding:4px 8px;border-radius:4px;display:flex;gap:8px;flex-wrap:wrap"><span style=color:#64748b;flex-shrink:0></span><span style=font-weight:500;flex-shrink:0>[<!>]</span><span>`);
var _tmpl$182 = /* @__PURE__ */ template(`<span style=color:#9ca3af;font-size:12px;width:100%;padding-left:70px>↳ `);
function QueryInterface() {
  const [sql, setSql] = createSignal(`select a.id ,a.name, b.id,b.name from student a left join student b on a.id = b.id `);
  const [result, setResult] = createStore([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal(null);
  const [columns, setColumns] = createSignal([]);
  const [pendingUpdates, setPendingUpdates] = createSignal([]);
  const [saving, setSaving] = createSignal(false);
  const [showPendingSql, setShowPendingSql] = createSignal(false);
  const [columnWidths, setColumnWidths] = createStore([]);
  const [tableWidth, setTableWidth] = createSignal(null);
  const [modifiedCells, setModifiedCells] = createStore([]);
  const [queryDuration, setQueryDuration] = createSignal(null);
  const [notices, setNotices] = createSignal([]);
  const [sseConnected, setSseConnected] = createSignal(false);
  const [messagesCollapsed, setMessagesCollapsed] = createSignal(true);
  const [hasMore, setHasMore] = createSignal(false);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [showQueryBuilder, setShowQueryBuilder] = createSignal(false);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(600);
  const ROW_HEIGHT = 40;
  const OVERSCAN = 10;
  const visibleRange = () => {
    const start = Math.floor(scrollTop() / ROW_HEIGHT);
    const end = Math.ceil((scrollTop() + containerHeight()) / ROW_HEIGHT);
    return {
      start: Math.max(0, start - OVERSCAN),
      end: Math.min(result.length, end + OVERSCAN)
    };
  };
  const visibleRows = () => {
    const {
      start,
      end
    } = visibleRange();
    return result.slice(start, end).map((row, i) => ({
      row,
      index: start + i
    }));
  };
  const totalHeight = () => result.length * ROW_HEIGHT;
  const offsetY = () => visibleRange().start * ROW_HEIGHT;
  onMount(() => {
    const updateHeight = () => {
      const el = document.getElementById("table-container");
      if (el)
        setContainerHeight(el.clientHeight);
    };
    window.addEventListener("resize", updateHeight);
    updateHeight();
    onCleanup(() => window.removeEventListener("resize", updateHeight));
    const sessionId = getSessionId();
    setSseConnected(true);
    const unsubscribe = subscribeEvents(sessionId, (message) => {
      console.log("收到消息:", message);
      setNotices((prev) => [...prev.slice(-49), message]);
    });
    onCleanup(() => {
      unsubscribe();
      setSseConnected(false);
    });
  });
  function clearNotices() {
    setNotices([]);
  }
  function formatDuration(ms) {
    if (ms < 1000) {
      return `${Math.round(ms)} ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)} s`;
    } else {
      const minutes2 = Math.floor(ms / 60000);
      const seconds2 = (ms % 60000 / 1000).toFixed(1);
      return `${minutes2} m ${seconds2} s`;
    }
  }
  function isNumericValue(value2) {
    if (value2 === null || value2 === undefined)
      return false;
    if (typeof value2 === "number")
      return true;
    if (typeof value2 === "string") {
      const trimmed = value2.trim();
      return trimmed !== "" && !isNaN(Number(trimmed));
    }
    return false;
  }
  function getAlignment(value2) {
    if (typeof value2 === "number" || typeof value2 === "boolean" || isNumericValue(value2)) {
      return "right";
    }
    return "left";
  }
  function startResize(colIndex, e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = columnWidths[colIndex] || 120;
    const onMouseMove = (e2) => {
      const diff = e2.clientX - startX;
      const newWidth = Math.max(60, startWidth + diff);
      setColumnWidths(colIndex, newWidth);
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }
  function startTableResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = tableWidth() || columnWidths.reduce((sum, w) => sum + (w || 120), 0);
    const onMouseMove = (e2) => {
      const diff = e2.clientX - startX;
      const newWidth = Math.max(200, startWidth + diff);
      setTableWidth(newWidth);
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }
  async function runUserQuery() {
    setLoading(true);
    setError(null);
    setResult([]);
    setPendingUpdates([]);
    setQueryDuration(null);
    setHasMore(false);
    setModifiedCells([]);
    const startTime = performance.now();
    try {
      const sessionId = getSessionId();
      const data = await queryStream(sessionId, sql(), 100);
      if (data.error) {
        throw new Error(data.error);
      }
      setColumns(data.columns || []);
      setColumnWidths((data.columns || []).map(() => 120));
      const rows = data.rows || [];
      setResult(rows);
      const colCount = (data.columns || []).length;
      setModifiedCells(rows.map(() => Array(colCount).fill(false)));
      setHasMore(data.hasMore || false);
      setQueryDuration(performance.now() - startTime);
      console.log(`查询完成: ${rows.length} 行, hasMore: ${data.hasMore}`);
    } catch (e) {
      setError(e.message || "请求失败");
    } finally {
      setLoading(false);
    }
  }
  async function loadMore() {
    if (loadingMore() || !hasMore())
      return;
    setLoadingMore(true);
    try {
      const sessionId = getSessionId();
      const data = await queryStreamMore(sessionId, 100);
      if (data.error) {
        throw new Error(data.error);
      }
      const newRows = data.rows || [];
      if (newRows.length > 0) {
        setResult((prev) => [...prev, ...newRows]);
        const colCount = columns().length;
        const newModifiedRows = newRows.map(() => Array(colCount).fill(false));
        setModifiedCells((prev) => [...prev, ...newModifiedRows]);
      }
      setHasMore(data.hasMore || false);
      console.log(`加载更多: +${newRows.length} 行, hasMore: ${data.hasMore}`);
    } catch (e) {
      console.error("加载更多失败:", e.message);
    } finally {
      setLoadingMore(false);
    }
  }
  function handleScroll(e) {
    const target = e.currentTarget;
    setScrollTop(target.scrollTop);
    const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (scrollBottom < 200 && hasMore() && !loadingMore()) {
      loadMore();
    }
  }
  async function doCancelQuery() {
    try {
      const sessionId = getSessionId();
      const {
        success,
        message,
        error: err
      } = await cancelQuery(sessionId);
      if (success) {
        console.log("查询取消:", message);
      } else {
        console.warn("取消失败:", err || message);
      }
    } catch (e) {
      console.error("取消请求失败:", e.message);
    }
  }
  function formatSqlValue(value2) {
    if (value2 === null || value2 === undefined)
      return "NULL";
    if (typeof value2 === "number")
      return String(value2);
    if (typeof value2 === "boolean")
      return value2 ? "TRUE" : "FALSE";
    return `'${String(value2).replace(/'/g, "''")}'`;
  }
  function generateUpdateSql(rowIndex, colIndex, newValue) {
    const colInfo = columns()[colIndex];
    const row = result[rowIndex];
    const whereConditions = colInfo.uniqueKeyColumns.map((keyColName) => {
      const keyColIndex = columns().findIndex((c) => c.columnName === keyColName);
      const keyValue = row[keyColIndex];
      return `${keyColName} = ${formatSqlValue(keyValue)}`;
    });
    return `UPDATE ${colInfo.tableName} SET ${colInfo.columnName} = ${formatSqlValue(newValue)} WHERE ${whereConditions.join(" AND ")}`;
  }
  function handleCellSave(rowIndex, colIndex, newValue) {
    const currentValue = result[rowIndex][colIndex];
    if (String(currentValue) === newValue)
      return;
    const existingUpdate = pendingUpdates().find((u) => u.rowIndex === rowIndex && u.colIndex === colIndex);
    const originalValue = existingUpdate ? existingUpdate.oldValue : currentValue;
    const updateSql = generateUpdateSql(rowIndex, colIndex, newValue);
    setResult(rowIndex, colIndex, newValue);
    setModifiedCells(rowIndex, colIndex, true);
    setPendingUpdates((prev) => {
      const filtered = prev.filter((u) => !(u.rowIndex === rowIndex && u.colIndex === colIndex));
      return [...filtered, {
        sql: updateSql,
        rowIndex,
        colIndex,
        oldValue: originalValue
      }];
    });
  }
  function removePendingUpdate(index) {
    const update = pendingUpdates()[index];
    if (!update)
      return;
    setResult(update.rowIndex, update.colIndex, update.oldValue);
    setModifiedCells(update.rowIndex, update.colIndex, false);
    setPendingUpdates((prev) => prev.filter((_, i) => i !== index));
  }
  async function saveAllChanges() {
    if (pendingUpdates().length === 0)
      return;
    setSaving(true);
    setError(null);
    try {
      const sessionId = getSessionId();
      for (const update of pendingUpdates()) {
        const res = await saveChanges(sessionId, update.sql);
        if (!res.success && res.error) {
          throw new Error(res.error || `执行失败: ${update.sql}`);
        }
      }
      for (const update of pendingUpdates()) {
        setModifiedCells(update.rowIndex, update.colIndex, false);
      }
      setPendingUpdates([]);
    } catch (e) {
      setError(e.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }
  function renderResult() {
    if (loading()) {
      return _tmpl$41();
    }
    if (error()) {
      return (() => {
        var _el$2 = _tmpl$210();
        insert(_el$2, error);
        return _el$2;
      })();
    }
    return (() => {
      var _el$3 = _tmpl$83(), _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$6 = _el$5.firstChild, _el$12 = _el$6.nextSibling, _el$7 = _el$12.nextSibling, _el$13 = _el$7.nextSibling, _el$8 = _el$13.nextSibling, _el$14 = _el$8.nextSibling, _el$9 = _el$14.nextSibling, _el$15 = _el$5.nextSibling, _el$16 = _el$15.firstChild, _el$17 = _el$16.firstChild, _el$18 = _el$16.nextSibling, _el$19 = _el$18.nextSibling, _el$24 = _el$4.nextSibling, _el$25 = _el$24.firstChild, _el$26 = _el$25.nextSibling, _el$27 = _el$26.firstChild, _el$28 = _el$27.firstChild, _el$29 = _el$28.nextSibling, _el$30 = _el$29.firstChild, _el$31 = _el$29.nextSibling, _el$32 = _el$31.firstChild, _el$33 = _el$32.firstChild, _el$34 = _el$32.nextSibling, _el$35 = _el$34.firstChild, _el$36 = _el$27.nextSibling;
      insert(_el$5, () => hasMore() ? "已加载" : "共", _el$12);
      insert(_el$5, () => result.length, _el$13);
      insert(_el$5, () => columns().length, _el$14);
      insert(_el$5, createComponent(Show, {
        get when() {
          return hasMore();
        },
        get children() {
          return _tmpl$310();
        }
      }), null);
      insert(_el$5, createComponent(Show, {
        get when() {
          return loadingMore();
        },
        get children() {
          return _tmpl$44();
        }
      }), null);
      insert(_el$5, createComponent(Show, {
        get when() {
          return queryDuration() !== null;
        },
        get children() {
          var _el$10 = _tmpl$54(), _el$11 = _el$10.firstChild;
          insert(_el$10, () => formatDuration(queryDuration()), null);
          return _el$10;
        }
      }), null);
      insert(_el$16, () => pendingUpdates().length, _el$17);
      _el$18.$$click = () => setShowPendingSql(!showPendingSql());
      insert(_el$18, () => showPendingSql() ? "隐藏 SQL" : "查看修改");
      _el$19.$$click = saveAllChanges;
      insert(_el$19, () => saving() ? "保存中..." : "保存修改");
      insert(_el$3, createComponent(Show, {
        get when() {
          return showPendingSql();
        },
        get children() {
          var _el$20 = _tmpl$73(), _el$21 = _el$20.firstChild, _el$23 = _el$21.nextSibling;
          insert(_el$20, createComponent(Show, {
            get when() {
              return pendingUpdates().length === 0;
            },
            get children() {
              return _tmpl$63();
            }
          }), _el$23);
          insert(_el$23, createComponent(For, {
            get each() {
              return pendingUpdates();
            },
            children: (update, index) => (() => {
              var _el$37 = _tmpl$93(), _el$38 = _el$37.firstChild, _el$39 = _el$38.firstChild, _el$41 = _el$39.nextSibling, _el$40 = _el$41.nextSibling, _el$42 = _el$38.nextSibling;
              insert(_el$38, () => index() + 1, _el$39);
              insert(_el$38, () => update.sql, _el$41);
              _el$42.$$click = () => removePendingUpdate(index());
              return _el$37;
            })()
          }));
          return _el$20;
        }
      }), _el$24);
      _el$24.addEventListener("scroll", handleScroll);
      insert(_el$28, createComponent(For, {
        get each() {
          return columns();
        },
        children: (_, colIndex) => (() => {
          var _el$43 = _tmpl$03();
          createRenderEffect((_$p) => setStyleProperty(_el$43, "width", `${columnWidths[colIndex()] || 120}px`));
          return _el$43;
        })()
      }));
      insert(_el$30, createComponent(For, {
        get each() {
          return columns();
        },
        children: (col, colIndex) => (() => {
          var _el$44 = _tmpl$110(), _el$45 = _el$44.firstChild;
          insert(_el$44, () => col.name, _el$45);
          _el$45.addEventListener("mouseleave", (e) => e.currentTarget.style.backgroundColor = "transparent");
          _el$45.addEventListener("mouseenter", (e) => e.currentTarget.style.backgroundColor = "#2563eb");
          _el$45.$$mousedown = (e) => startResize(colIndex(), e);
          return _el$44;
        })()
      }));
      insert(_el$31, createComponent(For, {
        get each() {
          return visibleRows();
        },
        children: ({
          row,
          index: rowIndex
        }) => (() => {
          var _el$46 = _tmpl$103();
          insert(_el$46, createComponent(For, {
            each: row,
            children: (col, colIndex) => createComponent(EditableCell, {
              value: col,
              get isEditable() {
                return columns()[colIndex()].isEditable;
              },
              get isModified() {
                return modifiedCells[rowIndex]?.[colIndex()] ?? false;
              },
              get align() {
                return getAlignment(col);
              },
              onSave: (newValue) => {
                handleCellSave(rowIndex, colIndex(), newValue);
              }
            })
          }));
          return _el$46;
        })()
      }), _el$34);
      _el$36.addEventListener("mouseleave", (e) => e.currentTarget.style.backgroundColor = "transparent");
      _el$36.addEventListener("mouseenter", (e) => e.currentTarget.style.backgroundColor = "#10b981");
      _el$36.$$mousedown = startTableResize;
      createRenderEffect((_p$) => {
        var _v$ = pendingUpdates().length > 0 ? "#f59e0b" : "#9ca3af", _v$2 = saving() || pendingUpdates().length === 0, _v$3 = pendingUpdates().length > 0 ? "#10b981" : "#9ca3af", _v$4 = saving() || pendingUpdates().length === 0 ? "not-allowed" : "pointer", _v$5 = `${totalHeight()}px`, _v$6 = tableWidth() ? `${tableWidth()}px` : "auto", _v$7 = `${offsetY()}px`, _v$8 = columns().length, _v$9 = `${Math.max(0, totalHeight() - offsetY() - visibleRows().length * ROW_HEIGHT)}px`, _v$0 = columns().length;
        _v$ !== _p$.e && setStyleProperty(_el$16, "color", _p$.e = _v$);
        _v$2 !== _p$.t && (_el$19.disabled = _p$.t = _v$2);
        _v$3 !== _p$.a && setStyleProperty(_el$19, "background-color", _p$.a = _v$3);
        _v$4 !== _p$.o && setStyleProperty(_el$19, "cursor", _p$.o = _v$4);
        _v$5 !== _p$.i && setStyleProperty(_el$25, "height", _p$.i = _v$5);
        _v$6 !== _p$.n && setStyleProperty(_el$27, "width", _p$.n = _v$6);
        _v$7 !== _p$.s && setStyleProperty(_el$32, "height", _p$.s = _v$7);
        _v$8 !== _p$.h && setAttribute(_el$33, "colspan", _p$.h = _v$8);
        _v$9 !== _p$.r && setStyleProperty(_el$34, "height", _p$.r = _v$9);
        _v$0 !== _p$.d && setAttribute(_el$35, "colspan", _p$.d = _v$0);
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined,
        n: undefined,
        s: undefined,
        h: undefined,
        r: undefined,
        d: undefined
      });
      return _el$3;
    })();
  }
  async function handleQueryRequest(querySql) {
    setSql(querySql);
    setLoading(true);
    setError(null);
    setResult([]);
    setPendingUpdates([]);
    setQueryDuration(null);
    setHasMore(false);
    setModifiedCells([]);
    const startTime = performance.now();
    try {
      const sessionId = getSessionId();
      const data = await queryReadonly(sessionId, querySql, 1000);
      if (data.error) {
        throw new Error(data.error);
      }
      setColumns(data.columns || []);
      setColumnWidths((data.columns || []).map(() => 120));
      const rows = data.rows || [];
      setResult(rows);
      const colCount = (data.columns || []).length;
      setModifiedCells(rows.map(() => Array(colCount).fill(false)));
      setHasMore(data.hasMore || false);
      setQueryDuration(performance.now() - startTime);
    } catch (e) {
      setError(e.message || "请求失败");
    } finally {
      setLoading(false);
    }
  }
  return (() => {
    var _el$47 = _tmpl$162(), _el$48 = _el$47.firstChild, _el$49 = _el$48.firstChild, _el$50 = _el$49.firstChild, _el$51 = _el$50.nextSibling, _el$52 = _el$51.firstChild, _el$54 = _el$52.nextSibling, _el$55 = _el$54.firstChild, _el$56 = _el$55.nextSibling, _el$57 = _el$54.nextSibling, _el$60 = _el$49.nextSibling, _el$61 = _el$60.nextSibling, _el$62 = _el$61.firstChild, _el$63 = _el$62.firstChild, _el$64 = _el$63.firstChild, _el$65 = _el$64.nextSibling, _el$66 = _el$65.nextSibling, _el$68 = _el$63.nextSibling;
    insert(_el$47, createComponent(Sidebar, {
      onQueryRequest: handleQueryRequest
    }), _el$48);
    _el$50.$$input = (e) => setSql(e.currentTarget.value);
    _el$52.$$click = runUserQuery;
    insert(_el$51, createComponent(Show, {
      get when() {
        return loading();
      },
      get children() {
        var _el$53 = _tmpl$113();
        _el$53.$$click = doCancelQuery;
        return _el$53;
      }
    }), _el$54);
    _el$54.$$click = () => setShowQueryBuilder(!showQueryBuilder());
    insert(_el$54, () => showQueryBuilder() ? "关闭构建器" : "可视化构建", null);
    insert(_el$48, createComponent(Show, {
      get when() {
        return showQueryBuilder();
      },
      get children() {
        var _el$58 = _tmpl$123(), _el$59 = _el$58.firstChild;
        insert(_el$59, createComponent(VisualQueryBuilder, {
          get initialSql() {
            return sql().trim() || undefined;
          },
          onExecuteQuery: (generatedSql) => {
            setSql(generatedSql);
            setShowQueryBuilder(false);
            runUserQuery();
          },
          onClose: () => setShowQueryBuilder(false)
        }));
        return _el$58;
      }
    }), _el$60);
    insert(_el$60, renderResult);
    _el$62.$$click = () => setMessagesCollapsed(!messagesCollapsed());
    insert(_el$63, createComponent(Show, {
      get when() {
        return notices().length > 0;
      },
      get children() {
        var _el$67 = _tmpl$132();
        insert(_el$67, () => notices().length);
        return _el$67;
      }
    }), null);
    _el$68.$$click = (e) => {
      e.stopPropagation();
      clearNotices();
    };
    insert(_el$61, createComponent(Show, {
      get when() {
        return !messagesCollapsed();
      },
      get children() {
        var _el$69 = _tmpl$152(), _el$71 = _el$69.firstChild;
        insert(_el$69, createComponent(Show, {
          get when() {
            return notices().length === 0;
          },
          get children() {
            return _tmpl$142();
          }
        }), _el$71);
        insert(_el$71, createComponent(For, {
          get each() {
            return notices();
          },
          children: (notice) => {
            const typeColors = {
              ERROR: {
                bg: "#4c1d1d",
                label: "#fca5a5",
                text: "#fecaca"
              },
              WARNING: {
                bg: "#422006",
                label: "#fbbf24",
                text: "#fde68a"
              },
              NOTICE: {
                bg: "#1e3a5f",
                label: "#60a5fa",
                text: "#93c5fd"
              },
              INFO: {
                bg: "#334155",
                label: "#94a3b8",
                text: "#cbd5e1"
              },
              QUERY: {
                bg: "#1e3a3a",
                label: "#2dd4bf",
                text: "#99f6e4"
              },
              NOTIFICATION: {
                bg: "#3b1d4a",
                label: "#c084fc",
                text: "#d8b4fe"
              }
            };
            const colors = typeColors[notice.type] || typeColors.INFO;
            return (() => {
              var _el$72 = _tmpl$172(), _el$73 = _el$72.firstChild, _el$74 = _el$73.nextSibling, _el$75 = _el$74.firstChild, _el$77 = _el$75.nextSibling, _el$76 = _el$77.nextSibling, _el$78 = _el$74.nextSibling;
              insert(_el$73, () => new Date(notice.timestamp).toLocaleTimeString());
              insert(_el$74, () => notice.type, _el$77);
              insert(_el$78, () => notice.message);
              insert(_el$72, (() => {
                var _c$ = memo(() => !!notice.detail);
                return () => _c$() && (() => {
                  var _el$79 = _tmpl$182(), _el$80 = _el$79.firstChild;
                  insert(_el$79, () => notice.detail, null);
                  return _el$79;
                })();
              })(), null);
              createRenderEffect((_p$) => {
                var { bg: _v$16, label: _v$17, text: _v$18 } = colors;
                _v$16 !== _p$.e && setStyleProperty(_el$72, "background-color", _p$.e = _v$16);
                _v$17 !== _p$.t && setStyleProperty(_el$74, "color", _p$.t = _v$17);
                _v$18 !== _p$.a && setStyleProperty(_el$78, "color", _p$.a = _v$18);
                return _p$;
              }, {
                e: undefined,
                t: undefined,
                a: undefined
              });
              return _el$72;
            })();
          }
        }));
        return _el$69;
      }
    }), null);
    createRenderEffect((_p$) => {
      var _v$1 = loading() || sql().trim().length === 0, _v$10 = loading() ? "#6b7280" : "#10b981", _v$11 = loading() ? "not-allowed" : "pointer", _v$12 = showQueryBuilder() ? "#3b82f6" : "#6366f1", _v$13 = messagesCollapsed() ? "rotate(-90deg)" : "rotate(0deg)", _v$14 = sseConnected() ? "#22c55e" : "#ef4444", _v$15 = sseConnected() ? "SSE 已连接" : "SSE 未连接";
      _v$1 !== _p$.e && (_el$52.disabled = _p$.e = _v$1);
      _v$10 !== _p$.t && setStyleProperty(_el$52, "background-color", _p$.t = _v$10);
      _v$11 !== _p$.a && setStyleProperty(_el$52, "cursor", _p$.a = _v$11);
      _v$12 !== _p$.o && setStyleProperty(_el$54, "background-color", _p$.o = _v$12);
      _v$13 !== _p$.i && setStyleProperty(_el$64, "transform", _p$.i = _v$13);
      _v$14 !== _p$.n && setStyleProperty(_el$66, "background-color", _p$.n = _v$14);
      _v$15 !== _p$.s && setAttribute(_el$66, "title", _p$.s = _v$15);
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined
    });
    createRenderEffect(() => _el$50.value = sql());
    return _el$47;
  })();
}
delegateEvents(["click", "mousedown", "input"]);

// ../frontend/index-tauri.tsx
setTransport(new TauriTransport);
var root = document.getElementById("root");
if (root) {
  render(() => createComponent(HashRouter, {
    get children() {
      return [createComponent(Route, {
        path: "/",
        component: App
      }), createComponent(Route, {
        path: "/postgres",
        component: Postgres
      }), createComponent(Route, {
        path: "/postgres/query-interface",
        component: QueryInterface
      })];
    }
  }), root);
}
