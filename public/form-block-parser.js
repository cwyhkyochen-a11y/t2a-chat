/**
 * t2a-chat Form Block Parser
 * 解析 ```form 块中的 JS-like object literal 语法
 * 纯原生 JS，无依赖，浏览器 + Node 通用
 */
;(function (root) {
  'use strict';

  // ─── Mini Tokenizer ───────────────────────────────────────────────

  function tokenize(src) {
    var tokens = [];
    var i = 0;
    var len = src.length;

    while (i < len) {
      var ch = src[i];

      // whitespace
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        i++;
        continue;
      }

      // single-char punctuation
      if (ch === '{' || ch === '}' || ch === '[' || ch === ']' ||
          ch === ':' || ch === ',') {
        tokens.push({ type: 'punct', value: ch });
        i++;
        continue;
      }

      // string (double or single quote)
      if (ch === '"' || ch === "'") {
        var quote = ch;
        var str = '';
        i++; // skip opening quote
        while (i < len && src[i] !== quote) {
          if (src[i] === '\\' && i + 1 < len) {
            var next = src[i + 1];
            if (next === quote || next === '\\') {
              str += next;
              i += 2;
            } else if (next === 'n') {
              str += '\n';
              i += 2;
            } else if (next === 't') {
              str += '\t';
              i += 2;
            } else {
              str += src[i];
              i++;
            }
          } else {
            str += src[i];
            i++;
          }
        }
        i++; // skip closing quote (or end of input)
        tokens.push({ type: 'string', value: str });
        continue;
      }

      // number
      if ((ch >= '0' && ch <= '9') || (ch === '-' && i + 1 < len && src[i + 1] >= '0' && src[i + 1] <= '9')) {
        var numStr = '';
        if (ch === '-') { numStr += '-'; i++; }
        while (i < len && ((src[i] >= '0' && src[i] <= '9') || src[i] === '.')) {
          numStr += src[i];
          i++;
        }
        tokens.push({ type: 'number', value: parseFloat(numStr) });
        continue;
      }

      // identifier (true, false, or bare key)
      if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$') {
        var ident = '';
        while (i < len && ((src[i] >= 'a' && src[i] <= 'z') || (src[i] >= 'A' && src[i] <= 'Z') ||
               (src[i] >= '0' && src[i] <= '9') || src[i] === '_' || src[i] === '$' || src[i] === '-')) {
          ident += src[i];
          i++;
        }
        if (ident === 'true') {
          tokens.push({ type: 'boolean', value: true });
        } else if (ident === 'false') {
          tokens.push({ type: 'boolean', value: false });
        } else {
          tokens.push({ type: 'ident', value: ident });
        }
        continue;
      }

      // skip unknown char
      i++;
    }

    return tokens;
  }

  // ─── Mini Parser ──────────────────────────────────────────────────

  function Parser(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  Parser.prototype.peek = function () {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
  };

  Parser.prototype.consume = function () {
    return this.tokens[this.pos++];
  };

  Parser.prototype.expect = function (type, value) {
    var t = this.peek();
    if (t && t.type === type && (value === undefined || t.value === value)) {
      return this.consume();
    }
    return null;
  };

  Parser.prototype.parseValue = function () {
    var t = this.peek();
    if (!t) return undefined;

    if (t.type === 'string' || t.type === 'number' || t.type === 'boolean') {
      this.consume();
      return t.value;
    }

    if (t.type === 'punct' && t.value === '[') {
      return this.parseArray();
    }

    if (t.type === 'punct' && t.value === '{') {
      return this.parseObject();
    }

    if (t.type === 'ident') {
      // bare identifier as string value
      this.consume();
      return t.value;
    }

    return undefined;
  };

  Parser.prototype.parseArray = function () {
    this.expect('punct', '[');
    var arr = [];
    while (true) {
      var t = this.peek();
      if (!t) break;
      if (t.type === 'punct' && t.value === ']') { this.consume(); break; }
      var val = this.parseValue();
      if (val !== undefined) arr.push(val);
      // skip comma
      var next = this.peek();
      if (next && next.type === 'punct' && next.value === ',') this.consume();
    }
    return arr;
  };

  Parser.prototype.parseObject = function () {
    this.expect('punct', '{');
    var obj = {};
    while (true) {
      var t = this.peek();
      if (!t) break;
      if (t.type === 'punct' && t.value === '}') { this.consume(); break; }

      // key
      var key = null;
      if (t.type === 'ident' || t.type === 'string') {
        key = this.consume().value;
      } else {
        // skip unexpected token
        this.consume();
        continue;
      }

      // colon
      if (!this.expect('punct', ':')) {
        // missing colon, skip
        continue;
      }

      // value
      var val = this.parseValue();
      if (val !== undefined) {
        obj[key] = val;
      }

      // optional comma
      var next = this.peek();
      if (next && next.type === 'punct' && next.value === ',') this.consume();
    }
    return obj;
  };

  // ─── Top-level line parser ────────────────────────────────────────
  // Each line is: key: value
  // where value can be { ... } or "string" or number etc.

  Parser.prototype.parseTopLevel = function () {
    var result = {};
    while (this.pos < this.tokens.length) {
      var t = this.peek();
      if (!t) break;

      // expect ident or string as key
      if (t.type === 'ident' || t.type === 'string') {
        var key = this.consume().value;

        // expect colon
        if (!this.expect('punct', ':')) {
          // no colon, skip this token
          continue;
        }

        // parse value
        var val = this.parseValue();
        if (val !== undefined) {
          result[key] = val;
        }

        // optional comma between top-level entries
        var next = this.peek();
        if (next && next.type === 'punct' && next.value === ',') this.consume();
      } else {
        // skip unexpected tokens
        this.consume();
      }
    }
    return result;
  };

  // ─── Form Block Logic ─────────────────────────────────────────────

  function determineMode(field) {
    if (field.type !== 'select') return undefined;
    if (!field.options || !Array.isArray(field.options)) return 'radio';
    if (field.max === 1) return 'radio';
    if (field.max > 1) return 'checkbox';
    // max omitted
    return field.options.length <= 2 ? 'radio' : 'checkbox';
  }

  function buildField(id, raw) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

    var field = { id: id };
    field.label = raw.label || id;
    field.type = raw.type || 'text';

    if (field.type === 'select') {
      field.options = Array.isArray(raw.options) ? raw.options : [];
      if (raw.max !== undefined) field.max = raw.max;
      field.mode = determineMode(field);
    }

    if (raw.placeholder !== undefined) field.placeholder = raw.placeholder;
    field.required = raw.required === true;

    return field;
  }

  function parseFormBlock(text) {
    if (!text || typeof text !== 'string') {
      return { fields: [], submitLabel: '提交', _error: '输入为空' };
    }

    try {
      var tokens = tokenize(text);
      var parser = new Parser(tokens);
      var parsed = parser.parseTopLevel();

      var fields = [];
      var submitLabel = '提交';

      var keys = Object.keys(parsed);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key === 'submit') {
          if (typeof parsed[key] === 'string') {
            submitLabel = parsed[key];
          }
          continue;
        }
        var field = buildField(key, parsed[key]);
        if (field) fields.push(field);
      }

      return { fields: fields, submitLabel: submitLabel };
    } catch (e) {
      return { fields: [], submitLabel: '提交', _error: e.message || '解析失败' };
    }
  }

  function extractFormBlocks(markdown) {
    if (!markdown || typeof markdown !== 'string') return [];

    var results = [];
    var regex = /```form\s*\n([\s\S]*?)```/g;
    var match;

    while ((match = regex.exec(markdown)) !== null) {
      var raw = match[1];
      var parsed = parseFormBlock(raw);
      results.push({
        raw: raw,
        parsed: parsed,
        start: match.index,
        end: match.index + match[0].length
      });
    }

    return results;
  }

  // ─── Export ────────────────────────────────────────────────────────

  var api = {
    parseFormBlock: parseFormBlock,
    extractFormBlocks: extractFormBlocks
  };

  if (typeof window !== 'undefined') {
    window._t2aFormParser = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

})(typeof window !== 'undefined' ? window : global);
